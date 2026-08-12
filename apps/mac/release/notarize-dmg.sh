#!/usr/bin/env bash
# Sign, notarize, staple, and mounted-verify a private candidate DMG.
set -euo pipefail
set +x
readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$RELEASE_DIRECTORY/notarize-bundle.sh"
source "$NOTARY_MAC_DIRECTORY/IndexApp/provisioning-profile.sh"
dmg_notary_error() { printf 'production DMG notarization refused: %s\n' "$1" >&2; return 1; }
sha256_dmg() { shasum -a 256 "$1" | awk '{print $1}'; }
require_same_digest() { [[ "$(sha256_dmg "$1")" == "$2" ]] || dmg_notary_error "$3 bytes changed unexpectedly"; }
run_final_verification() { bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$1"; }
verify_mounted_candidate() { bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$1"; }

validate_production_identity() {
  local identity="$1" team
  [[ "$identity" == Developer\ ID\ Application:* ]] || dmg_notary_error "identity is not Developer ID Application"
  security find-identity -v -p codesigning 2>/dev/null | grep -qF "$identity" || dmg_notary_error "identity is unavailable"
  team="$(certificate_team_id "$identity")" || dmg_notary_error "could not derive certificate Team ID"
  [[ "$team" == "LMQ3XNXLAD" ]] || dmg_notary_error "certificate Team ID does not match production"
}
verify_disk_image_signature() {
  local dmg="$1" details
  codesign --verify --strict "$dmg" || dmg_notary_error "DMG is unsigned or signature invalid"
  details="$(codesign -dvv "$dmg" 2>&1)" || dmg_notary_error "DMG signature details unavailable"
  grep -Fq 'Authority=Developer ID Application:' <<<"$details" || dmg_notary_error "DMG is not Developer ID signed"
  grep -Fqx 'TeamIdentifier=LMQ3XNXLAD' <<<"$details" || dmg_notary_error "DMG Team ID does not match production"
  bash -c 'set -euo pipefail; source "$1"; validate_secure_timestamp "$2"' \
    _ "$RELEASE_DIRECTORY/verify-signatures.sh" "$details" \
    || dmg_notary_error "DMG secure timestamp is missing or malformed"
  # Disk images do not carry a Hardened Runtime CodeDirectory contract.
}

notarize_dmg_main() (
  [[ "$(uname -s)" == Darwin ]] || dmg_notary_error "macOS is required"; [[ "$#" -eq 1 ]] || dmg_notary_error "usage"
  local dmg="$1" response unsigned_digest signed_digest stapled_digest
  [[ -f "$dmg" && ! -L "$dmg" ]] || dmg_notary_error "DMG missing or linked"
  case "$(basename "$dmg")" in Index-macOS-1.0.0-universal.dmg|IndexConnector-1.0.0-universal.dmg);; *) dmg_notary_error "unapproved filename"; return 1;; esac
  [[ -n "${CODESIGN_IDENTITY:-}" && -n "${NOTARYTOOL_PROFILE:-}" ]] || dmg_notary_error "protected inputs required"
  for t in codesign security xcrun python3 shasum hdiutil; do command -v "$t" >/dev/null || dmg_notary_error "$t required"; done
  validate_production_identity "$CODESIGN_IDENTITY"
  unsigned_digest="$(sha256_dmg "$dmg")"; verify_mounted_candidate "$dmg"; require_same_digest "$dmg" "$unsigned_digest" unsigned
  codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$dmg"; verify_disk_image_signature "$dmg"
  signed_digest="$(sha256_dmg "$dmg")"; response="$(mktemp)"; trap 'rm -f "$response"' EXIT
  xcrun notarytool submit "$dmg" --keychain-profile "$NOTARYTOOL_PROFILE" --wait --output-format json >"$response"
  require_same_digest "$dmg" "$signed_digest" submitted; parse_accepted_status <"$response"
  xcrun stapler staple "$dmg"; xcrun stapler validate "$dmg"; verify_disk_image_signature "$dmg"
  stapled_digest="$(sha256_dmg "$dmg")"; run_final_verification "$dmg"; require_same_digest "$dmg" "$stapled_digest" final
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then notarize_dmg_main "$@"; fi
