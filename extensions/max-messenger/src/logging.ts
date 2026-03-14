import type { MaxChannelConfig, ResolvedMaxAccount } from "./channel.js";
import type { MaxUpdate, MaxUser } from "./api.js";

type LoggerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  schema: string;
};

type ReadProfileHeader = "Accept-Profile" | "Content-Profile";

type UserRecord = {
  user_id: number;
  chat_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_seen_at?: string;
};

type InteractionLogRecord = {
  user_id?: number | null;
  chat_id?: number | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  direction: "inbound" | "outbound";
  event_type?: string;
  message_text?: string | null;
  raw_payload?: unknown;
  session_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AllowedUserProfile = {
  user_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_seen_at?: string | null;
};

type RegisteredChat = {
  chat_id: number;
  chat_name?: string | null;
  chat_tag?: string | null;
  chat_type?: string | null;
  is_admin?: boolean | null;
  is_active?: boolean | null;
};

const registeredChatCache = new Map<string, { expiresAt: number; value: RegisteredChat | null }>();
const REGISTERED_CHAT_TTL_MS = 60_000;

function trimString(value?: string | null): string | undefined {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
}

export function resolveLoggerConfig(account: ResolvedMaxAccount): LoggerConfig | null {
  const cfg = account.config as MaxChannelConfig;
  const supabaseUrl = trimString(cfg.supabaseUrl) || trimString(process.env.MAX_SUPABASE_URL);
  const serviceRoleKey =
    trimString(cfg.supabaseServiceKey) || trimString(process.env.MAX_SUPABASE_SERVICE_ROLE_KEY);
  const schema = trimString(cfg.logSchema);

  if (!supabaseUrl || !serviceRoleKey || !schema) {
    return null;
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    serviceRoleKey,
    schema,
  };
}

async function postgrestWrite(
  logger: LoggerConfig,
  table: string,
  body: unknown,
  prefer: string
): Promise<void> {
  const res = await fetch(`${logger.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: logger.serviceRoleKey,
      Authorization: `Bearer ${logger.serviceRoleKey}`,
      "Content-Type": "application/json",
      "Content-Profile": logger.schema,
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`PostgREST write failed (${table}): ${res.status} ${res.statusText} ${errorText}`);
  }
}

async function postgrestRead<T = unknown>(
  logger: LoggerConfig,
  tableQuery: string,
  profileHeader: ReadProfileHeader = "Accept-Profile"
): Promise<T> {
  const res = await fetch(`${logger.supabaseUrl}/rest/v1/${tableQuery}`, {
    method: "GET",
    headers: {
      apikey: logger.serviceRoleKey,
      Authorization: `Bearer ${logger.serviceRoleKey}`,
      [profileHeader]: logger.schema,
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`PostgREST read failed (${tableQuery}): ${res.status} ${res.statusText} ${errorText}`);
  }

  return (await res.json()) as T;
}

async function postgrestDelete(
  logger: LoggerConfig,
  tableQuery: string
): Promise<void> {
  const res = await fetch(`${logger.supabaseUrl}/rest/v1/${tableQuery}`, {
    method: "DELETE",
    headers: {
      apikey: logger.serviceRoleKey,
      Authorization: `Bearer ${logger.serviceRoleKey}`,
      "Content-Profile": logger.schema,
      Prefer: "return=minimal",
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`PostgREST delete failed (${tableQuery}): ${res.status} ${res.statusText} ${errorText}`);
  }
}

async function postgrestRpc(
  logger: LoggerConfig,
  fn: string,
  body: unknown
): Promise<void> {
  const res = await fetch(`${logger.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: logger.serviceRoleKey,
      Authorization: `Bearer ${logger.serviceRoleKey}`,
      "Content-Type": "application/json",
      "Content-Profile": logger.schema,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`PostgREST rpc failed (${fn}): ${res.status} ${res.statusText} ${errorText}`);
  }
}

export async function upsertMaxUser(
  logger: LoggerConfig | null,
  user: UserRecord
): Promise<void> {
  if (!logger) {
    return;
  }

  await postgrestWrite(
    logger,
    "users?on_conflict=user_id,chat_id",
    [user],
    "resolution=merge-duplicates,return=minimal"
  );
}

export async function insertMaxInteractionLog(
  logger: LoggerConfig | null,
  row: InteractionLogRecord
): Promise<void> {
  if (!logger) {
    return;
  }

  await postgrestWrite(logger, "interaction_logs", [row], "return=minimal");
}

export async function isMaxUserAllowed(
  logger: LoggerConfig | null,
  table: string | null | undefined,
  userId: string | number
): Promise<boolean> {
  if (!logger) {
    return true;
  }

  const tableName = trimString(table);
  const numericUserId = Number(userId);
  if (!tableName || !Number.isFinite(numericUserId)) {
    return true;
  }

  const rows = await postgrestRead<Array<{ user_id?: number }>>(
    logger,
    `${tableName}?select=user_id&user_id=eq.${numericUserId}&limit=1`
  );

  return rows.length > 0;
}

export async function isMaxChatAllowed(
  logger: LoggerConfig | null,
  table: string | null | undefined,
  chatId: string | number
): Promise<boolean> {
  if (!logger) {
    return false;
  }

  const tableName = trimString(table);
  const numericChatId = Number(chatId);
  if (!tableName || !Number.isFinite(numericChatId)) {
    return false;
  }

  const rows = await postgrestRead<Array<{ chat_id?: number }>>(
    logger,
    `${tableName}?select=chat_id&chat_id=eq.${numericChatId}&limit=1`
  );

  return rows.length > 0;
}

export async function addMaxAllowedUser(
  logger: LoggerConfig | null,
  table: string | null | undefined,
  userId: string | number
): Promise<void> {
  if (!logger) {
    return;
  }

  const tableName = trimString(table);
  const numericUserId = Number(userId);
  if (!tableName || !Number.isFinite(numericUserId)) {
    throw new Error("Invalid allowlist target user_id");
  }

  await postgrestWrite(
    logger,
    `${tableName}?on_conflict=user_id`,
    [{ user_id: numericUserId }],
    "resolution=ignore-duplicates,return=minimal"
  );
}

export async function removeMaxAllowedUser(
  logger: LoggerConfig | null,
  table: string | null | undefined,
  userId: string | number
): Promise<void> {
  if (!logger) {
    return;
  }

  const tableName = trimString(table);
  const numericUserId = Number(userId);
  if (!tableName || !Number.isFinite(numericUserId)) {
    throw new Error("Invalid allowlist target user_id");
  }

  if (tableName === "allowed_users") {
    await postgrestRpc(logger, "remove_allowed_user", {
      target_user_id: numericUserId,
    });
    return;
  }

  await postgrestDelete(logger, `${tableName}?user_id=eq.${numericUserId}`);
}

export async function listMaxAllowedUsers(
  logger: LoggerConfig | null,
  table: string | null | undefined
): Promise<AllowedUserProfile[]> {
  if (!logger) {
    return [];
  }

  const tableName = trimString(table);
  if (!tableName) {
    return [];
  }

  const rows = await postgrestRead<Array<{ user_id?: number }>>(
    logger,
    `${tableName}?select=user_id&order=created_at.asc`
  );
  const userIds = Array.from(
    new Set(
      rows
        .map((row) => Number(row.user_id))
        .filter((value) => Number.isFinite(value))
    )
  );

  const result: AllowedUserProfile[] = [];
  for (const userId of userIds) {
    const profiles = await postgrestRead<Array<AllowedUserProfile>>(
      logger,
      `users?select=user_id,username,first_name,last_name,last_seen_at&user_id=eq.${userId}&order=last_seen_at.desc&limit=1`
    );

    result.push({
      user_id: userId,
      username: profiles[0]?.username || null,
      first_name: profiles[0]?.first_name || null,
      last_name: profiles[0]?.last_name || null,
      last_seen_at: profiles[0]?.last_seen_at || null,
    });
  }

  return result;
}

export async function getMaxRegisteredChat(
  logger: LoggerConfig | null,
  chatId: string | number
): Promise<RegisteredChat | null> {
  if (!logger) {
    return null;
  }

  const numericChatId = Number(chatId);
  if (!Number.isFinite(numericChatId)) {
    return null;
  }

  const cacheKey = `${logger.schema}:${numericChatId}`;
  const cached = registeredChatCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const rows = await postgrestRead<RegisteredChat[]>(
    logger,
    `chats?select=chat_id,chat_name,chat_tag,chat_type,is_admin,is_active&chat_id=eq.${numericChatId}&limit=1`
  );
  const value = rows[0] || null;
  registeredChatCache.set(cacheKey, {
    expiresAt: now + REGISTERED_CHAT_TTL_MS,
    value,
  });
  return value;
}

export function buildUserRecord(params: {
  user?: MaxUser;
  chatId?: string | number;
}): UserRecord | null {
  const userId = Number(params.user?.user_id);
  const chatId = Number(params.chatId);
  if (!Number.isFinite(userId) || !Number.isFinite(chatId)) {
    return null;
  }

  return {
    user_id: userId,
    chat_id: chatId,
    username: params.user?.username || null,
    first_name: params.user?.first_name || params.user?.name || null,
    last_name: params.user?.last_name || null,
    last_seen_at: new Date().toISOString(),
  };
}

export function buildInboundLogRecord(params: {
  user?: MaxUser;
  chatId?: string | number;
  text?: string;
  eventType: string;
  sessionId?: string;
  accountId: string;
  agentId: string;
  chatType?: string;
  chatScopeKey?: string;
  chatTag?: string | null;
  chatName?: string | null;
  isAdminChat?: boolean | null;
  rawPayload: MaxUpdate | Record<string, unknown>;
}): InteractionLogRecord {
  return {
    user_id: params.user?.user_id ?? null,
    chat_id: Number(params.chatId) || null,
    username: params.user?.username || null,
    first_name: params.user?.first_name || params.user?.name || null,
    last_name: params.user?.last_name || null,
    direction: "inbound",
    event_type: params.eventType,
    message_text: params.text || null,
    raw_payload: params.rawPayload,
    session_id: params.sessionId || null,
    metadata: {
      channel: "max",
      surface: "max",
      provider: "max",
      accountId: params.accountId,
      agentId: params.agentId,
      chatType: params.chatType || null,
      chatScopeKey: params.chatScopeKey || null,
      chatTag: params.chatTag || null,
      chatName: params.chatName || null,
      isAdminChat: params.isAdminChat ?? null,
      sessionKey: params.sessionId || null,
      source: "max",
    },
  };
}

export function buildOutboundLogRecord(params: {
  user?: MaxUser;
  chatId?: string | number;
  text?: string;
  eventType?: string;
  sessionId?: string;
  accountId: string;
  agentId: string;
  chatType?: string;
  chatScopeKey?: string;
  chatTag?: string | null;
  chatName?: string | null;
  isAdminChat?: boolean | null;
  rawPayload: Record<string, unknown>;
}): InteractionLogRecord {
  return {
    user_id: params.user?.user_id ?? null,
    chat_id: Number(params.chatId) || null,
    username: params.user?.username || null,
    first_name: params.user?.first_name || params.user?.name || null,
    last_name: params.user?.last_name || null,
    direction: "outbound",
    event_type: params.eventType || "message",
    message_text: params.text || null,
    raw_payload: params.rawPayload,
    session_id: params.sessionId || null,
    metadata: {
      channel: "max",
      surface: "max",
      provider: "max",
      accountId: params.accountId,
      agentId: params.agentId,
      chatType: params.chatType || null,
      chatScopeKey: params.chatScopeKey || null,
      chatTag: params.chatTag || null,
      chatName: params.chatName || null,
      isAdminChat: params.isAdminChat ?? null,
      sessionKey: params.sessionId || null,
      source: "max",
    },
  };
}
