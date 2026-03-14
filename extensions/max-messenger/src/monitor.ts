import type { ChannelAccountSnapshot, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { MaxBotApi, type MaxBotInfo, type MaxUpdate } from "./api.js";
import {
  addMaxAllowedUser,
  buildInboundLogRecord,
  buildOutboundLogRecord,
  buildUserRecord,
  getMaxRegisteredChat,
  isMaxUserAllowed,
  isMaxChatAllowed,
  insertMaxInteractionLog,
  listMaxAllowedUsers,
  removeMaxAllowedUser,
  resolveLoggerConfig,
  upsertMaxUser,
} from "./logging.js";
import { resolveMaxAccount } from "./channel.js";
import {
  buildPublicMainMenuAttachments,
  evaluatePublicSafety,
  sanitizePublicOutbound,
} from "./public-safety.js";
import { getMaxRuntime } from "./runtime.js";
import { resolveTranscriptionConfig, transcribeMaxAudioAttachment } from "./transcription.js";

const DEFAULT_TEXT_LIMIT = 4000;
const REPLY_DIRECTIVE_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;
const RADAR_MENU_LOGO_PATH = process.env.MAX_RADAR_MENU_LOGO_PATH || "/root/.openclaw/workspace/agents/gor_radar/logo.png";
const publicMenuImageByPath = new Map<string, Promise<string | null>>();

type AdminIntent =
  | { action: "list" }
  | { action: "add"; userId: number }
  | { action: "remove"; userId: number };

export interface MaxMonitorOptions {
  token: string;
  apiBaseUrl?: string;
  accountId: string;
  config: OpenClawConfig;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
  abortSignal: AbortSignal;
}

function deriveUpdateConcurrencyKey(update: MaxUpdate, accountId: string): string {
  if (update.update_type === "bot_started") {
    const chatId = update.chat_id;
    const userId = update.user?.user_id;
    return `${accountId}:direct:${chatId ?? userId ?? "unknown"}`;
  }

  if (update.update_type === "message_callback") {
    const chatId = update.callback?.message?.recipient?.chat_id;
    const userId = update.callback?.user?.user_id;
    return `${accountId}:callback:${chatId ?? userId ?? "unknown"}`;
  }

  if (update.update_type === "message_created") {
    const chatId = update.message?.recipient?.chat_id;
    const senderId = update.message?.sender?.user_id;
    return `${accountId}:message:${chatId ?? senderId ?? "unknown"}`;
  }

  return `${accountId}:update:${update.update_type}:${update.timestamp ?? Date.now()}`;
}

function deriveChatScopeKey(accountId: string, chatType: "direct" | "group", chatId: string, senderId: string): string {
  return `${accountId}:${chatType}:${chatType === "group" ? chatId : senderId}`;
}

export async function monitorMaxProvider(opts: MaxMonitorOptions) {
  const core = getMaxRuntime();
  const api = new MaxBotApi({
    token: opts.token,
    apiBaseUrl: opts.apiBaseUrl || "https://platform-api.max.ru",
    timeoutMs: 10000,
  });

  let botInfo: MaxBotInfo;
  try {
    botInfo = await api.getMe();
    if (!botInfo?.user_id) {
      throw new Error("Invalid MAX bot token");
    }
    console.log(`[max] bot ready: ${botInfo.first_name || botInfo.username || botInfo.user_id}`);
  } catch (error) {
    console.error("[max] failed to verify bot token:", error);
    throw error;
  }

  let marker: number | null = null;
  const inFlightByKey = new Map<string, Promise<void>>();

  while (!opts.abortSignal.aborted) {
    try {
      const response = await api.getUpdates({
        marker,
        timeout: 30,
        types: ["message_created", "message_callback", "bot_started"],
      });

      if (response.marker != null) {
        marker = response.marker;
      }

      if ((response.updates || []).length > 0) {
        console.log(
          `[max] [${opts.accountId}] polled ${(response.updates || []).length} update(s), marker=${String(marker)}`
        );
      }

      for (const update of response.updates || []) {
        const key = deriveUpdateConcurrencyKey(update, opts.accountId);
        const previous = inFlightByKey.get(key) ?? Promise.resolve();
        const next = previous
          .catch(() => {})
          .then(async () => {
            try {
              await handleUpdate(update, { api, botInfo, opts, core });
            } catch (error) {
              console.error("[max] update handler error:", error);
            }
          })
          .finally(() => {
            if (inFlightByKey.get(key) === next) {
              inFlightByKey.delete(key);
            }
          });

        inFlightByKey.set(key, next);
      }
    } catch (error) {
      if (opts.abortSignal.aborted) {
        break;
      }
      console.error("[max] poll error:", error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  await Promise.allSettled(Array.from(inFlightByKey.values()));
}

function sanitizeOutboundText(text: string): string {
  return text.replace(REPLY_DIRECTIVE_TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function deriveInboundEventType(updateType: string | undefined, hasVoiceAttachment: boolean): string {
  const base = updateType || "message_created";
  return hasVoiceAttachment ? `voice_${base}` : base;
}

function parseOperatorAdminIntent(text: string): AdminIntent | null {
  const normalized = text.trim();
  const lowered = normalized.toLowerCase();
  const idMatch = lowered.match(/(?<!\d)-?\d{5,}(?!\d)/);
  const userId = idMatch ? Number(idMatch[0]) : null;

  const hasAny = (parts: string[]) => parts.some((part) => lowered.includes(part));
  if (
    userId &&
    hasAny(["добав", "разреш", "открой", "дай доступ", "предостав", "внеси", "включи"])
  ) {
    return { action: "add", userId };
  }

  if (
    userId &&
    hasAny(["удал", "убер", "запрет", "закрой доступ", "исключ", "сними доступ", "выключи"])
  ) {
    return { action: "remove", userId };
  }

  const asksAboutOperatorAccess =
    hasAny([
      "список доступ",
      "покажи список",
      "показать список",
      "у кого есть доступ",
      "кому разреш",
      "кому доступ",
      "кто допущен",
      "кто может писать",
      "кто может писать оператору",
      "кто может писать боту",
      "кто в списке",
      "кто есть в списке",
      "доступ к боту оператора",
      "доступ к оператору",
      "allowlist",
      "allowed users",
    ]) ||
    (hasAny(["список", "покажи", "показать", "кому", "кто", "у кого"]) &&
      hasAny(["доступ", "оператор", "бот"]));

  if (!userId && asksAboutOperatorAccess) {
    return { action: "list" };
  }

  return null;
}

function formatAllowedUsersList(rows: Array<{
  user_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}>): string {
  if (!rows.length) {
    return "Список доступа пуст.";
  }

  const lines = rows.map((row, index) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    const username = row.username ? `@${row.username}` : "без username";
    const label = name || "без имени";
    return `${index + 1}. ${row.user_id} — ${username} — ${label}`;
  });

  return `Сейчас доступ к личке Оператора есть у:\n${lines.join("\n")}`;
}

async function logMaxInbound(
  logger: ReturnType<typeof resolveLoggerConfig>,
  params: {
    user?: MaxUpdate["user"];
    chatId: string;
    text: string;
    eventType: string;
    accountId: string;
    agentId: string;
    chatType?: string;
    chatScopeKey?: string;
    chatTag?: string | null;
    chatName?: string | null;
    isAdminChat?: boolean | null;
    rawPayload: MaxUpdate | Record<string, unknown>;
    sessionId?: string;
  }
) {
  await insertMaxInteractionLog(
    logger,
    buildInboundLogRecord({
      user: params.user,
      chatId: params.chatId,
      text: params.text,
      eventType: params.eventType,
      sessionId: params.sessionId,
      accountId: params.accountId,
      agentId: params.agentId,
      chatType: params.chatType,
      chatScopeKey: params.chatScopeKey,
      chatTag: params.chatTag,
      chatName: params.chatName,
      isAdminChat: params.isAdminChat,
      rawPayload: params.rawPayload,
    })
  );
}

async function logMaxOutbound(
  logger: ReturnType<typeof resolveLoggerConfig>,
  params: {
    user?: MaxUpdate["user"];
    chatId: string;
    text: string;
    eventType: string;
    accountId: string;
    agentId: string;
    chatType?: string;
    chatScopeKey?: string;
    chatTag?: string | null;
    chatName?: string | null;
    isAdminChat?: boolean | null;
    rawPayload: Record<string, unknown>;
    sessionId?: string;
  }
) {
  await insertMaxInteractionLog(
    logger,
    buildOutboundLogRecord({
      user: params.user,
      chatId: params.chatId,
      text: params.text,
      eventType: params.eventType,
      sessionId: params.sessionId,
      accountId: params.accountId,
      agentId: params.agentId,
      chatType: params.chatType,
      chatScopeKey: params.chatScopeKey,
      chatTag: params.chatTag,
      chatName: params.chatName,
      isAdminChat: params.isAdminChat,
      rawPayload: params.rawPayload,
    })
  );
}

async function sendStaticReply(params: {
  api: MaxBotApi;
  logger: ReturnType<typeof resolveLoggerConfig>;
  chatId: string;
  text: string;
  eventType: string;
  accountId: string;
  agentId: string;
  chatType: "direct" | "group";
  chatScopeKey: string;
  senderUser?: MaxUpdate["user"];
  sessionId?: string;
  chatTag?: string | null;
  chatName?: string | null;
  isAdminChat?: boolean | null;
  rawPayload: Record<string, unknown>;
  attachments?: unknown[];
}) {
  const replyText = sanitizeOutboundText(params.text);
  if (!replyText.trim()) {
    return;
  }

  const result = await params.api.sendMessage({
    chatId: Number(params.chatId),
    text: replyText,
    attachments: params.attachments,
    format: "markdown",
  });

  try {
    await logMaxOutbound(params.logger, {
      user: params.senderUser,
      chatId: params.chatId,
      text: replyText,
      eventType: params.eventType,
      sessionId: params.sessionId,
      accountId: params.accountId,
      agentId: params.agentId,
      chatType: params.chatType,
      chatScopeKey: params.chatScopeKey,
      chatTag: params.chatTag,
      chatName: params.chatName,
      isAdminChat: params.isAdminChat,
      rawPayload: {
        ...params.rawPayload,
        messageId: result?.message?.body?.mid || null,
      },
    });
  } catch (error) {
    console.error("[max] outbound log error:", error);
  }
}

async function answerMaxCallback(params: {
  api: MaxBotApi;
  callbackId: string;
  text: string;
  attachments?: unknown[];
}) {
  const replyText = sanitizeOutboundText(params.text);
  if (!replyText.trim()) {
    return;
  }

  await params.api.answerOnCallback({
    callbackId: params.callbackId,
    message: {
      text: replyText,
      attachments: params.attachments,
      format: "markdown",
    },
  });
}

async function getRadarMenuImageToken(api: MaxBotApi): Promise<string | null> {
  const cacheKey = RADAR_MENU_LOGO_PATH;
  let promise = publicMenuImageByPath.get(cacheKey);
  if (!promise) {
    promise = api
      .uploadImageFromFile(cacheKey)
      .then((payload) => {
        const topLevelToken = typeof payload?.token === "string" ? payload.token.trim() : "";
        if (topLevelToken) {
          return topLevelToken;
        }

        const photos =
          payload && typeof payload === "object" && payload.photos && typeof payload.photos === "object"
            ? Object.values(payload.photos as Record<string, unknown>)
            : [];
        for (const photo of photos) {
          if (photo && typeof photo === "object") {
            const nestedToken = typeof (photo as Record<string, unknown>).token === "string"
              ? ((photo as Record<string, unknown>).token as string).trim()
              : "";
            if (nestedToken) {
              return nestedToken;
            }
          }
        }
        return null;
      })
      .catch((error) => {
        console.error("[max] radar menu image upload error:", error);
        return null;
      });
    publicMenuImageByPath.set(cacheKey, promise);
  }
  return promise;
}

async function handleUpdate(
  update: MaxUpdate,
  ctx: {
    api: MaxBotApi;
    botInfo: MaxBotInfo;
    opts: MaxMonitorOptions;
    core: PluginRuntime;
  }
) {
  console.log(
    `[max] [${ctx.opts.accountId}] update type=${update.update_type} ts=${String(update.timestamp ?? "")}`
  );

  if (update.update_type === "bot_started") {
    const userId = update.user?.user_id;
    const chatId = update.chat_id;
    const senderName =
      update.user?.first_name || update.user?.name || update.user?.username || String(userId);

    if (!userId || !chatId) {
      return;
    }

    await dispatchToOpenClaw({
      text: `/start${update.payload ? ` ${update.payload}` : ""}`,
      senderId: String(userId),
      senderName,
      chatId: String(chatId),
      chatType: "direct",
      hasVoiceAttachment: false,
      rawUpdate: update,
      senderUser: update.user,
      ...ctx,
    });
    return;
  }

  if (update.update_type === "message_callback" && update.callback?.payload) {
    console.log(
      `[max] [${ctx.opts.accountId}] callback payloadType=${typeof update.callback.payload} chatId=${String(
        update.callback.message?.recipient?.chat_id ?? ""
      )} userId=${String(update.callback.user?.user_id ?? "")} payload=${JSON.stringify(update.callback.payload)}`
    );
    const userId = update.callback.user?.user_id;
    const chatId = update.callback.message?.recipient?.chat_id;
    const senderName =
      update.callback.user?.first_name ||
      update.callback.user?.name ||
      update.callback.user?.username ||
      String(userId);

    if (!userId || !chatId) {
      console.log(
        `[max] [${ctx.opts.accountId}] callback ignored: missing senderId/chatId senderId=${String(
          userId ?? ""
        )} chatId=${String(chatId ?? "")}`
      );
      return;
    }

    await dispatchToOpenClaw({
      text: update.callback.payload,
      senderId: String(userId),
      senderName,
      chatId: String(chatId),
      chatType: "direct",
      hasVoiceAttachment: false,
      rawUpdate: update,
      senderUser: update.callback.user,
      ...ctx,
    });
    return;
  }

  if (update.update_type !== "message_created" || !update.message) {
    return;
  }

  const message = update.message;
  const senderId = message.sender?.user_id;
  const chatId = message.recipient?.chat_id;
  const attachments = (message.body?.attachments as unknown[]) || [];
  const hasVoiceAttachment = attachments.some((attachment: any) => attachment?.type === "audio");
  let text = message.body?.text || "";
  const senderName =
    message.sender?.first_name || message.sender?.name || message.sender?.username || String(senderId);
  const chatType = message.recipient?.chat_type === "dialog" ? "direct" : "group";

  if (!senderId || !chatId || senderId === ctx.botInfo.user_id) {
    return;
  }

  if (attachments.length) {
    const account = resolveMaxAccount(ctx.opts.config, ctx.opts.accountId);
    const transcriptionConfig = resolveTranscriptionConfig(account.config as Record<string, unknown>);
    try {
      const transcript = await transcribeMaxAudioAttachment(attachments, transcriptionConfig);
      if (transcript) {
        text = text.trim()
          ? `${text.trim()}\n\n[Голосовое сообщение]: ${transcript}`
          : `[Голосовое сообщение]: ${transcript}`;
      } else if (!text.trim()) {
        text = "[Голосовое сообщение]";
      }
    } catch (error) {
      console.error("[max] transcription error:", error);
      if (!text.trim()) {
        text = "[Голосовое сообщение — не удалось расшифровать]";
      }
    }
  }

  if (!text.trim()) {
    return;
  }

  await dispatchToOpenClaw({
    text,
    senderId: String(senderId),
    senderName,
    chatId: String(chatId),
    chatType,
    hasVoiceAttachment,
    rawUpdate: update,
    senderUser: message.sender,
    ...ctx,
  });
}

async function dispatchToOpenClaw(params: {
  text: string;
  senderId: string;
  senderName: string;
  chatId: string;
  chatType: "direct" | "group";
  hasVoiceAttachment?: boolean;
  api: MaxBotApi;
  botInfo: MaxBotInfo;
  opts: MaxMonitorOptions;
  core: PluginRuntime;
  rawUpdate?: MaxUpdate;
  senderUser?: MaxUpdate["user"];
}) {
  const { text, senderId, senderName, chatId, chatType, hasVoiceAttachment = false, api, opts, core, rawUpdate, senderUser } = params;
  const config = opts.config;
  const peerId = chatType === "group" ? chatId : senderId;
  const chatScopeKey = deriveChatScopeKey(opts.accountId, chatType, chatId, senderId);
  const account = resolveMaxAccount(config, opts.accountId);
  const logger = resolveLoggerConfig(account);
  const registeredChat = chatType === "group" ? await getMaxRegisteredChat(logger, chatId) : null;
  const allowFrom = (account.config.allowFrom ?? []).map(String);
  const dmPolicy = String(account.config.dmPolicy || "pairing");
  const directUserAllowlistTable = String(account.config.directUserAllowlistTable || "").trim();
  const adminChatTable = String(account.config.adminChatTable || "").trim();
  const isPublicResidentBot = opts.accountId === "radar";

  if (chatType === "direct" && directUserAllowlistTable) {
    try {
      const isAllowed = await isMaxUserAllowed(logger, directUserAllowlistTable, senderId);
      if (!isAllowed) {
        const denialText = "⛔ Доступ к этому боту ограничен. Обратитесь к администратору.";
        await api.sendMessage({
          chatId: Number(chatId),
          text: denialText,
        });

        try {
          await insertMaxInteractionLog(
            logger,
            buildInboundLogRecord({
              user: senderUser,
              chatId,
              text,
              eventType: `${deriveInboundEventType(rawUpdate?.update_type, hasVoiceAttachment)}:denied`,
              sessionId: undefined,
              accountId: opts.accountId,
              agentId: "unauthorized",
              chatType,
              chatScopeKey,
              chatTag: registeredChat?.chat_tag || null,
              chatName: registeredChat?.chat_name || null,
              isAdminChat: registeredChat?.is_admin ?? null,
              rawPayload: rawUpdate || { text, senderId, chatId, chatType },
            })
          );
        } catch (error) {
          console.error("[max] inbound log error:", error);
        }

        try {
          await insertMaxInteractionLog(
            logger,
            buildOutboundLogRecord({
              user: senderUser,
              chatId,
              text: denialText,
              eventType: "access_denied",
              sessionId: undefined,
              accountId: opts.accountId,
              agentId: "unauthorized",
              chatType,
              chatScopeKey,
              chatTag: registeredChat?.chat_tag || null,
              chatName: registeredChat?.chat_name || null,
              isAdminChat: registeredChat?.is_admin ?? null,
              rawPayload: {
                reason: "user_not_in_allowlist",
                userId: senderId,
                table: directUserAllowlistTable,
              },
            })
          );
        } catch (error) {
          console.error("[max] outbound log error:", error);
        }
        return;
      }
    } catch (error) {
      console.error("[max] allowlist check error:", error);
      await api.sendMessage({
        chatId: Number(chatId),
        text: "⚠️ Не удалось проверить доступ. Попробуйте позже.",
      });
      return;
    }
  }

  if (chatType === "direct" && dmPolicy !== "open" && allowFrom.length > 0 && !allowFrom.includes(senderId)) {
    await api.sendMessage({
      chatId: Number(chatId),
      text: "⛔ Доступ ограничен. Обратитесь к администратору.",
    });
    return;
  }

  const adminIntent = parseOperatorAdminIntent(text);
  if (chatType === "group" && adminChatTable && adminIntent) {
    try {
      const isAdminChat = await isMaxChatAllowed(logger, adminChatTable, chatId);
      if (isAdminChat) {
        const userRecord = buildUserRecord({
          user: senderUser,
          chatId,
        });
        if (userRecord) {
          try {
            await upsertMaxUser(logger, userRecord);
          } catch (error) {
            console.error("[max] user upsert error:", error);
          }
        }

        try {
          await logMaxInbound(logger, {
            user: senderUser,
            chatId,
            text,
            eventType: hasVoiceAttachment ? "admin_voice_command" : "admin_command",
            sessionId: undefined,
            accountId: opts.accountId,
            agentId: "admin_tool",
            chatType,
            chatScopeKey,
            chatTag: registeredChat?.chat_tag || null,
            chatName: registeredChat?.chat_name || null,
            isAdminChat: registeredChat?.is_admin ?? null,
            rawPayload: rawUpdate || { text, senderId, chatId, chatType },
          });
        } catch (error) {
          console.error("[max] inbound log error:", error);
        }

        let replyText = "";
        if (adminIntent.action === "add") {
          await addMaxAllowedUser(logger, directUserAllowlistTable, adminIntent.userId);
          replyText = `Добавил user_id ${adminIntent.userId} в доступ к личке Оператора.`;
        } else if (adminIntent.action === "remove") {
          await removeMaxAllowedUser(logger, directUserAllowlistTable, adminIntent.userId);
          replyText = `Удалил user_id ${adminIntent.userId} из доступа к личке Оператора.`;
        } else {
          const rows = await listMaxAllowedUsers(logger, directUserAllowlistTable);
          replyText = formatAllowedUsersList(rows);
        }

        await api.sendMessage({
          chatId: Number(chatId),
          text: replyText,
          format: "markdown",
        });

        try {
          await logMaxOutbound(logger, {
            user: senderUser,
            chatId,
            text: replyText,
            eventType: `admin_${adminIntent.action}`,
            sessionId: undefined,
            accountId: opts.accountId,
            agentId: "admin_tool",
            chatType,
            chatScopeKey,
            chatTag: registeredChat?.chat_tag || null,
            chatName: registeredChat?.chat_name || null,
            isAdminChat: registeredChat?.is_admin ?? null,
            rawPayload: {
              action: adminIntent.action,
              userId: "userId" in adminIntent ? adminIntent.userId : null,
            },
          });
        } catch (error) {
          console.error("[max] outbound log error:", error);
        }
        return;
      }
    } catch (error) {
      console.error("[max] admin tool error:", error);
      await api.sendMessage({
        chatId: Number(chatId),
        text: "⚠️ Не удалось выполнить админ-команду. Попробуйте позже.",
      });
      return;
    }
  }

  if (isPublicResidentBot) {
    const publicDecision = evaluatePublicSafety(text);
    const safeReply = sanitizePublicOutbound(publicDecision.reply);
    const sessionId = `public:${chatScopeKey}`;
    const attachments =
      publicDecision.kind === "menu"
        ? buildPublicMainMenuAttachments(await getRadarMenuImageToken(api))
        : undefined;

    const userRecord = buildUserRecord({
      user: senderUser,
      chatId,
    });
    if (userRecord) {
      try {
        await upsertMaxUser(logger, userRecord);
      } catch (error) {
        console.error("[max] user upsert error:", error);
      }
    }

    try {
      await logMaxInbound(logger, {
        user: senderUser,
        chatId,
        text,
        eventType: `${deriveInboundEventType(rawUpdate?.update_type, hasVoiceAttachment)}:${publicDecision.intent}`,
        sessionId,
        accountId: opts.accountId,
        agentId: "public_guard",
        chatType,
        chatScopeKey,
        chatTag: registeredChat?.chat_tag || null,
        chatName: registeredChat?.chat_name || null,
        isAdminChat: registeredChat?.is_admin ?? null,
        rawPayload: {
          ...(rawUpdate || { text, senderId, chatId, chatType }),
          publicPolicy: {
            intent: publicDecision.intent,
            eventType: publicDecision.eventType,
            reasonCode: publicDecision.reasonCode,
          },
        },
      });
    } catch (error) {
      console.error("[max] inbound log error:", error);
    }
    const callbackId =
      rawUpdate?.update_type === "message_callback" ? rawUpdate.callback?.callback_id || null : null;

    if (callbackId) {
      await answerMaxCallback({
        api,
        callbackId,
        text: safeReply,
        attachments,
      });

      try {
        await logMaxOutbound(logger, {
          user: senderUser,
          chatId,
          text: safeReply,
          eventType: publicDecision.eventType,
          sessionId,
          accountId: opts.accountId,
          agentId: "public_guard",
          chatType,
          chatScopeKey,
          chatTag: registeredChat?.chat_tag || null,
          chatName: registeredChat?.chat_name || null,
          isAdminChat: registeredChat?.is_admin ?? null,
          rawPayload: {
            policy: {
              intent: publicDecision.intent,
              reasonCode: publicDecision.reasonCode,
            },
            callbackId,
            mode: "answer_on_callback",
          },
        });
      } catch (error) {
        console.error("[max] outbound log error:", error);
      }
    } else {
      await sendStaticReply({
        api,
        logger,
        chatId,
        text: safeReply,
        attachments,
        eventType: publicDecision.eventType,
        accountId: opts.accountId,
        agentId: "public_guard",
        chatType,
        chatScopeKey,
        senderUser,
        sessionId,
        chatTag: registeredChat?.chat_tag || null,
        chatName: registeredChat?.chat_name || null,
        isAdminChat: registeredChat?.is_admin ?? null,
        rawPayload: {
          policy: {
            intent: publicDecision.intent,
            reasonCode: publicDecision.reasonCode,
          },
        },
      });
    }

    opts.setStatus({
      ...opts.getStatus(),
      lastInboundAt: Date.now(),
      lastOutboundAt: Date.now(),
    });
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "max",
    accountId: opts.accountId,
    peer: {
      kind: chatType === "group" ? "group" : "direct",
      id: peerId,
    },
  });

  const storePath = core.channel.session.resolveStorePath((config as any).session?.store, {
    agentId: route.agentId,
  });
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const envelope = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "MAX",
    from: chatType === "group" ? undefined : senderName,
    timestamp: Date.now(),
    previousTimestamp,
    envelope,
    body: text,
  });

  try {
    await api.sendAction(Number(chatId), "typing_on");
  } catch {}

  opts.setStatus({
    ...opts.getStatus(),
    lastInboundAt: Date.now(),
  });

  const commandAuthorized = dmPolicy === "open" || allowFrom.length === 0 || allowFrom.includes(senderId);
  const ctxPayload = {
    Body: body,
    BodyForAgent: body,
    RawBody: text,
    CommandBody: text,
    BodyForCommands: text,
    From: chatType === "group" ? `group:${chatId}` : `max:${senderId}`,
    To: `max:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: opts.accountId,
    ChatType: chatType,
    ConversationLabel: chatType === "group" ? undefined : senderName,
    SenderName: senderName,
    SenderId: senderId,
    Provider: "max",
    Surface: "max",
    Timestamp: Date.now(),
    OriginatingChannel: "max",
    OriginatingTo: `max:${chatId}`,
    CommandAuthorized: commandAuthorized,
  };

  const userRecord = buildUserRecord({
    user: senderUser,
    chatId,
  });
  if (userRecord) {
    try {
      await upsertMaxUser(logger, userRecord);
    } catch (error) {
      console.error("[max] user upsert error:", error);
    }
  }

  try {
    await logMaxInbound(logger, {
      user: senderUser,
      chatId,
      text,
      eventType: deriveInboundEventType(rawUpdate?.update_type, hasVoiceAttachment),
      sessionId: route.sessionKey,
      accountId: opts.accountId,
      agentId: route.agentId,
      chatType,
      chatScopeKey,
      chatTag: registeredChat?.chat_tag || null,
      chatName: registeredChat?.chat_name || null,
      isAdminChat: registeredChat?.is_admin ?? null,
      rawPayload: rawUpdate || { text, senderId, chatId, chatType },
    });
  } catch (error) {
    console.error("[max] inbound log error:", error);
  }

  let streamMid: string | null = null;
  let streamAccum = "";

  try {
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: {
        deliver: async (payload: { text?: string }) => {
          const replyText = sanitizeOutboundText(payload.text ?? "");
          if (!replyText.trim()) {
            return;
          }

          if (streamMid) {
            streamAccum += "\n\n" + replyText;
            const editText =
              streamAccum.length > DEFAULT_TEXT_LIMIT
                ? streamAccum.slice(0, DEFAULT_TEXT_LIMIT - 3) + "..."
                : streamAccum;

            try {
              await api.editMessage({
                messageId: streamMid,
                text: editText,
                format: "markdown",
                notify: false,
              });
            } catch {
              streamMid = null;
              streamAccum = "";
            }
          }

          if (!streamMid) {
            const result = await api.sendMessage({
              chatId: Number(chatId),
              text: replyText,
              format: "markdown",
            });

            const mid = result?.message?.body?.mid;
            if (mid) {
              streamMid = mid;
              streamAccum = replyText;
            }

            try {
              await logMaxOutbound(logger, {
                user: senderUser,
                chatId,
                text: replyText,
                eventType: "message",
                sessionId: route.sessionKey,
                accountId: opts.accountId,
                agentId: route.agentId,
                chatType,
                chatScopeKey,
                chatTag: registeredChat?.chat_tag || null,
                chatName: registeredChat?.chat_name || null,
                isAdminChat: registeredChat?.is_admin ?? null,
                rawPayload: {
                  messageId: mid || null,
                  payload,
                  mode: "send",
                },
              });
            } catch (error) {
              console.error("[max] outbound log error:", error);
            }
          }

          opts.setStatus({
            ...opts.getStatus(),
            lastOutboundAt: Date.now(),
          });
        },
        onReplyStart: async () => {
          try {
            await api.sendAction(Number(chatId), "typing_on");
          } catch {}
        },
        onIdle: async () => {},
      },
    });
  } catch (error) {
    console.error("[max] dispatchReply error:", error);
    try {
      await api.sendMessage({
        chatId: Number(chatId),
        text: "⚠️ Произошла ошибка при обработке сообщения.",
      });
    } catch {}
  }
}
