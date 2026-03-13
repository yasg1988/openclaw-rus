import type { ChannelAccountSnapshot, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { MaxBotApi, type MaxBotInfo, type MaxUpdate } from "./api.js";
import { getMaxRuntime } from "./runtime.js";

const DEFAULT_TEXT_LIMIT = 4000;
const REPLY_DIRECTIVE_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

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
}) {
  const { text, senderId, senderName, chatId, chatType, api, opts, core } = params;
  const config = opts.config;
  const peerId = chatType === "group" ? chatId : senderId;
  const maxCfg = (config.channels as Record<string, any> | undefined)?.max;
  const allowFrom = (maxCfg?.allowFrom ?? []).map(String);
  const dmPolicy = String(maxCfg?.dmPolicy || "pairing");

  if (chatType === "direct" && dmPolicy !== "open" && allowFrom.length > 0 && !allowFrom.includes(senderId)) {
    await api.sendMessage({
      chatId: Number(chatId),
      text: "⛔ Доступ ограничен. Обратитесь к администратору.",
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
