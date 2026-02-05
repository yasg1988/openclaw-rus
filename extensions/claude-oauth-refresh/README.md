# Claude OAuth Auto-Refresh

Автоматическое обновление OAuth токенов для подписки Claude (Anthropic) в OpenClaw.

## Проблема

При использовании подписки Claude (Max/Pro) через OAuth токены, access token истекает каждые ~8 часов. На ПК Claude Code CLI автоматически обновляет токены, но на VPS без CLI токены протухают и агент перестаёт работать.

## Решение

Этот плагин автоматически обновляет OAuth токены прямо внутри OpenClaw:
- Проверяет срок действия токена каждые 30 минут
- Если токен скоро истечёт - делает refresh через API Anthropic
- Обновляет токен во всех агентах OpenClaw

## Установка

### Шаг 1: Установите Claude Code CLI на ПК

```bash
# macOS/Linux
npm install -g @anthropic-ai/claude-code

# Windows
npm install -g @anthropic-ai/claude-code
```

### Шаг 2: Авторизуйтесь на ПК

```bash
claude /login
```

Откроется браузер, авторизуйтесь через ваш аккаунт Claude.

### Шаг 3: Скопируйте credentials на VPS

**Linux/macOS:**
```bash
scp ~/.claude/.credentials.json user@your-vps:~/.openclaw/claude-credentials.json
```

**Windows (PowerShell):**
```powershell
scp $env:USERPROFILE\.claude\.credentials.json user@your-vps:~/.openclaw/claude-credentials.json
```

### Шаг 4: Получите новую сессию на ПК

```bash
claude /login
```

Это создаст новую независимую сессию для ПК. Теперь VPS и ПК имеют разные сессии и не мешают друг другу.

### Шаг 5: Включите плагин в OpenClaw

```bash
openclaw plugins enable claude-oauth-refresh
```

### Шаг 6: Перезапустите OpenClaw

```bash
systemctl --user restart openclaw-gateway
```

## Проверка работы

Посмотрите логи:
```bash
journalctl --user -u openclaw-gateway -f | grep claude-oauth
```

Вы должны увидеть:
```
[claude-oauth-refresh] 🔄 Claude OAuth Auto-Refresh plugin loading...
[claude-oauth-refresh] ✅ Plugin loaded successfully
[claude-oauth-refresh]    Credentials: /root/.openclaw/claude-credentials.json
[claude-oauth-refresh]    Refresh interval: 30 min
[claude-oauth-refresh] Token still valid for 420 minutes
```

## Конфигурация (опционально)

Можно настроить путь к credentials и интервал проверки:

```bash
openclaw config set plugins.claude-oauth-refresh.credentialsPath "/custom/path/credentials.json"
openclaw config set plugins.claude-oauth-refresh.refreshIntervalMinutes 15
```

## Как это работает

1. При старте плагин загружает `~/.openclaw/claude-credentials.json`
2. Каждые 30 минут проверяет `expiresAt` токена
3. Если до истечения осталось меньше 10 минут - делает refresh
4. Новый `accessToken` записывается в `auth-profiles.json` всех агентов
5. Новый `refreshToken` сохраняется в credentials файл

## Важно

- **ПК и VPS работают параллельно** - после повторного `/login` на ПК у вас две независимые сессии
- **Не копируйте credentials повторно** - это "украдёт" сессию у VPS
- **Подписка одна, сессий несколько** - это нормально и разрешено Anthropic

## Устранение проблем

### "Credentials file not found"

Убедитесь что файл скопирован:
```bash
ls -la ~/.openclaw/claude-credentials.json
```

### "Token refresh failed"

Возможно refresh token устарел. Повторите шаги 2-4:
1. На ПК: `claude /login`
2. Скопируйте credentials на VPS
3. На ПК: `claude /login` снова

### Агент не отвечает после обновления токена

Перезапустите gateway:
```bash
systemctl --user restart openclaw-gateway
```
