#!/bin/bash
# Build "index — pocket": the mobile (iOS) WKWebView wrapper.
#
# Mirrors HaloApp/build.sh, but targets iOS. Because iOS code needs the iOS SDK,
# this requires a full Xcode install (the Command Line Tools alone ship only the
# macOS SDK). With only CLT present the script assembles the web bundle and then
# explains what's missing, so the React layer is still buildable/inspectable.
#
# Usage:
#   ./build.sh            assemble + build for the iOS Simulator (arm64), then
#                         install & launch on the booted simulator if there is one
#   ./build.sh device     assemble + build an unsigned device binary (you must
#                         sign it with your own identity/profile to run on hardware)
#   ./build.sh assemble   just (re)assemble Resources/index.html
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="index"
MODE="${1:-sim}"

echo "==> Assembling Resources/index.html from src/ (inlining libs + JSX)"
python3 assemble.py

if [ "$MODE" = "assemble" ]; then
    echo "==> Done (assemble only)."
    exit 0
fi

# --- toolchain check: need full Xcode + iOS SDK, not just CLT ---
DEVELOPER_DIR="$(xcode-select -p 2>/dev/null || true)"
if ! xcrun --sdk iphonesimulator --show-sdk-path >/dev/null 2>&1; then
    cat <<EOF

==> iOS SDK not found.
    The web bundle was assembled to Resources/index.html, but compiling the
    iOS wrapper needs a full Xcode install (current developer dir: ${DEVELOPER_DIR:-none}).

    To finish the native build:
      1. Install Xcode from the App Store.
      2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
      3. Re-run ./build.sh

    To preview the mobile UI right now without Xcode, use the macOS preview shell:
      ./preview/build-preview.sh && open preview/dist/index-preview.app
EOF
    exit 1
fi

APP="dist/${APP_NAME}.app"
echo "==> Cleaning previous build"
rm -rf dist
mkdir -p "${APP}"

if [ "$MODE" = "device" ]; then
    SDK_NAME="iphoneos"
    TARGET="arm64-apple-ios14.0"
else
    SDK_NAME="iphonesimulator"
    TARGET="arm64-apple-ios14.0-simulator"
fi
SDK_PATH="$(xcrun --sdk ${SDK_NAME} --show-sdk-path)"

echo "==> Compiling Swift for ${SDK_NAME} (${TARGET})"
xcrun -sdk "${SDK_NAME}" swiftc -O \
    -target "${TARGET}" \
    -sdk "${SDK_PATH}" \
    -framework UIKit -framework WebKit \
    -o "${APP}/${APP_NAME}" \
    Sources/main.swift

echo "==> Copying resources"
cp Info.plist "${APP}/Info.plist"
cp Resources/index.html "${APP}/index.html"

echo "==> Ad-hoc code signing"
codesign --force --sign - "${APP}" || echo "   (codesign skipped/failed)"

echo "==> Built: ${APP}"

if [ "$MODE" = "sim" ]; then
    if xcrun simctl list devices booted 2>/dev/null | grep -q "(Booted)"; then
        echo "==> Installing on the booted simulator"
        xcrun simctl install booted "${APP}"
        BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "${APP}/Info.plist")"
        xcrun simctl launch booted "${BUNDLE_ID}" || true
        echo "==> Launched ${BUNDLE_ID}"
    else
        echo "==> No booted simulator. Boot one with:"
        echo "      open -a Simulator"
        echo "    then re-run ./build.sh (or: xcrun simctl install booted ${APP})"
    fi
fi
