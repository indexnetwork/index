#!/usr/bin/env bash
# Packages the notarized dist/Index.app into a branded, notarized dist/Index.dmg.
# Run after ./notarize.sh. Refuses to package anything that is not a signed,
# stapled Developer ID build — there is no ad-hoc fallback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_PATH="${APP_PATH:-dist/Index.app}"
DMG_PATH="${DMG_PATH:-dist/Index.dmg}"
VOLUME_NAME="${VOLUME_NAME:-Index}"
SKIP_NOTARY="${SKIP_NOTARY:-0}"

if [ "$SKIP_NOTARY" != "1" ]; then
    PROFILE="${NOTARYTOOL_PROFILE:?set NOTARYTOOL_PROFILE to a local keychain profile (SKIP_NOTARY=1 exists only for CI packaging tests)}"
fi

[ -d "$APP_PATH" ] || { echo "app not found: $APP_PATH" >&2; exit 1; }

echo "==> Verifying signed, stapled app: $APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/index-dmg.XXXXXX")"
MOUNT=""
cleanup() {
    if [ -n "$MOUNT" ]; then
        hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK"
}
trap cleanup EXIT

# --- packaging pipeline (staging, Finder styling, UDZO convert) goes here ---

if [ "$SKIP_NOTARY" != "1" ]; then
    echo "==> Notarizing DMG"
    xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait
    xcrun stapler staple "$DMG_PATH"
    xcrun stapler validate "$DMG_PATH"
fi

echo "==> Done: $DMG_PATH"
