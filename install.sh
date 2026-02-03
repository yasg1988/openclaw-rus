#!/bin/bash
# Скрипт установки OpenClaw с российскими расширениями
# Использование: curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Настройки по умолчанию
SKIP_ONBOARD=false
INSTALL_VK=false
INSTALL_MAX=false
INSTALL_YANDEXGPT=false
INSTALL_GIGACHAT=false
INSTALL_ALL=true

# Парсинг аргументов
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-onboard)
            SKIP_ONBOARD=true
            shift
            ;;
        --all-ru)
            INSTALL_ALL=true
            shift
            ;;
        --with-vk)
            INSTALL_VK=true
            INSTALL_ALL=false
            shift
            ;;
        --with-max)
            INSTALL_MAX=true
            INSTALL_ALL=false
            shift
            ;;
        --with-yandexgpt)
            INSTALL_YANDEXGPT=true
            INSTALL_ALL=false
            shift
            ;;
        --with-gigachat)
            INSTALL_GIGACHAT=true
            INSTALL_ALL=false
            shift
            ;;
        *)
            echo -e "${RED}Неизвестный аргумент: $1${NC}"
            exit 1
            ;;
    esac
done

# Если выбрана установка всех расширений
if [ "$INSTALL_ALL" = true ]; then
    INSTALL_VK=true
    INSTALL_MAX=true
    INSTALL_YANDEXGPT=true
    INSTALL_GIGACHAT=true
fi

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     OpenClaw RUS — Установка           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo

# Шаг 1: Установка OpenClaw
echo -e "${YELLOW}[1/4]${NC} Установка OpenClaw..."
if command -v openclaw &> /dev/null; then
    echo -e "${GREEN}OpenClaw уже установлен${NC}"
else
    curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
    echo -e "${GREEN}OpenClaw установлен${NC}"
fi
echo

# Шаг 2: Клонирование openclaw-rus
echo -e "${YELLOW}[2/4]${NC} Загрузка российских расширений..."
OPENCLAW_DIR="$HOME/.openclaw"
RUS_DIR="$OPENCLAW_DIR/openclaw-rus"

if [ -d "$RUS_DIR" ]; then
    echo "Обновление существующей установки..."
    cd "$RUS_DIR" && git pull --quiet
else
    git clone --quiet https://github.com/yasg1988/openclaw-rus.git "$RUS_DIR"
fi
echo -e "${GREEN}Расширения загружены${NC}"
echo

# Шаг 3: Копирование расширений
echo -e "${YELLOW}[3/4]${NC} Установка расширений..."
mkdir -p "$OPENCLAW_DIR/extensions"

if [ "$INSTALL_VK" = true ]; then
    echo "  → VKонтакте"
    cp -r "$RUS_DIR/extensions/vkontakte" "$OPENCLAW_DIR/extensions/"
    cd "$OPENCLAW_DIR/extensions/vkontakte" && npm install --silent 2>/dev/null || true
fi

if [ "$INSTALL_MAX" = true ]; then
    echo "  → MAX Messenger"
    cp -r "$RUS_DIR/extensions/max-messenger" "$OPENCLAW_DIR/extensions/"
    cd "$OPENCLAW_DIR/extensions/max-messenger" && npm install --silent 2>/dev/null || true
fi

if [ "$INSTALL_YANDEXGPT" = true ]; then
    echo "  → YandexGPT"
    cp -r "$RUS_DIR/extensions/yandexgpt-provider" "$OPENCLAW_DIR/extensions/"
    cd "$OPENCLAW_DIR/extensions/yandexgpt-provider" && npm install --silent 2>/dev/null || true
fi

if [ "$INSTALL_GIGACHAT" = true ]; then
    echo "  → GigaChat"
    cp -r "$RUS_DIR/extensions/gigachat-provider" "$OPENCLAW_DIR/extensions/"
    cd "$OPENCLAW_DIR/extensions/gigachat-provider" && npm install --silent 2>/dev/null || true
fi

echo -e "${GREEN}Расширения установлены${NC}"
echo

# Шаг 4: Копирование конфигов
echo -e "${YELLOW}[4/4]${NC} Настройка конфигурации..."
mkdir -p "$OPENCLAW_DIR/workspace"
cp "$RUS_DIR/config/defaults-ru.json" "$OPENCLAW_DIR/workspace/"
cp "$RUS_DIR/config/SOUL.md" "$OPENCLAW_DIR/workspace/"
echo -e "${GREEN}Конфигурация скопирована${NC}"
echo

# Запуск onboard если не пропущен
if [ "$SKIP_ONBOARD" = false ]; then
    echo -e "${BLUE}Запуск настройки OpenClaw...${NC}"
    openclaw onboard --install-daemon
else
    echo -e "${YELLOW}Настройка пропущена (--skip-onboard)${NC}"
    echo "Запустите вручную: openclaw onboard --install-daemon"
fi

echo
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Установка завершена!               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo
echo "Для обновления расширений: ~/.openclaw/openclaw-rus/update.sh"
echo "Документация: https://github.com/yasg1988/openclaw-rus"
