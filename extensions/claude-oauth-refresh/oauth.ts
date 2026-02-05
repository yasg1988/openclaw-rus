/**
 * Claude OAuth Token Refresh
 *
 * Обновление OAuth токенов для подписки Claude (Anthropic)
 * Использует тот же API что и Claude Code CLI
 */

// OAuth конфигурация Claude (из Claude Code CLI)
const OAUTH_CONFIG = {
  CLIENT_ID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  TOKEN_URL: "https://platform.claude.com/v1/oauth/token",
  SCOPES: ["user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers"],
};

export interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

export interface TokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresIn: number;
}

/**
 * Проверяет нужно ли обновить токен
 * @param expiresAt - время истечения в миллисекундах
 * @param bufferMinutes - буфер в минутах до истечения (по умолчанию 10)
 */
export function needsRefresh(expiresAt: number, bufferMinutes: number = 10): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return Date.now() + bufferMs >= expiresAt;
}

/**
 * Обновляет access token используя refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OAUTH_CONFIG.CLIENT_ID,
    scope: OAUTH_CONFIG.SCOPES.join(" "),
  });

  const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // Может вернуть новый refresh token
    expiresIn: data.expires_in,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Валидирует структуру credentials файла
 */
export function validateCredentials(data: unknown): data is ClaudeCredentials {
  if (!data || typeof data !== "object") return false;
  const creds = data as Record<string, unknown>;

  if (!creds.claudeAiOauth || typeof creds.claudeAiOauth !== "object") return false;
  const oauth = creds.claudeAiOauth as Record<string, unknown>;

  return (
    typeof oauth.accessToken === "string" &&
    typeof oauth.refreshToken === "string" &&
    typeof oauth.expiresAt === "number"
  );
}
