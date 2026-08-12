#!/usr/bin/env bash
# Sign, notarize, staple, and mounted-verify a private candidate DMG.
set -euo pipefail
set +x
DMG_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DMG_RELEASE_DIRECTORY/notarize-bundle.sh"
source "$NOTARY_MAC_DIRECTORY/IndexApp/provisioning-profile.sh"
dmg_notary_error() { printf 'production DMG notarization refused: %s\n' "$1" >&2; return 1; }
sha256_dmg() { shasum -a 256 "$1" | awk '{print $1}'; }
require_same_digest() { [[ "$(sha256_dmg "$1")" == "$2" ]] || dmg_notary_error "$3 bytes changed unexpectedly"; }
run_final_verification() { bash "$DMG_RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$1"; }
verify_mounted_candidate() { bash "$DMG_RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$1"; }
candidate_inode_device() { stat -c '%d:%i' "$1" 2>/dev/null || stat -f '%d:%i' "$1"; }

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
    _ "$DMG_RELEASE_DIRECTORY/verify-signatures.sh" "$details" \
    || dmg_notary_error "DMG secure timestamp is missing or malformed"
  # Disk images do not carry a Hardened Runtime CodeDirectory contract.
}

copy_candidate_without_source_mutation() {
  local source="$1" candidate="$2" source_digest source_inode_device
  source_digest="$(sha256_dmg "$source")"
  source_inode_device="$(candidate_inode_device "$source")"
  cp -p "$source" "$candidate"
  [[ "$(candidate_inode_device "$source")" == "$source_inode_device" ]] \
    || dmg_notary_error "source inode changed during private copy"
  require_same_digest "$source" "$source_digest" source
  require_same_digest "$candidate" "$source_digest" copied
}

notarize_dmg_transaction() (
  [[ "$(uname -s)" == Darwin ]] || dmg_notary_error "macOS is required"; [[ "$#" -eq 1 ]] || dmg_notary_error "usage"
  local designated="$1" parent transaction candidate response source_digest source_inode_device unsigned_digest signed_digest stapled_digest
  [[ -f "$designated" && ! -L "$designated" ]] || dmg_notary_error "DMG missing or linked"
  case "$(basename "$designated")" in Index-macOS-1.0.0-universal.dmg|IndexConnector-1.0.0-universal.dmg);; *) dmg_notary_error "unapproved filename"; return 1;; esac
  [[ -n "${CODESIGN_IDENTITY:-}" && -n "${NOTARYTOOL_PROFILE:-}" ]] || dmg_notary_error "protected inputs required"
  for t in codesign security xcrun python3 shasum hdiutil cp mv stat; do command -v "$t" >/dev/null || dmg_notary_error "$t required"; done
  validate_production_identity "$CODESIGN_IDENTITY"
  parent="$(cd "$(dirname "$designated")" && pwd -P)"
  designated="$parent/$(basename "$designated")"
  source_digest="$(sha256_dmg "$designated")"
  source_inode_device="$(candidate_inode_device "$designated")"
  transaction="$(mktemp -d "$parent/.index-dmg-notarize.XXXXXX")"
  chmod 700 "$transaction"
  trap 'rm -rf "$transaction"' EXIT
  candidate="$transaction/$(basename "$designated")"
  copy_candidate_without_source_mutation "$designated" "$candidate"
  unsigned_digest="$(sha256_dmg "$candidate")"; verify_mounted_candidate "$candidate"; require_same_digest "$candidate" "$unsigned_digest" unsigned
  codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$candidate"; verify_disk_image_signature "$candidate"
  signed_digest="$(sha256_dmg "$candidate")"; response="$transaction/notary-response.json"
  xcrun notarytool submit "$candidate" --keychain-profile "$NOTARYTOOL_PROFILE" --wait --output-format json >"$response"
  require_same_digest "$candidate" "$signed_digest" submitted; parse_accepted_status <"$response"
  xcrun stapler staple "$candidate"; xcrun stapler validate "$candidate"; verify_disk_image_signature "$candidate"
  stapled_digest="$(sha256_dmg "$candidate")"; run_final_verification "$candidate"; require_same_digest "$candidate" "$stapled_digest" final
  [[ "$(candidate_inode_device "$designated")" == "$source_inode_device" ]] \
    || dmg_notary_error "source inode changed before promotion"
  require_same_digest "$designated" "$source_digest" source
  mv -f "$candidate" "$designated"
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then notarize_dmg_transaction "$@"; fi
