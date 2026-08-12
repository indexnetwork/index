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
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  : "${NOTARYTOOL_PROFILE:?set NOTARYTOOL_PROFILE}"
  : "${INDEX_RELEASE_VERSION:?set INDEX_RELEASE_VERSION}"
  if [[ -n "${APP_PATH:-}" ]]; then exec bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$APP_PATH"; fi
fi
# Sourced in-process: notarize-dmg.sh has no standalone mutation entrypoint.
source "$RELEASE_DIRECTORY/notarize-dmg.sh"

artifact_sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
write_final_artifact_hash() {
  local artifact="$1" evidence="$2" temporary hash
  hash="$(artifact_sha256 "$artifact")"; temporary="${evidence}.final.incomplete"
  awk -F= '$1 != "finalArtifact.sha256" { print }' "$evidence" >"$temporary"
  printf 'finalArtifact.sha256=%s\n' "$hash" >>"$temporary"
  mv "$temporary" "$evidence"
}
verify_final_artifact_hash() {
  local artifact="$1" evidence="$2" expected
  expected="$(awk -F= '$1 == "finalArtifact.sha256" { value=$2; count++ } END { if (count == 1) print value }' "$evidence")"
  [[ -n "$expected" && "$expected" == "$(artifact_sha256 "$artifact")" ]] \
    || { echo 'final artifact evidence hash mismatch' >&2; return 1; }
}
notarize_owned_candidate() {
  local candidate="$1"
  local -r allowed_candidate="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$candidate")"
  local -r allowed_inode_device="$(candidate_inode_device "$candidate")"
  require_bound_candidate "$candidate" "$allowed_candidate" "$allowed_inode_device"
  notarize_dmg_internal "$candidate" "$allowed_candidate" "$allowed_inode_device"
}

promote_release_set() {
  local private_set="$1" destination="$2"
  [[ ! -e "$destination" ]] || { echo "refusing to replace existing immutable release set" >&2; return 1; }
  # private_set is created in destination's parent, so rename is one same-volume
  # atomic operation: neither exact filename is visible before every gate passes.
  mv "$private_set" "$destination"
}
release_main() {
  local final_parent transaction app_dmg connector_dmg
  final_parent="$(dirname "$FINAL_DIRECTORY")"
  mkdir -p "$final_parent"
  [[ ! -e "$FINAL_DIRECTORY" ]] || { echo 'refusing to replace existing immutable release set' >&2; return 1; }
  transaction="$(mktemp -d "$final_parent/.index-final-transaction.XXXXXX")"
  trap 'rm -rf "$transaction"' EXIT
  app_dmg="$transaction/Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg"
  connector_dmg="$transaction/IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg"
  bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/Index.app"
  bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/IndexConnector.app"
  bash "$RELEASE_DIRECTORY/create-dmg.sh" "$SIGNED_DIRECTORY/Index.app" "$app_dmg"
  bash "$RELEASE_DIRECTORY/create-dmg.sh" "$SIGNED_DIRECTORY/IndexConnector.app" "$connector_dmg"
  notarize_owned_candidate "$app_dmg"; notarize_owned_candidate "$connector_dmg"
  bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$app_dmg"
  bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$connector_dmg"
  write_final_artifact_hash "$app_dmg" "${app_dmg}.reproducibility.txt"
  write_final_artifact_hash "$connector_dmg" "${connector_dmg}.reproducibility.txt"
  verify_final_artifact_hash "$app_dmg" "${app_dmg}.reproducibility.txt"
  verify_final_artifact_hash "$connector_dmg" "${connector_dmg}.reproducibility.txt"
  trap - EXIT
  promote_release_set "$transaction" "$FINAL_DIRECTORY"
  verify_final_artifact_hash "$FINAL_DIRECTORY/$(basename "$app_dmg")" "$FINAL_DIRECTORY/$(basename "$app_dmg").reproducibility.txt"
  verify_final_artifact_hash "$FINAL_DIRECTORY/$(basename "$connector_dmg")" "$FINAL_DIRECTORY/$(basename "$connector_dmg").reproducibility.txt"
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then release_main "$@"; fi
