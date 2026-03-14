import type {
  BaseProbeResult,
  ChannelAccountSnapshot,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { createDefaultChannelRuntimeState } from "openclaw/plugin-sdk/compat";
import { MaxBotApi } from "./api.js";
import { monitorMaxProvider } from "./monitor.js";
import { getMaxRuntime } from "./runtime.js";

const DEFAULT_ACCOUNT_ID = "default";

export interface MaxChannelConfig {
  name?: string;
  enabled?: boolean;
  botToken?: string;
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  logSchema?: string;
  directUserAllowlistTable?: string;
  adminChatTable?: string;
  allowFrom?: Array<string | number>;
  dmPolicy?: string;
  defaultTo?: string;
  accounts?: Record<string, MaxChannelConfig>;
  defaultAccountId?: string;
}

export interface ResolvedMaxAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  token: string;
  tokenSource: string;
  baseUrl: string;
  config: MaxChannelConfig;
}

type MaxProbe = BaseProbeResult & {
  bot?: {
    id?: number;
    username?: string;
    firstName?: string;
  };
};

function readMaxChannelConfig(cfg: OpenClawConfig): MaxChannelConfig {
  const channels = cfg.channels as Record<string, any> | undefined;
  return (channels?.max as MaxChannelConfig | undefined) || {};
}

function listMaxAccountIds(cfg: OpenClawConfig): string[] {
  const channelCfg = readMaxChannelConfig(cfg);
  const accountKeys = Object.keys(channelCfg.accounts || {}).filter(Boolean);
  return Array.from(new Set([DEFAULT_ACCOUNT_ID, ...accountKeys]));
}

function resolveDefaultMaxAccountId(cfg: OpenClawConfig): string {
  const channelCfg = readMaxChannelConfig(cfg);
  const preferred = String(channelCfg.defaultAccountId || "").trim();
  if (preferred && listMaxAccountIds(cfg).includes(preferred)) {
    return preferred;
  }
  return DEFAULT_ACCOUNT_ID;
}

function readMaxAccountConfig(cfg: OpenClawConfig, accountId?: string | null): MaxChannelConfig {
  const channelCfg = readMaxChannelConfig(cfg);
  const resolvedAccountId = String(accountId || resolveDefaultMaxAccountId(cfg)).trim() || DEFAULT_ACCOUNT_ID;
  const { accounts, defaultAccountId, ...base } = channelCfg;
  if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...base,
      ...(accounts?.[DEFAULT_ACCOUNT_ID] || {}),
    };
  }
  const scoped = accounts?.[resolvedAccountId] || {};
  return {
    ...base,
    ...scoped,
  };
}

function resolveAccountToken(accountId: string, accountCfg: MaxChannelConfig): { token: string; tokenSource: string } {
  const normalizedAccountId = accountId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  const envTokenName = accountId === DEFAULT_ACCOUNT_ID ? "MAX_BOT_TOKEN" : `MAX_BOT_TOKEN_${normalizedAccountId}`;
  const envToken = String(process.env[envTokenName] || "").trim();
  const defaultEnvToken = accountId === DEFAULT_ACCOUNT_ID ? "" : String(process.env.MAX_BOT_TOKEN || "").trim();
  const configToken = String(accountCfg.botToken || "").trim();
  const token = configToken || envToken || defaultEnvToken || "";
  const tokenSource = configToken
    ? "config"
    : envToken
      ? `env:${envTokenName}`
      : defaultEnvToken
        ? "env:MAX_BOT_TOKEN"
        : "none";
  return { token, tokenSource };
}

export function resolveMaxAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedMaxAccount {
  const resolvedAccountId = String(accountId || resolveDefaultMaxAccountId(cfg)).trim() || DEFAULT_ACCOUNT_ID;
  const accountCfg = readMaxAccountConfig(cfg, resolvedAccountId);
  const { token, tokenSource } = resolveAccountToken(resolvedAccountId, accountCfg);

  return {
    accountId: resolvedAccountId,
    name: accountCfg.name,
    enabled: accountCfg.enabled !== false,
    configured: Boolean(token),
    token,
    tokenSource,
    baseUrl: String(accountCfg.apiBaseUrl || "https://platform-api.max.ru"),
    config: accountCfg,
  };
}

