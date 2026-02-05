/**
 * Claude OAuth Auto-Refresh Plugin для OpenClaw
 *
 * Автоматически обновляет OAuth токены для подписки Claude (Anthropic)
 *
 * Использование:
 * 1. На ПК: установить Claude Code CLI, выполнить `/login`
 * 2. Скопировать credentials на VPS:
 *    scp ~/.claude/.credentials.json user@vps:~/.openclaw/claude-credentials.json
 * 3. На ПК: выполнить `/login` снова (получить новую сессию)
 * 4. Включить плагин в OpenClaw
 *
 * Плагин автоматически:
 * - Загружает credentials из ~/.openclaw/claude-credentials.json
 * - Проверяет срок действия токена каждые 30 минут
 * - Обновляет токен если он скоро истечёт
 * - Записывает новый accessToken в auth-profiles.json всех агентов
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  refreshAccessToken,
  needsRefresh,
  validateCredentials,
  type ClaudeCredentials,
} from "./oauth.js";

const PLUGIN_ID = "claude-oauth-refresh";
const DEFAULT_CREDENTIALS_PATH = join(homedir(), ".openclaw", "claude-credentials.json");
const OPENCLAW_AGENTS_DIR = join(homedir(), ".openclaw", "agents");
const DEFAULT_REFRESH_INTERVAL_MINUTES = 30;
const TOKEN_EXPIRY_BUFFER_MINUTES = 10;

interface PluginConfig {
  credentialsPath?: string;
  refreshIntervalMinutes?: number;
}

let refreshInterval: NodeJS.Timeout | null = null;
let currentConfig: PluginConfig = {};
let lastRefreshTime: number = 0;

/**
 * Загружает credentials из файла
 */
function loadCredentials(path: string): ClaudeCredentials | null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content);

    if (!validateCredentials(data)) {
      console.error(`[${PLUGIN_ID}] Invalid credentials format in ${path}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[${PLUGIN_ID}] Failed to load credentials:`, error);
    return null;
  }
}

/**
 * Сохраняет credentials в файл
 */
function saveCredentials(path: string, credentials: ClaudeCredentials): void {
  try {
    writeFileSync(path, JSON.stringify(credentials, null, 2), "utf-8");
  } catch (error) {
    console.error(`[${PLUGIN_ID}] Failed to save credentials:`, error);
  }
}

/**
 * Обновляет токен в auth-profiles.json агента
 */
function updateAgentAuthProfile(agentDir: string, newAccessToken: string): boolean {
  const authProfilePath = join(agentDir, "agent", "auth-profiles.json");

  try {
    if (!existsSync(authProfilePath)) {
      return false;
    }

    const content = readFileSync(authProfilePath, "utf-8");
    const authProfile = JSON.parse(content);

    let updated = false;

    // Обновляем все anthropic профили
    if (authProfile.profiles) {
      for (const [profileId, profile] of Object.entries(authProfile.profiles)) {
        const p = profile as { provider?: string; token?: string };
        if (p.provider === "anthropic" && p.token) {
          p.token = newAccessToken;
          updated = true;
        }
      }
    }

    if (updated) {
      writeFileSync(authProfilePath, JSON.stringify(authProfile, null, 2), "utf-8");
    }

    return updated;
  } catch (error) {
    console.error(`[${PLUGIN_ID}] Failed to update auth profile for ${agentDir}:`, error);
    return false;
  }
}

/**
 * Обновляет токены во всех агентах
 */
function updateAllAgents(newAccessToken: string): number {
  let updatedCount = 0;

  try {
    if (!existsSync(OPENCLAW_AGENTS_DIR)) {
      return 0;
    }

    const agents = readdirSync(OPENCLAW_AGENTS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const agent of agents) {
      const agentDir = join(OPENCLAW_AGENTS_DIR, agent);
      if (updateAgentAuthProfile(agentDir, newAccessToken)) {
        updatedCount++;
        console.log(`[${PLUGIN_ID}] Updated token for agent: ${agent}`);
      }
    }
  } catch (error) {
    console.error(`[${PLUGIN_ID}] Failed to update agents:`, error);
  }

  return updatedCount;
}

/**
 * Выполняет проверку и обновление токена
 */
