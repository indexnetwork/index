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

# Associated domains (universal links). The entitlement is only honoured for a
# Developer ID-signed, notarized build whose team id matches the appIDs in the
# apple-app-site-association served by index.network. A real identity must carry
# it (strict below); ad-hoc must never be broken by it, see the retry there.
ENTITLEMENTS="IndexApp.entitlements"

if [ -n "${IDENTITY}" ] && security find-identity -v -p codesigning 2>/dev/null | grep -qF "${IDENTITY}"; then
    echo "==> Code signing as '${IDENTITY}'"
    codesign --force --deep --entitlements "${ENTITLEMENTS}" --sign "${IDENTITY}" "${APP}"
else
    if [ -n "${IDENTITY}" ]; then
        echo "==> WARNING: CODESIGN_IDENTITY='${IDENTITY}' not found, falling back to ad-hoc"
    fi
    echo "==> Ad-hoc code signing (local dev only, not distributable)"
    # associated-domains is profile-backed, so codesign can reject it outright
    # when there is no provisioning profile. Leaving the bundle unsigned is
    # worse than signing it without the entitlement (on Apple Silicon an
    # unsigned binary is killed at launch), so retry bare rather than give up.
    if ! codesign --force --deep --entitlements "${ENTITLEMENTS}" --sign - "${APP}"; then
        if codesign --force --deep --sign - "${APP}"; then
            echo "==> WARNING: codesign rejected ${ENTITLEMENTS} (associated-domains needs a"
            echo "    provisioning profile), so this bundle is signed ad-hoc WITHOUT it."
        else
            echo "   (codesign skipped/failed, app still runs locally)"
        fi
    fi
    echo "==> WARNING: universal links (https://index.network/o|u|c/...) will NOT open"
    echo "    this build. They need a Developer ID-signed, notarized app plus an"
    echo "    apple-app-site-association listing <TEAM_ID>.network.index.system6."
    echo "    Use 'open index://o/<id>' to exercise deep links locally."
fi

echo "==> Done: ${APP}"