function describeAccount(account: ResolvedMaxAccount): ChannelAccountSnapshot {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    tokenSource: account.tokenSource,
    baseUrl: account.baseUrl,
  };
}

export const maxPlugin: ChannelPlugin<ResolvedMaxAccount, MaxProbe> = {
  id: "max",
  meta: {
    id: "max",
    label: "MAX",
    selectionLabel: "MAX",
    docsPath: "https://dev.max.ru/docs-api",
    blurb: "MAX messenger (max.ru) channel plugin",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: true,
    blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.max"] },
  config: {
    listAccountIds: (cfg) => listMaxAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveMaxAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultMaxAccountId(cfg),
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => describeAccount(account),
    resolveAllowFrom: ({ cfg, accountId }) => readMaxAccountConfig(cfg, accountId).allowFrom,
    formatAllowFrom: ({ allowFrom }) => allowFrom.map((entry) => String(entry).trim()).filter(Boolean),
    resolveDefaultTo: ({ cfg, accountId }) => readMaxAccountConfig(cfg, accountId).defaultTo,
  },
  pairing: {
    idLabel: "maxUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^max:/i, "").trim(),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveMaxAccount(cfg);
      if (!account.token) {
        throw new Error("MAX bot token not configured");
      }
      const api = new MaxBotApi({
        token: account.token,
        apiBaseUrl: account.baseUrl,
      });
      await api.sendMessage({
        userId: Number(id),
        text: "✅ Доступ подтвержден. Можешь писать дальше.",
      });
    },
  },
  security: {
    resolveDmPolicy: ({ account, accountId }) => ({
      policy: account.config.dmPolicy || "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath:
        accountId && accountId !== DEFAULT_ACCOUNT_ID
          ? `channels.max.accounts.${accountId}.dmPolicy`
          : "channels.max.dmPolicy",
      allowFromPath:
        accountId && accountId !== DEFAULT_ACCOUNT_ID
          ? `channels.max.accounts.${accountId}.allowFrom`
          : "channels.max.allowFrom",
      approveHint: "Use: /allow max <userId>",
      normalizeEntry: (raw) => raw.replace(/^max:/i, "").trim(),
    }),
  },
  messaging: {
    normalizeTarget: (raw) => raw.replace(/^max:/i, "").trim(),
    targetResolver: {
      looksLikeId: (raw) => /^\d+$/.test(raw.trim()),
      hint: "<chatId>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getMaxRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveMaxAccount(cfg, accountId);
      if (!account.token) {
        throw new Error("MAX bot token not configured");
      }

      const api = new MaxBotApi({
        token: account.token,
        apiBaseUrl: account.baseUrl,
      });
      const result = await api.sendMessage({
        chatId: Number(to),
        text,
        format: "markdown",
      });

      return {
        channel: "max",
        messageId: result?.message?.body?.mid || `${Date.now()}`,
        ok: true,
      };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      enabled: snapshot.enabled ?? true,
      running: snapshot.running ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      baseUrl: snapshot.baseUrl ?? null,
      probe: snapshot.probe,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (!account.token) {
        return { ok: false, error: "no token" };
      }

      try {
        const api = new MaxBotApi({
          token: account.token,
          apiBaseUrl: account.baseUrl,
          timeoutMs,
        });
        const me = await api.getMe();
        return {
          ok: true,
          bot: {
            id: me.user_id,
            username: me.username,
            firstName: me.first_name,
          },
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...describeAccount(account),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      mode: "polling",
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.token) {
        throw new Error("MAX bot token not configured");
      }

      ctx.log?.info(`[${account.accountId}] starting MAX provider (${account.baseUrl})`);

      return monitorMaxProvider({
        token: account.token,
        apiBaseUrl: account.baseUrl,
        accountId: account.accountId,
        config: ctx.cfg,
        getStatus: ctx.getStatus,
        setStatus: ctx.setStatus,
        abortSignal: ctx.abortSignal,
      });
    },
  },
};
