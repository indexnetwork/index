#!/bin/bash
# Hot-reload development mode: watch src/ and rebuild Resources/index.html on changes
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="index"
DIST_APP="dist/${APP_NAME}.app"
RESOURCES="${DIST_APP}/Contents/Resources"

# Color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}==> Hot-reload development mode${NC}"
echo "Watching src/ for changes... Press Ctrl+C to stop."
echo ""

# Build once initially
echo -e "${GREEN}==> Initial build${NC}"
python3 assemble.py
if [ ! -d "$DIST_APP" ]; then
    echo -e "${YELLOW}Building app for first time (will take ~5s)...${NC}"
    mkdir -p "${DIST_APP}/Contents/MacOS" "${RESOURCES}"
    swiftc -O \
        -framework Cocoa -framework WebKit \
        -o "${DIST_APP}/Contents/MacOS/${APP_NAME}" \
        Sources/main.swift
    cp Info.plist "${DIST_APP}/Contents/Info.plist"
fi
cp Resources/index.html "${RESOURCES}/index.html"

# Launch app
if ! pgrep -l "index" > /dev/null; then
    echo -e "${YELLOW}Launching app...${NC}"
    open "$DIST_APP"
    sleep 2
fi

# Track the last modification time of src/
get_mtime() {
    find src -type f \( -name '*.jsx' -o -name '*.html' -o -name '*.css' -o -name '*.woff2' \) -exec stat -f "%m" {} \; | sort -rn | head -1
}

last_mtime=$(get_mtime)

while true; do
    sleep 1
    current_mtime=$(get_mtime)

    if [ "$current_mtime" != "$last_mtime" ]; then
        echo -e "${GREEN}✓ Changes detected, reassembling...${NC}"
        python3 assemble.py
        cp Resources/index.html "${RESOURCES}/index.html"
        echo -e "${YELLOW}Resources updated. Press Cmd+R in app to reload.${NC}"
        last_mtime=$current_mtime
    fi
done
