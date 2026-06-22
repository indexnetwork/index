#!/bin/bash
# Build halo — System 6 into a native macOS .app bundle (WKWebView wrapper).
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="halo"
APP="dist/${APP_NAME}.app"
CONTENTS="${APP}/Contents"

echo "==> Assembling Resources/index.html from src/ (inlining libs + JSX)"
python3 assemble.py

echo "==> Cleaning previous build"
rm -rf dist
mkdir -p "${CONTENTS}/MacOS" "${CONTENTS}/Resources"

echo "==> Compiling Swift (host arch)"
swiftc -O \
    -framework Cocoa -framework WebKit \
    -o "${CONTENTS}/MacOS/${APP_NAME}" \
    Sources/main.swift

echo "==> Copying resources"
cp Info.plist "${CONTENTS}/Info.plist"
cp Resources/index.html "${CONTENTS}/Resources/index.html"

echo "==> Ad-hoc code signing"
codesign --force --deep --sign - "${APP}" || echo "   (codesign skipped/failed — app still runs locally)"

echo "==> Done: ${APP}"
