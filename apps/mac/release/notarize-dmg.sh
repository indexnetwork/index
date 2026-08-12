#!/usr/bin/env bash
# Transform an immutable DMG source into a distinct private notarized candidate.
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

canonical_existing_file() {
  local path="$1" parent
  parent="$(cd "$(dirname "$path")" && pwd -P)" || return 1
  printf '%s/%s\n' "$parent" "$(basename "$path")"
}
canonical_new_file() {
  local path="$1" parent name
  parent="$(cd "$(dirname "$path")" && pwd -P)" || return 1
  name="$(basename "$path")"
  [[ "$name" != . && "$name" != .. && "$name" != */* ]] || return 1
  printf '%s/%s\n' "$parent" "$name"
}
write_candidate_final_hash() {
  local candidate="$1" evidence="$2" temporary hash
  hash="$(sha256_dmg "$candidate")"
  temporary="${evidence}.incomplete"
  awk -F= '$1 != "finalArtifact.sha256" { print }' "$evidence" >"$temporary"
  printf 'finalArtifact.sha256=%s\n' "$hash" >>"$temporary"
  mv "$temporary" "$evidence"
  [[ "$(awk -F= '$1 == "finalArtifact.sha256" { value=$2; count++ } END { if (count == 1) print value }' "$evidence")" == "$hash" ]] \
    || dmg_notary_error "final artifact evidence hash mismatch"
}

notarize_dmg_transform() (
  [[ "$#" -eq 2 ]] || dmg_notary_error "usage: notarize-dmg.sh IMMUTABLE_SOURCE PRIVATE_OUTPUT"
  local source="$1" output="$2" output_parent work candidate response source_digest source_inode_device unsigned_digest signed_digest stapled_digest output_evidence
  [[ -f "$source" && ! -L "$source" ]] || dmg_notary_error "DMG source missing or linked"
  case "$(basename "$source")" in Index-macOS-1.0.0-universal.dmg|IndexConnector-1.0.0-universal.dmg);; *) dmg_notary_error "unapproved filename"; return 1;; esac
  [[ "$(basename "$output")" == "$(basename "$source")" ]] || dmg_notary_error "private output filename must match source"
  source="$(canonical_existing_file "$source")" || dmg_notary_error "source parent unavailable"
  output="$(canonical_new_file "$output")" || dmg_notary_error "output parent unavailable"
  [[ "$source" != "$output" ]] || dmg_notary_error "source and output must be distinct"
  [[ ! -e "$output" && ! -L "$output" && ! -e "${output}.reproducibility.txt" && ! -L "${output}.reproducibility.txt" ]] \
    || dmg_notary_error "private output already exists"
  output_parent="$(dirname "$output")"
  [[ "$(stat -c '%a' "$output_parent" 2>/dev/null || stat -f '%Lp' "$output_parent")" == 700 ]] \
    || dmg_notary_error "private output parent must be mode 0700"
  [[ "$(basename "$output_parent")" == .index-final-candidate.* || "$(basename "$output_parent")" == .index-dmg-notarize.* ]] \
    || dmg_notary_error "output is not in a caller-owned private directory"
  case "$output" in */dist/final/*|*/dist/final) dmg_notary_error "publishing paths are forbidden"; return 1;; esac
  [[ "$(uname -s)" == Darwin ]] || dmg_notary_error "macOS is required"
  [[ -n "${CODESIGN_IDENTITY:-}" && -n "${NOTARYTOOL_PROFILE:-}" ]] || dmg_notary_error "protected inputs required"
  for t in codesign security xcrun python3 shasum hdiutil cp stat; do command -v "$t" >/dev/null || dmg_notary_error "$t required"; done
  [[ -f "${source}.reproducibility.txt" && ! -L "${source}.reproducibility.txt" ]] || dmg_notary_error "source reproducibility evidence missing or linked"
  validate_production_identity "$CODESIGN_IDENTITY"
  source_digest="$(sha256_dmg "$source")"
  source_inode_device="$(candidate_inode_device "$source")"
  work="$(mktemp -d "$output_parent/.index-dmg-notarize.XXXXXX")"
  chmod 700 "$work"
  trap 'rm -rf "$work"' EXIT
  candidate="$work/$(basename "$source")"
  cp -p "$source" "$candidate"
  [[ "$(candidate_inode_device "$source")" == "$source_inode_device" ]] || dmg_notary_error "source inode changed during private copy"
  require_same_digest "$source" "$source_digest" source
  require_same_digest "$candidate" "$source_digest" copied
  unsigned_digest="$(sha256_dmg "$candidate")"; verify_mounted_candidate "$candidate"; require_same_digest "$candidate" "$unsigned_digest" unsigned
  codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$candidate"; verify_disk_image_signature "$candidate"
  signed_digest="$(sha256_dmg "$candidate")"; response="$work/notary-response.json"
  xcrun notarytool submit "$candidate" --keychain-profile "$NOTARYTOOL_PROFILE" --wait --output-format json >"$response"
  require_same_digest "$candidate" "$signed_digest" submitted; parse_accepted_status <"$response"
  xcrun stapler staple "$candidate"; xcrun stapler validate "$candidate"; verify_disk_image_signature "$candidate"
  stapled_digest="$(sha256_dmg "$candidate")"; run_final_verification "$candidate"; require_same_digest "$candidate" "$stapled_digest" final
  [[ "$(candidate_inode_device "$source")" == "$source_inode_device" ]] || dmg_notary_error "source inode changed before output"
  require_same_digest "$source" "$source_digest" source
  cp -p "${source}.reproducibility.txt" "$work/$(basename "$source").reproducibility.txt"
  write_candidate_final_hash "$candidate" "$work/$(basename "$source").reproducibility.txt"
  require_same_digest "$candidate" "$stapled_digest" final
  # Output is new and private; the caller owns its later release-set promotion.
  output_evidence="${output}.reproducibility.txt"
  cp -p "$work/$(basename "$source").reproducibility.txt" "$output_evidence"
  if ! cp -p "$candidate" "$output"; then
    rm -f -- "$output_evidence" "$output"
    return 1
  fi
  if ! require_same_digest "$source" "$source_digest" source || ! require_same_digest "$output" "$stapled_digest" output; then
    rm -f -- "$output_evidence" "$output"
    return 1
  fi
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then notarize_dmg_transform "$@"; fi
