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
source "$RELEASE_DIRECTORY/notarize-dmg.sh"

artifact_sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
verify_final_artifact_hash() {
  local artifact="$1" evidence="$2" expected
  expected="$(awk -F= '$1 == "finalArtifact.sha256" { value=$2; count++ } END { if (count == 1) print value }' "$evidence")"
  [[ -n "$expected" && "$expected" == "$(artifact_sha256 "$artifact")" ]] \
    || { echo 'final artifact evidence hash mismatch' >&2; return 1; }
}
build_atomic_rename_helper() {
  local output="$1"
  case "$(uname -s)" in
    Darwin) xcrun clang -std=c11 -Wall -Wextra -Werror "$RELEASE_DIRECTORY/atomic-rename.c" -o "$output" ;;
    Linux) cc -std=c11 -Wall -Wextra -Werror "$RELEASE_DIRECTORY/atomic-rename.c" -o "$output" ;;
    *) echo 'atomic release promotion requires macOS or Linux' >&2; return 1 ;;
  esac
  chmod 700 "$output"
}
atomic_rename_noreplace() {
  local source="$1" destination="$2" helper="$3"
  "$helper" "$source" "$destination"
}
promote_release_set() {
  local private_set="$1" destination="$2" helper="$3"
  # renameatx_np(RENAME_EXCL) / renameat2(RENAME_NOREPLACE) combines the
  # destination-existence check and same-filesystem directory rename.
  atomic_rename_noreplace "$private_set" "$destination" "$helper"
}
cleanup_promoted_release_set() {
  local destination="$1" quarantine="$2" identity="$3" helper="$4"
  [[ ! -e "$quarantine" && ! -L "$quarantine" ]] || { echo 'cleanup quarantine already exists' >&2; return 1; }
  "$helper" --quarantine-exact "$destination" "$quarantine" "$identity" || return $?
  rm -rf -- "$quarantine"
}
cleanup_release_transaction() {
  local transaction="$1" promotion_complete="$2" promoted_identity="$3" helper="$4" status="$5"
  if (( status != 0 )); then
    if [[ "$promotion_complete" == 1 ]]; then
      cleanup_promoted_release_set "$FINAL_DIRECTORY" "$transaction" "$promoted_identity" "$helper" || :
    else
      rm -rf -- "$transaction"
    fi
  fi
  [[ -n "$helper" ]] && rm -f -- "$helper"
  return "$status"
}
release_main() (
  local final_parent source_transaction transaction app_source connector_source app_dmg connector_dmg promotion_complete=0 promoted_identity="" helper=""
  final_parent="$(dirname "$FINAL_DIRECTORY")"
  mkdir -p "$final_parent"
  source_transaction="$(mktemp -d "$final_parent/.index-final-source.XXXXXX")"
  transaction="$(mktemp -d "$final_parent/.index-final-candidate.XXXXXX")"
  chmod 700 "$source_transaction" "$transaction"
  helper="$(mktemp "$final_parent/.index-atomic-rename.XXXXXX")"
  rm -f -- "$helper"
  build_atomic_rename_helper "$helper"
  trap 'status=$?; cleanup_release_transaction "$transaction" "$promotion_complete" "$promoted_identity" "$helper" "$status"; rm -rf -- "$source_transaction"' EXIT
  app_source="$source_transaction/Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg"
  connector_source="$source_transaction/IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg"
  app_dmg="$transaction/$(basename "$app_source")"
  connector_dmg="$transaction/$(basename "$connector_source")"
  bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/Index.app"
  bash "$RELEASE_DIRECTORY/notarize-bundle.sh" "$SIGNED_DIRECTORY/IndexConnector.app"
  bash "$RELEASE_DIRECTORY/create-dmg.sh" "$SIGNED_DIRECTORY/Index.app" "$app_source"
  bash "$RELEASE_DIRECTORY/create-dmg.sh" "$SIGNED_DIRECTORY/IndexConnector.app" "$connector_source"
  notarize_dmg_transform "$app_source" "$app_dmg"
  notarize_dmg_transform "$connector_source" "$connector_dmg"
  bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$app_dmg"
  bash "$RELEASE_DIRECTORY/verify-mounted-dmg.sh" "$connector_dmg"
  verify_final_artifact_hash "$app_dmg" "${app_dmg}.reproducibility.txt"
  verify_final_artifact_hash "$connector_dmg" "${connector_dmg}.reproducibility.txt"
  promoted_identity="$(candidate_inode_device "$transaction")"
  promote_release_set "$transaction" "$FINAL_DIRECTORY" "$helper"
  promotion_complete=1
  [[ "$(candidate_inode_device "$FINAL_DIRECTORY")" == "$promoted_identity" ]] \
    || { echo 'promoted release set identity mismatch' >&2; return 1; }
  verify_final_artifact_hash "$FINAL_DIRECTORY/$(basename "$app_dmg")" "$FINAL_DIRECTORY/$(basename "$app_dmg").reproducibility.txt"
  verify_final_artifact_hash "$FINAL_DIRECTORY/$(basename "$connector_dmg")" "$FINAL_DIRECTORY/$(basename "$connector_dmg").reproducibility.txt"
  promotion_complete=0
  promoted_identity=""
  rm -rf -- "$source_transaction"
  rm -f -- "$helper"
  trap - EXIT
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then release_main "$@"; fi
