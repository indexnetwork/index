#!/usr/bin/env bash
# Compatibility entrypoint and atomic private release-set orchestrator.
set -euo pipefail
set +x
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MAC_DIRECTORY="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly RELEASE_DIRECTORY="$MAC_DIRECTORY/release"
readonly SIGNED_DIRECTORY="${SIGNED_DIRECTORY:-$MAC_DIRECTORY/dist/signed}"
readonly FINAL_DIRECTORY="${FINAL_DIRECTORY:-$MAC_DIRECTORY/dist/final}"
[[ -z "${ARCHIVE_PATH:-}" ]] || { echo 'ARCHIVE_PATH is no longer accepted' >&2; exit 1; }
: "${NOTARYTOOL_PROFILE:?set NOTARYTOOL_PROFILE}"
if [[ -n "${APP_PATH:-}" ]]; then exec bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$APP_PATH"; fi
: "${INDEX_RELEASE_VERSION:?set INDEX_RELEASE_VERSION}"

promote_release_set() {
  local private_set="$1" destination="$2"
  [[ ! -e "$destination" ]] || { echo "refusing to replace existing immutable release set" >&2; return 1; }
  # private_set is created in destination's parent, so rename is one same-volume
  # atomic operation: neither exact filename is visible before every gate passes.
  mv "$private_set" "$destination"
}
final_parent="$(dirname "$FINAL_DIRECTORY")"
mkdir -p "$final_parent"
[[ ! -e "$FINAL_DIRECTORY" ]] || { echo 'refusing to replace existing immutable release set' >&2; exit 1; }
transaction="$(mktemp -d "$final_parent/.index-final-transaction.XXXXXX")"
trap 'rm -rf "$transaction"' EXIT
app_dmg="$transaction/Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg"
connector_dmg="$transaction/IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg"

bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/Index.app"
bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/IndexConnector.app"
bash "$RELEASE_DIRECTORY/create-dmg.sh" "$SIGNED_DIRECTORY/Index.app" "$app_dmg"
bash "$RELEASE_DIRECTORY/create-dmg.sh" "$SIGNED_DIRECTORY/IndexConnector.app" "$connector_dmg"
bash "$RELEASE_DIRECTORY/notarize-dmg.sh" "$app_dmg"
bash "$RELEASE_DIRECTORY/notarize-dmg.sh" "$connector_dmg"
bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$app_dmg"
bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$connector_dmg"
trap - EXIT
promote_release_set "$transaction" "$FINAL_DIRECTORY"
