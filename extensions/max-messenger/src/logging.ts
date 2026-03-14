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
      accountId: params.accountId,
      agentId: params.agentId,
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
      accountId: params.accountId,
      agentId: params.agentId,
      source: "max",
    },
  };
}
