#!/usr/bin/env bash
# Sign, notarize, staple, and verify one final DMG. The candidate is not ready
# unless the explicit Accepted response and mounted-byte verification both pass.
set -euo pipefail
set +x

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=notarize-bundle.sh
source "$RELEASE_DIRECTORY/notarize-bundle.sh"

dmg_notary_error() {
  printf 'production DMG notarization refused: %s\n' "$1" >&2
  return 1
}

run_final_verification() {
  bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$1"
}

notarize_dmg_main() (
  [[ "$(uname -s)" == Darwin ]] || dmg_notary_error "macOS is required"
  [[ "$#" -eq 1 ]] || dmg_notary_error "usage: notarize-dmg.sh <final.dmg>"
  [[ -n "${CODESIGN_IDENTITY:-}" ]] \
    || dmg_notary_error "CODESIGN_IDENTITY is required in the protected signing context"
  [[ "$CODESIGN_IDENTITY" == Developer\ ID\ Application:* ]] \
    || dmg_notary_error "CODESIGN_IDENTITY must name a Developer ID Application identity"
  [[ -n "${NOTARYTOOL_PROFILE:-}" ]] \
    || dmg_notary_error "NOTARYTOOL_PROFILE is required in the protected notarization context"
  local dmg="$1" response
  [[ -f "$dmg" ]] || dmg_notary_error "DMG is missing"
  case "$(basename "$dmg")" in
    "Index-macOS-${INDEX_FIRST_PRODUCTION_VERSION}-universal.dmg"|\
    "IndexConnector-${INDEX_FIRST_PRODUCTION_VERSION}-universal.dmg") ;;
    *) dmg_notary_error "DMG filename is not an exact first-production candidate"; return 1 ;;
  esac
  for tool in codesign xcrun python3; do command -v "$tool" >/dev/null 2>&1 || dmg_notary_error "$tool is required"; done

  response="$(mktemp "${TMPDIR:-/tmp}/index-dmg-notary-response.XXXXXX.json")"
  trap 'rm -f "$response"' EXIT
  codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$dmg"
  codesign --verify --strict --verbose=2 "$dmg"
  xcrun notarytool submit "$dmg" \
    --keychain-profile "$NOTARYTOOL_PROFILE" --wait --output-format json >"$response"
  parse_accepted_status <"$response"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
  codesign --verify --strict --verbose=2 "$dmg"
  run_final_verification "$dmg"
  rm -f "$response"
  trap - EXIT
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then notarize_dmg_main "$@"; fi
