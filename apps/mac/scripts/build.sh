#!/bin/bash
# Build index, System 6 into a native macOS .app bundle (WKWebView wrapper).
set -euo pipefail

MAC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MAC_ROOT"

source "$MAC_ROOT/scripts/link-host.sh"
source "$MAC_ROOT/scripts/provisioning-profile.sh"
LINK_HOST="$(resolve_link_host)"
IDENTITY="${CODESIGN_IDENTITY:-}"
PROFILE="${PROVISIONING_PROFILE:-}"
if [ -n "$IDENTITY" ] && [ -z "$PROFILE" ]; then
    echo "==> ERROR: set PROVISIONING_PROFILE for Developer ID signing" >&2
    exit 1
fi

APP_NAME="Index"
APP="dist/${APP_NAME}.app"
CONTENTS="${APP}/Contents"

echo "==> Assembling Resources/index.html from src/ (inlining libs + JSX)"
python3 scripts/assemble.py

echo "==> Cleaning previous build"
rm -rf dist
mkdir -p "${CONTENTS}/MacOS" "${CONTENTS}/Resources"

ARCH="$(uname -m)"
DEPLOY_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
echo "==> Compiling Swift (${ARCH}, macosx${DEPLOY_TARGET})"
swiftc -Onone \
    -target "${ARCH}-apple-macosx${DEPLOY_TARGET}" \
    -framework Cocoa -framework WebKit \
    -o "${CONTENTS}/MacOS/${APP_NAME}" \
    Sources/*.swift

echo "==> Copying resources"
cp Info.plist "${CONTENTS}/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :IndexDeepLinkHost" "${CONTENTS}/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :IndexDeepLinkHost string ${LINK_HOST}" "${CONTENTS}/Info.plist"
cp Resources/index.html "${CONTENTS}/Resources/index.html"
cp Resources/AppIcon.icns "${CONTENTS}/Resources/AppIcon.icns"
cp Resources/Assets.car "${CONTENTS}/Resources/Assets.car"

ENTITLEMENTS="$(mktemp "${TMPDIR:-/tmp}/index-entitlements.XXXXXX.plist")"
trap 'rm -f "$ENTITLEMENTS"' EXIT
write_associated_domains_entitlements "$LINK_HOST" "$ENTITLEMENTS"

sign_ad_hoc() {
    echo "==> Ad-hoc code signing (local dev only, not distributable)"
    codesign --force --deep --sign - "${APP}" 2>&1 | grep -v "replacing existing signature" || true
    echo "==> WARNING: universal links (https://${LINK_HOST}/o|u|c/...) will NOT open"
    echo "    this build. They need a Developer ID-signed, notarized app plus an"
    echo "    apple-app-site-association listing <TEAM_ID>.network.index.system6."
    echo "    Use 'open index://o/<id>' to exercise deep links locally."
}

if [ -n "${IDENTITY}" ]; then
    if ! security find-identity -v -p codesigning 2>/dev/null | grep -qF "${IDENTITY}"; then
        echo "==> ERROR: requested CODESIGN_IDENTITY was not found" >&2
        exit 1
    fi
    if [[ "${IDENTITY}" != Developer\ ID\ Application:* ]]; then
        echo "==> ERROR: CODESIGN_IDENTITY must be a Developer ID Application identity" >&2
        exit 1
    fi
    echo "==> Code signing as '${IDENTITY}' for ${LINK_HOST}"
    embed_provisioning_profile \
        "$PROFILE" "$CONTENTS" "$IDENTITY" "network.index.system6" "$LINK_HOST"
    codesign --force --deep --options runtime --entitlements "${ENTITLEMENTS}" --sign "${IDENTITY}" "${APP}"
else
    sign_ad_hoc
fi

echo "==> Done: ${APP}"