async function checkAndRefreshToken(): Promise<void> {
  const credentialsPath = currentConfig.credentialsPath || DEFAULT_CREDENTIALS_PATH;

  const credentials = loadCredentials(credentialsPath);
  if (!credentials) {
    console.log(`[${PLUGIN_ID}] No credentials found at ${credentialsPath}`);
    return;
  }

  const { claudeAiOauth } = credentials;

  // Проверяем нужно ли обновление
  if (!needsRefresh(claudeAiOauth.expiresAt, TOKEN_EXPIRY_BUFFER_MINUTES)) {
    const expiresIn = Math.round((claudeAiOauth.expiresAt - Date.now()) / 1000 / 60);
    console.log(`[${PLUGIN_ID}] Token still valid for ${expiresIn} minutes`);
    return;
  }

  console.log(`[${PLUGIN_ID}] Token expiring soon, refreshing...`);

  try {
    const result = await refreshAccessToken(claudeAiOauth.refreshToken);

    // Обновляем credentials файл
    credentials.claudeAiOauth.accessToken = result.accessToken;
    credentials.claudeAiOauth.refreshToken = result.refreshToken;
    credentials.claudeAiOauth.expiresAt = result.expiresAt;
    saveCredentials(credentialsPath, credentials);

    // Обновляем токены во всех агентах
    const updatedAgents = updateAllAgents(result.accessToken);

    lastRefreshTime = Date.now();
    const expiresInMinutes = Math.round(result.expiresIn / 60);

    console.log(
      `[${PLUGIN_ID}] ✅ Token refreshed successfully! ` +
        `Expires in ${expiresInMinutes} min. ` +
        `Updated ${updatedAgents} agent(s).`
    );
  } catch (error) {
    console.error(`[${PLUGIN_ID}] ❌ Token refresh failed:`, error);
  }
}

/**
 * Запускает периодическую проверку токенов
 */
function startRefreshScheduler(intervalMinutes: number): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  // Первая проверка сразу при старте
  checkAndRefreshToken();

  // Периодическая проверка
  refreshInterval = setInterval(() => {
    checkAndRefreshToken();
  }, intervalMs);

  console.log(`[${PLUGIN_ID}] Refresh scheduler started (every ${intervalMinutes} min)`);
}

/**
 * Останавливает периодическую проверку
 */
function stopRefreshScheduler(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log(`[${PLUGIN_ID}] Refresh scheduler stopped`);
  }
}

const plugin = {
  id: PLUGIN_ID,
  name: "Claude OAuth Auto-Refresh",
  description: "Автоматическое обновление OAuth токенов для подписки Claude (Anthropic)",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      credentialsPath: {
        type: "string" as const,
        description: "Путь к файлу credentials (по умолчанию ~/.openclaw/claude-credentials.json)",
      },
      refreshIntervalMinutes: {
        type: "number" as const,
        description: "Интервал проверки в минутах (по умолчанию 30)",
      },
    },
  },

  register(api: { getConfig?: () => PluginConfig }) {
    console.log(`[${PLUGIN_ID}] 🔄 Claude OAuth Auto-Refresh plugin loading...`);

    // Получаем конфиг
    currentConfig = api.getConfig?.() || {};

    const credentialsPath = currentConfig.credentialsPath || DEFAULT_CREDENTIALS_PATH;
    const intervalMinutes = currentConfig.refreshIntervalMinutes || DEFAULT_REFRESH_INTERVAL_MINUTES;

    // Проверяем наличие credentials
    if (!existsSync(credentialsPath)) {
      console.log(`[${PLUGIN_ID}] ⚠️  Credentials file not found: ${credentialsPath}`);
      console.log(`[${PLUGIN_ID}] 📋 To set up:`);
      console.log(`[${PLUGIN_ID}]    1. On PC: Install Claude Code CLI and run /login`);
      console.log(`[${PLUGIN_ID}]    2. Copy credentials to VPS:`);
      console.log(`[${PLUGIN_ID}]       scp ~/.claude/.credentials.json user@vps:${credentialsPath}`);
      console.log(`[${PLUGIN_ID}]    3. On PC: Run /login again to get a new session`);
      console.log(`[${PLUGIN_ID}]    4. Restart OpenClaw gateway`);
      return;
    }

    // Запускаем scheduler
    startRefreshScheduler(intervalMinutes);

    console.log(`[${PLUGIN_ID}] ✅ Plugin loaded successfully`);
    console.log(`[${PLUGIN_ID}]    Credentials: ${credentialsPath}`);
    console.log(`[${PLUGIN_ID}]    Refresh interval: ${intervalMinutes} min`);
  },

  unload() {
    stopRefreshScheduler();
    console.log(`[${PLUGIN_ID}] Plugin unloaded`);
  },
};

export default plugin;
