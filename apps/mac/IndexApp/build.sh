#!/bin/bash
# Build index, System 6 into a native macOS .app bundle (WKWebView wrapper).
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="index"
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

# Signing identity. An ad-hoc signature (`--sign -`) has no stable identity: the
# app's code requirement is its exact binary hash, so every rebuild looks like a
# different application to macOS. That is fine for a local dev loop now that the
# API credential lives in a file rather than the login keychain (whose per-binary
# ACL is what used to re-prompt for the login password on every launch, see the
# CredentialStore block in Sources/main.swift).
#
# It is NOT fine for anything distributed. Shipping needs a Developer ID
# Application certificate, the hardened runtime, notarization, and the keychain
# restored. The prod checklist in Sources/main.swift has the full list.
#
# Set CODESIGN_IDENTITY to sign with a real identity when you have one.
IDENTITY="${CODESIGN_IDENTITY:-}"

if [ -n "${IDENTITY}" ] && security find-identity -v -p codesigning 2>/dev/null | grep -qF "${IDENTITY}"; then
    echo "==> Code signing as '${IDENTITY}'"
    codesign --force --deep --sign "${IDENTITY}" "${APP}"
else
    if [ -n "${IDENTITY}" ]; then
        echo "==> WARNING: CODESIGN_IDENTITY='${IDENTITY}' not found, falling back to ad-hoc"
    fi
    echo "==> Ad-hoc code signing (local dev only, not distributable)"
    codesign --force --deep --sign - "${APP}" || echo "   (codesign skipped/failed, app still runs locally)"
fi

echo "==> Done: ${APP}"
