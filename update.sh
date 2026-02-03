#!/bin/bash
# Скрипт обновления российских расширений OpenClaw
# Использование: ~/.openclaw/openclaw-rus/update.sh

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

OPENCLAW_DIR="$HOME/.openclaw"
RUS_DIR="$OPENCLAW_DIR/openclaw-rus"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     OpenClaw RUS — Обновление          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo

# Проверка установки
if [ ! -d "$RUS_DIR" ]; then
    echo -e "${RED}Ошибка: OpenClaw RUS не установлен${NC}"
    echo "Установите: curl -fsSL https://raw.githubusercontent.com/yasg1988/openclaw-rus/main/install.sh | bash"
    exit 1
fi

# Шаг 1: Обновление репозитория
echo -e "${YELLOW}[1/3]${NC} Загрузка обновлений..."
cd "$RUS_DIR"
git fetch --quiet

# Проверка наличия обновлений
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u})

if [ "$LOCAL" = "$REMOTE" ]; then
    echo -e "${GREEN}Уже установлена последняя версия${NC}"
    exit 0
fi

git pull --quiet
echo -e "${GREEN}Обновления загружены${NC}"
echo

# Шаг 2: Обновление расширений
echo -e "${YELLOW}[2/3]${NC} Обновление расширений..."

for ext_dir in "$RUS_DIR/extensions/"*/; do
    ext_name=$(basename "$ext_dir")
    if [ -d "$OPENCLAW_DIR/extensions/$ext_name" ]; then
        echo "  → $ext_name"
        cp -r "$ext_dir"* "$OPENCLAW_DIR/extensions/$ext_name/"
        cd "$OPENCLAW_DIR/extensions/$ext_name" && npm install --silent 2>/dev/null || true
    fi
done

echo -e "${GREEN}Расширения обновлены${NC}"
echo

# Шаг 3: Обновление конфигов
echo -e "${YELLOW}[3/3]${NC} Обновление конфигурации..."
cp "$RUS_DIR/config/defaults-ru.json" "$OPENCLAW_DIR/workspace/"
cp "$RUS_DIR/config/SOUL.md" "$OPENCLAW_DIR/workspace/"
echo -e "${GREEN}Конфигурация обновлена${NC}"
echo

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Обновление завершено!              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo
echo -e "${YELLOW}Важно: Перезапустите OpenClaw Gateway для применения изменений:${NC}"
echo "  systemctl --user restart openclaw-gateway"
echo "  # или"
echo "  openclaw daemon restart"
