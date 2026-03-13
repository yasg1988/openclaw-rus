# OpenClaw RUS

**Российские расширения для OpenClaw** — персональный ИИ-ассистент с поддержкой VK, MAX, YandexGPT, GigaChat.

## Что это?

OpenClaw — это персональный ИИ-ассистент, который работает через Telegram, Discord и другие мессенджеры. Этот репозиторий добавляет поддержку российских сервисов:

- 📱 **VKонтакте** — общение с ассистентом через VK сообщения
- 💬 **MAX Messenger** — интеграция с мессенджером MAX (ex-ICQ New)
- 🤖 **YandexGPT** — использование моделей Яндекса как провайдера
- 🧠 **GigaChat** — использование GigaChat от Сбера как провайдера

## Статус расширений

| Расширение | Статус | Описание |
|------------|--------|----------|
| vkontakte | 🚧 В разработке | Канал для VK сообщений |
| max-messenger | ⚠️ MVP готов | Long polling, входящие сообщения, callback, ответы агента |
| yandexgpt-provider | 🚧 В разработке | Провайдер YandexGPT |
| gigachat-provider | 🚧 В разработке | Провайдер GigaChat |

## Установка

### Быстрая установка (одной командой)

```bash
curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash
```

Это установит OpenClaw и все российские расширения.

### Выборочная установка

```bash
# Только VKонтакте
curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash -s -- --with-vk

# Только YandexGPT
curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash -s -- --with-yandexgpt

# VK + GigaChat
curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash -s -- --with-vk --with-gigachat
```

### Флаги установки

| Флаг | Описание |
|------|----------|
| `--all-ru` | Установить все российские расширения (по умолчанию) |
| `--with-vk` | Установить только VKонтакте |
| `--with-max` | Установить только MAX Messenger |
| `--with-yandexgpt` | Установить только YandexGPT |
| `--with-gigachat` | Установить только GigaChat |
| `--skip-onboard` | Пропустить интерактивную настройку |

## Обновление

```bash
~/.openclaw/openclaw-rus/update.sh
```

Или скачать и запустить:

```bash
curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/update.sh | bash
```

## Настройка прокси

Если вы запускаете OpenClaw на российском VPS и нужен доступ к API OpenAI/Anthropic:

```bash
cd ~/.openclaw/openclaw-rus/proxy
docker-compose up -d
```

Затем в настройках OpenClaw укажите прокси:

```json
{
  "proxy": {
    "url": "http://localhost:8443"
  }
}
```

Подробнее см. [deploy/README.md](deploy/README.md).

## Деплой на VPS

См. [deploy/README.md](deploy/README.md) для инструкции по развёртыванию на VPS.

## MAX Messenger

Расширение `max-messenger` больше не является пустой заглушкой. Текущий MVP умеет:

- long polling через MAX Bot API;
- принимать `message_created`, `message_callback` и `bot_started`;
- маршрутизировать входящие сообщения в OpenClaw по account/session;
- отправлять и редактировать текстовые ответы агента обратно в MAX;
- использовать `allowFrom` и `dmPolicy` для базового контроля доступа.

Минимальный пример конфигурации канала:

```json
{
  "plugins": {
    "allowlist": ["max-messenger"]
  },
  "channels": {
    "max": {
      "enabled": true,
      "botToken": "MAX_BOT_TOKEN",
      "apiBaseUrl": "https://platform-api.max.ru",
      "dmPolicy": "pairing",
      "allowFrom": ["123456789"]
    }
  }
}
```

Ограничения текущей версии:

- пока нет полноценной работы с медиа и голосом;
- пока нет отдельного onboarding/setup flow;
- channel ориентирован на один bot token (`default` account).

## Структура проекта

```
openclaw-rus/
├── README.md           # Этот файл
├── LICENSE             # MIT лицензия
├── install.sh          # Скрипт установки
├── update.sh           # Скрипт обновления
├── extensions/         # Расширения OpenClaw
│   ├── vkontakte/      # Канал VKонтакте
│   ├── max-messenger/  # Канал MAX Messenger
│   ├── yandexgpt-provider/  # Провайдер YandexGPT
│   └── gigachat-provider/   # Провайдер GigaChat
├── config/             # Конфигурации
│   ├── defaults-ru.json    # Пресет для России
│   └── SOUL.md             # Личность агента
├── proxy/              # Прокси для API
│   └── docker-compose.yml
└── deploy/             # Инструкции по деплою
    └── README.md
```

## Лицензия

MIT — см. [LICENSE](LICENSE).

## Контрибьютинг

PR приветствуются! Особенно нужна помощь с:

- Реализацией VK API
- Реализацией MAX API
- Тестированием YandexGPT/GigaChat
- Документацией

## Связь

- Issues: https://github.com/yasg1988/openclaw-rus/issues
