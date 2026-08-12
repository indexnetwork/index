#!/usr/bin/env bash
# Compatibility entrypoint for the production Mac release pipeline.
set -euo pipefail
set +x

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MAC_DIRECTORY="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly RELEASE_DIRECTORY="$MAC_DIRECTORY/release"
readonly SIGNED_DIRECTORY="${SIGNED_DIRECTORY:-$MAC_DIRECTORY/dist/signed}"
readonly FINAL_DIRECTORY="${FINAL_DIRECTORY:-$MAC_DIRECTORY/dist/final}"

# ARCHIVE_PATH is retained as a recognized legacy input, but production now
# owns its temporary submission archive and always removes it.
if [[ -n "${ARCHIVE_PATH:-}" ]]; then
  printf 'ARCHIVE_PATH is no longer accepted; submission archives are temporary\n' >&2
  exit 1
fi
: "${NOTARYTOOL_PROFILE:?set NOTARYTOOL_PROFILE to a local keychain profile}"
# APP_PATH compatibility: legacy callers may request one inner bundle only.
# Production release callers omit it and receive the complete exact pipeline.
if [[ -n "${APP_PATH:-}" ]]; then
  exec bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$APP_PATH"
fi

: "${INDEX_RELEASE_VERSION:?set INDEX_RELEASE_VERSION to the approved release version}"
mkdir -p "$FINAL_DIRECTORY"
bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/Index.app"
bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/IndexConnector.app"

bash "$RELEASE_DIRECTORY/create-dmg.sh" \
  "$SIGNED_DIRECTORY/Index.app" \
  "$FINAL_DIRECTORY/Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg"
bash "$RELEASE_DIRECTORY/create-dmg.sh" \
  "$SIGNED_DIRECTORY/IndexConnector.app" \
  "$FINAL_DIRECTORY/IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg"

bash "$RELEASE_DIRECTORY/notarize-dmg.sh" \
  "$FINAL_DIRECTORY/Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg"
bash "$RELEASE_DIRECTORY/notarize-dmg.sh" \
  "$FINAL_DIRECTORY/IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg"

# Mounted-byte verification is also performed inside notarize-dmg.sh after
# stapling. These explicit calls preserve a visible compatibility contract.
bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" \
  "$FINAL_DIRECTORY/Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg"
bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" \
  "$FINAL_DIRECTORY/IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg"
