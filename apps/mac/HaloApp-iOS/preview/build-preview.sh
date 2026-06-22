#!/bin/bash
# Build the macOS preview shell (iPhone-sized WKWebView) so the mobile UI can be
# seen without Xcode / the iOS SDK. Run from anywhere; paths are resolved here.
set -euo pipefail
cd "$(dirname "$0")/.."   # HaloApp-iOS root

echo "==> Assembling Resources/index.html"
python3 assemble.py

APP="preview/dist/index-preview.app"
CONTENTS="${APP}/Contents"
echo "==> Cleaning previous preview build"
rm -rf preview/dist
mkdir -p "${CONTENTS}/MacOS" "${CONTENTS}/Resources"

echo "==> Compiling preview shell (host arch, macOS SDK)"
swiftc -O -framework Cocoa -framework WebKit \
    -o "${CONTENTS}/MacOS/index-preview" \
    preview/main.swift

cat > "${CONTENTS}/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>index-preview</string>
  <key>CFBundleIdentifier</key><string>network.index.halo.pocket.preview</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>index-preview</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

cp Resources/index.html "${CONTENTS}/Resources/index.html"
codesign --force --deep --sign - "${APP}" 2>/dev/null || echo "   (codesign skipped)"

echo "==> Done: ${APP}"
echo "    open ${APP}"
