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

echo "==> Generating DMG background (Amiga palette)"
swiftc -O -o "$WORK/dmg-background" "$SCRIPT_DIR/dmg-background.swift"
"$WORK/dmg-background" "$WORK"

APP_BASENAME="$(basename "$APP_PATH")"
SIZE_KB=$(( $(du -sk "$APP_PATH" | awk '{print $1}') + 20480 ))

echo "==> Creating read-write image (${SIZE_KB}K)"
RW_DMG="$WORK/index-rw.dmg"
hdiutil create -size "${SIZE_KB}k" -fs HFS+ -volname "$VOLUME_NAME" -o "$RW_DMG"

# Finder's AppleScript `tell disk` only resolves volumes mounted under
# /Volumes, so attach at the default location rather than a temp mountpoint.
hdiutil attach "$RW_DMG" -readwrite -noverify >/dev/null
MOUNT="/Volumes/$VOLUME_NAME"
[ -d "$MOUNT" ] || { echo "==> ERROR: expected mount at $MOUNT" >&2; exit 1; }

echo "==> Populating DMG"
ditto "$APP_PATH" "$MOUNT/$APP_BASENAME"
ln -s /Applications "$MOUNT/Applications"
mkdir -p "$MOUNT/.background"
cp "$WORK/dmg-background.png" "$MOUNT/.background/dmg-background.png"
cp "$WORK/dmg-background@2x.png" "$MOUNT/.background/dmg-background@2x.png"
chflags hidden "$MOUNT/.background"

echo "==> Styling Finder window"
attempt=0
until /usr/bin/osascript <<APPLESCRIPT
tell application "Finder"
    tell disk "${VOLUME_NAME}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {100, 100, 640, 480}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 128
        set background picture of viewOptions to file ".background:dmg-background.png"
        set position of item "${APP_BASENAME}" of container window to {140, 190}
        set position of item "Applications" of container window to {400, 190}
        close
        open
        update without registering applications
    end tell
end tell
APPLESCRIPT
do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 5 ]; then
        echo "==> ERROR: Finder styling failed after $attempt attempts" >&2
        exit 1
    fi
    sleep 2
done

sync
sleep 2
hdiutil detach "$MOUNT"
MOUNT=""

echo "==> Compressing to UDZO: $DMG_PATH"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$WORK/compressed.dmg"
mv -f "$WORK/compressed.dmg" "$DMG_PATH"

if [ "$SKIP_NOTARY" != "1" ]; then
    echo "==> Notarizing DMG"
    xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait
    xcrun stapler staple "$DMG_PATH"
    xcrun stapler validate "$DMG_PATH"
fi

echo "==> Done: $DMG_PATH"
