# Деплой OpenClaw на VPS

Инструкция по развёртыванию OpenClaw с российскими расширениями на VPS.

## Требования

- VPS с Ubuntu 22.04/24.04
- Минимум 1 GB RAM (рекомендуется 2 GB)
- 10 GB диска
- Доступ по SSH

## Быстрый деплой

```bash
# Подключаемся к серверу
ssh root@your-server-ip

# Устанавливаем OpenClaw с российскими расширениями
curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash
```

## Настройка прокси (если API заблокированы)

Если с вашего VPS нет доступа к API OpenAI/Anthropic:

### Вариант 1: Внешний SOCKS прокси

Если у вас есть SOCKS5 прокси (например, через SSH туннель или VPN):

```bash
# Установка hpts (HTTP Proxy to SOCKS)
npm install -g hpts

# Запуск (замените на ваш SOCKS прокси)
hpts -s your-socks-proxy:1080 -p 8118
```

Затем в конфиге OpenClaw:

```json
{
  "proxy": {
    "http": "http://127.0.0.1:8118",
    "https": "http://127.0.0.1:8118"
  }
}
```

### Вариант 2: Локальный nginx прокси

Если у вас есть доступ к API напрямую, но нужен прокси для приложения:

```bash
cd ~/.openclaw/openclaw-rus/proxy
docker-compose up -d
```

## Автозапуск

OpenClaw устанавливается как systemd user service:

```bash
# Статус
systemctl --user status openclaw-gateway

# Перезапуск
systemctl --user restart openclaw-gateway

# Логи
journalctl --user -u openclaw-gateway -f
```

## Обновление

```bash
# Обновление OpenClaw
openclaw update

# Обновление российских расширений
~/.openclaw/openclaw-rus/update.sh

# Перезапуск
systemctl --user restart openclaw-gateway
```

## Безопасность

Рекомендации по защите VPS:

1. **Отключите вход по паролю** — используйте только SSH ключи
2. **Настройте firewall** — откройте только нужные порты
3. **Установите fail2ban** — защита от брутфорса
4. **Обновляйте систему** — `apt update && apt upgrade`

## Troubleshooting

### OpenClaw не запускается

```bash
# Проверьте логи
journalctl --user -u openclaw-gateway -n 100

# Проверьте конфиг
openclaw config validate
```

### Нет доступа к API

```bash
# Проверьте доступ к API
curl -I https://api.anthropic.com

# Если блокируется — настройте прокси (см. выше)
```

### Telegram бот не отвечает

1. Проверьте токен бота в конфиге
2. Убедитесь что бот запущен: `/start` в Telegram
3. Проверьте логи на ошибки
