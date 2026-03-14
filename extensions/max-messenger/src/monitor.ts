import type { ChannelAccountSnapshot, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { MaxBotApi, type MaxBotInfo, type MaxUpdate } from "./api.js";
import {
  addMaxAllowedUser,
  buildInboundLogRecord,
  buildOutboundLogRecord,
  buildUserRecord,
  isMaxUserAllowed,
  isMaxChatAllowed,
  insertMaxInteractionLog,
  listMaxAllowedUsers,
  removeMaxAllowedUser,
  resolveLoggerConfig,
  upsertMaxUser,
} from "./logging.js";
import { resolveMaxAccount } from "./channel.js";
import { getMaxRuntime } from "./runtime.js";

const DEFAULT_TEXT_LIMIT = 4000;
const REPLY_DIRECTIVE_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

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

      for (const update of response.updates || []) {
        try {
          await handleUpdate(update, { api, botInfo, opts, core });
        } catch (error) {
          console.error("[max] update handler error:", error);
        }
      }
    } catch (error) {
      if (opts.abortSignal.aborted) {
        break;
      }
      console.error("[max] poll error:", error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

function sanitizeOutboundText(text: string): string {
  return text.replace(REPLY_DIRECTIVE_TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function parseOperatorAdminIntent(text: string): AdminIntent | null {
  const normalized = text.trim();
  const lowered = normalized.toLowerCase();
  const idMatch = lowered.match(/(?<!\d)-?\d{5,}(?!\d)/);
  const userId = idMatch ? Number(idMatch[0]) : null;

  const hasAny = (parts: string[]) => parts.some((part) => lowered.includes(part));
  const asksAboutOperatorAccess =
    hasAny([
      "список доступ",
      "покажи список",
      "показать список",
      "кому разреш",
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
    (hasAny(["список", "покажи", "показать", "кому", "кто"]) &&
      hasAny(["доступ", "оператор", "бот"]));

  if (asksAboutOperatorAccess) {
    return { action: "list" };
  }

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
      rawPayload: params.rawPayload,
    })
  );
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
      rawUpdate: update,
      senderUser: update.user,
      ...ctx,
    });
    return;
  }

  if (update.update_type === "message_callback" && update.callback?.payload) {
    const userId = update.callback.user?.user_id;
    const chatId = update.callback.message?.recipient?.chat_id;
    const senderName =
      update.callback.user?.first_name ||
      update.callback.user?.name ||
      update.callback.user?.username ||
      String(userId);

    if (!userId || !chatId) {
      return;
    }

    await dispatchToOpenClaw({
      text: update.callback.payload,
      senderId: String(userId),
      senderName,
      chatId: String(chatId),
      chatType: "direct",
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
  const text = message.body?.text || "";
  const senderName =
    message.sender?.first_name || message.sender?.name || message.sender?.username || String(senderId);
  const chatType = message.recipient?.chat_type === "dialog" ? "direct" : "group";

  if (!senderId || !chatId || senderId === ctx.botInfo.user_id || !text.trim()) {
    return;
  }

  await dispatchToOpenClaw({
    text,
    senderId: String(senderId),
    senderName,
    chatId: String(chatId),
    chatType,
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
  api: MaxBotApi;
  botInfo: MaxBotInfo;
  opts: MaxMonitorOptions;
  core: PluginRuntime;
  rawUpdate?: MaxUpdate;
  senderUser?: MaxUpdate["user"];
}) {
  const { text, senderId, senderName, chatId, chatType, api, opts, core, rawUpdate, senderUser } = params;
  const config = opts.config;
  const peerId = chatType === "group" ? chatId : senderId;
  const account = resolveMaxAccount(config, opts.accountId);
  const logger = resolveLoggerConfig(account);
  const allowFrom = (account.config.allowFrom ?? []).map(String);
  const dmPolicy = String(account.config.dmPolicy || "pairing");
  const directUserAllowlistTable = String(account.config.directUserAllowlistTable || "").trim();
  const adminChatTable = String(account.config.adminChatTable || "").trim();

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
              eventType: `${rawUpdate?.update_type || "message_created"}:denied`,
              sessionId: undefined,
              accountId: opts.accountId,
              agentId: "unauthorized",
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
            eventType: "admin_command",
            sessionId: undefined,
            accountId: opts.accountId,
            agentId: "admin_tool",
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
      eventType: rawUpdate?.update_type || "message_created",
      sessionId: route.sessionKey,
      accountId: opts.accountId,
      agentId: route.agentId,
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
