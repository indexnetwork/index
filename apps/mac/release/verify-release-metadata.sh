#!/usr/bin/env bash
# Verify canonical metadata, platform CMS trust, one pinned signer, recovered bytes, and checksums.
set -euo pipefail
set +x
readonly VERIFY_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$VERIFY_RELEASE_DIRECTORY/cms-identity.sh"
source "$VERIFY_RELEASE_DIRECTORY/cms-verify.sh"
metadata_verify_error() { printf 'release metadata verification refused: %s\n' "$1" >&2; return 1; }
file_identity() { stat -c '%d:%i' "$1" 2>/dev/null || stat -f '%d:%i' "$1"; }
cleanup_owned_directory() { local path="$1" identity="$2"; [[ -n "$identity" && -d "$path" && ! -L "$path" && "$(file_identity "$path")" == "$identity" ]] && rm -rf -- "$path" || :; }
sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
require_snapshot_hash() { [[ "$(sha256_file "$1")" == "$2" ]] || metadata_verify_error "CMS snapshot changed during verification"; }
verify_release_metadata() (
  [[ "$#" -eq 4 ]] || metadata_verify_error "usage: verify-release-metadata.sh FINAL_DIR OUTPUT_DIR BUILD_NUMBER FULL_COMMIT"
  local final="$1" output="$2" build="$3" commit="$4" metadata cms sums snapshot snapshot_hash temporary expected_certificate expected_fingerprint name temporary_identity=""
  for tool in bun security openssl shasum cmp mktemp awk grep python3; do command -v "$tool" >/dev/null || metadata_verify_error "$tool is required"; done
  metadata="$output/macos-release.json"; cms="$output/macos-release.cms"; sums="$output/SHA256SUMS"
  bun "$VERIFY_RELEASE_DIRECTORY/generate-release-metadata.ts" --verify "$final" "$output" "$build" "$commit"
  temporary="$(mktemp -d "$output/.index-release-cms-verify.XXXXXX")"; chmod 700 "$temporary"; temporary_identity="$(file_identity "$temporary")"; trap 'cleanup_owned_directory "$temporary" "$temporary_identity"' EXIT
  expected_certificate="$temporary/expected.pem"; snapshot="$temporary/cms.snapshot"
  snapshot_hash="$(python3 "$VERIFY_RELEASE_DIRECTORY/snapshot-file.py" "$cms" "$snapshot")" || metadata_verify_error "CMS source cannot be snapshotted safely"
  [[ "$snapshot_hash" =~ ^[0-9a-f]{64}$ ]] || metadata_verify_error "CMS snapshot hash is invalid"
  resolve_cms_identity "$expected_certificate"
  expected_fingerprint="$(certificate_sha256_der "$expected_certificate")"
  [[ "$expected_fingerprint" == "$INDEX_RELEASE_CMS_CERT_SHA256" ]] || metadata_verify_error "expected certificate pin changed"
  # Platform Security owns chain/trust verification. Every phase inspects the same owned snapshot.
  require_snapshot_hash "$snapshot" "$snapshot_hash"
  security cms -V -i "$snapshot" -o "$temporary/platform-verified.json" 2>/dev/null || metadata_verify_error "CMS platform trust or signature verification failed"
  require_snapshot_hash "$snapshot" "$snapshot_hash"
  security cms -D -i "$snapshot" -o "$temporary/platform-recovered.json" 2>/dev/null || metadata_verify_error "CMS content recovery failed"
  require_snapshot_hash "$snapshot" "$snapshot_hash"
  cmp -s "$temporary/platform-verified.json" "$temporary/platform-recovered.json" || metadata_verify_error "platform CMS verification and recovery disagree"
  cmp -s "$temporary/platform-recovered.json" "$metadata" || metadata_verify_error "CMS recovered bytes differ from canonical metadata"
  verify_opaque_cms_signer "$snapshot" "$metadata" "$temporary" || { metadata_verify_error "CMS signer validation failed"; return 1; }
  require_snapshot_hash "$snapshot" "$snapshot_hash"
  [[ "$(wc -l <"$sums" | tr -d ' ')" == 2 ]] || metadata_verify_error "SHA256SUMS must contain exactly two entries"
  while IFS= read -r name; do case "$name" in Index-macOS-1.0.0-universal.dmg|IndexConnector-1.0.0-universal.dmg);; *) metadata_verify_error "SHA256SUMS contains an unapproved name";; esac; done < <(awk '{print $2}' "$sums")
  (cd "$final" && shasum -a 256 -c "$sums")
)
verify_release_metadata "$@"
