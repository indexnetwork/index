#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/link-host.sh"
source "$SCRIPT_DIR/provisioning-profile.sh"

APP_PATH="${APP_PATH:-dist/Index.app}"
PROFILE="${NOTARYTOOL_PROFILE:?set NOTARYTOOL_PROFILE to a local keychain profile}"
ARCHIVE="${ARCHIVE_PATH:-dist/index-notarize.zip}"

[ -d "$APP_PATH" ] || { echo "app not found: $APP_PATH" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
LINK_HOST="$(/usr/libexec/PlistBuddy -c 'Print :IndexDeepLinkHost' "$APP_PATH/Contents/Info.plist")"
validate_embedded_profile "$APP_PATH" "$LINK_HOST"
ditto -c -k --keepParent "$APP_PATH" "$ARCHIVE"
xcrun notarytool submit "$ARCHIVE" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"
