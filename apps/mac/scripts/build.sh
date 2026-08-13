#!/bin/bash
# Build index, System 6 into a native macOS .app bundle (WKWebView wrapper).
set -euo pipefail

MAC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MAC_ROOT"

if [ "${1:-}" = "--fixture" ] && [ "${2:-}" = "NativeAPIStreamDelegateFixture" ] && [ "$#" -eq 2 ]; then
    OUT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/native-api-stream-delegate-fixture"
    swiftc -parse-as-library -framework Foundation -framework Security -framework WebKit \
        Security/Sources/IndexKeychainStore.swift \
        Sources/OwnerCredentialStore.swift \
        Sources/NativeAPIRequestBridge.swift \
        Tests/NativeAPIStreamDelegateFixture.swift \
        -o "$OUT"
    "$OUT"
    exit 0
fi
if [ "${1:-}" = "--fixture" ] && [ "${2:-}" = "NativeAPIBodyValidationFixture" ] && [ "$#" -eq 2 ]; then
    OUT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/native-api-body-validation-fixture"
    swiftc -parse-as-library -framework Foundation -framework Security -framework WebKit \
        Security/Sources/IndexKeychainStore.swift \
        Sources/OwnerCredentialStore.swift \
        Sources/NativeAPIRequestBridge.swift \
        Tests/NativeAPIBodyValidationFixture.swift \
        -o "$OUT"
    "$OUT"
    exit 0
fi
if [ "${1:-}" = "--fixture" ] && [ "${2:-}" = "NativeAPIQuarantineFixture" ] && [ "$#" -eq 2 ]; then
    OUT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/native-api-quarantine-fixture"
    swiftc -parse-as-library -DINDEX_NATIVE_FIXTURE -framework Foundation -framework Security -framework WebKit \
        Security/Sources/IndexKeychainStore.swift \
        Sources/OwnerCredentialStore.swift \
        Sources/NativeAPIRequestBridge.swift \
        Tests/NativeAPIQuarantineFixture.swift \
        -o "$OUT"
    "$OUT"
    exit 0
fi
if [ "$#" -ne 0 ]; then
    echo "usage: $0 [--fixture NativeAPIStreamDelegateFixture|--fixture NativeAPIBodyValidationFixture|--fixture NativeAPIQuarantineFixture]" >&2
    exit 64
fi

source "$MAC_ROOT/scripts/link-host.sh"
source "$MAC_ROOT/scripts/provisioning-profile.sh"
LINK_HOST="$(resolve_link_host)"
IDENTITY="${CODESIGN_IDENTITY:-}"
PROFILE="${PROVISIONING_PROFILE:-}"
if [ -n "$IDENTITY" ] && [ -z "$PROFILE" ]; then
    echo "==> ERROR: set PROVISIONING_PROFILE for Developer ID signing" >&2
    exit 1
fi
APP_KEYCHAIN_GROUP=""
if [ -n "$IDENTITY" ]; then
    IDENTIFIER_PREFIX="${INDEX_APP_IDENTIFIER_PREFIX:-}"
    if [[ ! "$IDENTIFIER_PREFIX" =~ ^[A-Za-z0-9]+\.$ ]]; then
        echo "==> ERROR: INDEX_APP_IDENTIFIER_PREFIX must be set with a trailing period for Developer ID signing" >&2
        exit 1
    fi
    APP_KEYCHAIN_GROUP="${IDENTIFIER_PREFIX}network.index.system6.owner-credentials"
fi

APP_NAME="Index"
APP="dist/${APP_NAME}.app"
CONTENTS="${APP}/Contents"

echo "==> Assembling Resources/index.html from src/ (inlining libs + JSX)"
python3 scripts/assemble.py

echo "==> Cleaning previous build"
rm -rf dist
mkdir -p "${CONTENTS}/MacOS" "${CONTENTS}/Resources"

echo "==> Compiling Swift (host arch)"
SWIFT_DEFINES=()
if [ "${INDEX_DEVELOPMENT_BUILD:-0}" = "1" ]; then
    SWIFT_DEFINES+=("-DINDEX_DEVELOPMENT_BUILD")
fi
swiftc -Onone ${SWIFT_DEFINES[@]+"${SWIFT_DEFINES[@]}"} \
    -target "$(uname -m)-apple-macosx13.0" \
    -framework Cocoa -framework WebKit -framework Network -framework Security \
    -o "${CONTENTS}/MacOS/${APP_NAME}" \
    Security/Sources/IndexKeychainStore.swift \
    Sources/*.swift

echo "==> Copying resources"
cp Info.plist "${CONTENTS}/Info.plist"
if [ -n "$APP_KEYCHAIN_GROUP" ]; then
    /usr/libexec/PlistBuddy -c "Set :IndexOwnerKeychainAccessGroup ${APP_KEYCHAIN_GROUP}" "${CONTENTS}/Info.plist"
fi
/usr/libexec/PlistBuddy -c "Delete :IndexDeepLinkHost" "${CONTENTS}/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :IndexDeepLinkHost string ${LINK_HOST}" "${CONTENTS}/Info.plist"
cp Resources/index.html "${CONTENTS}/Resources/index.html"
cp Resources/AppIcon.icns "${CONTENTS}/Resources/AppIcon.icns"
cp Resources/Assets.car "${CONTENTS}/Resources/Assets.car"

# Ad-hoc builds intentionally receive no Keychain access group and remain signed
# out. Developer ID builds embed the profile-authorized app-only owner group.
# Set CODESIGN_IDENTITY and the validated profile inputs for usable sign-in.

# Associated domains (universal links). The entitlement is only honoured for a
# Developer ID-signed, notarized build whose team id matches the appIDs in the
# apple-app-site-association served by index.network. A real identity must carry
# it (strict below); ad-hoc must never be broken by it, see the retry there.
ENTITLEMENTS="$(mktemp "${TMPDIR:-/tmp}/index-entitlements.XXXXXX.plist")"
trap 'rm -f "$ENTITLEMENTS"' EXIT
write_associated_domains_entitlements "$LINK_HOST" "$ENTITLEMENTS" "$APP_KEYCHAIN_GROUP"

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
        "$PROFILE" "$CONTENTS" "$IDENTITY" "network.index.system6" \
        "$LINK_HOST" "$APP_KEYCHAIN_GROUP"
    codesign --force --deep --options runtime --entitlements "${ENTITLEMENTS}" --sign "${IDENTITY}" "${APP}"
    validate_embedded_profile "${APP}" "$LINK_HOST"
else
    sign_ad_hoc
fi

echo "==> Done: ${APP}"
