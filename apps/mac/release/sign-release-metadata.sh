#!/usr/bin/env bash
# Validate and CMS-sign release metadata only in the later protected context.
set -euo pipefail
set +x
readonly SIGN_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SIGN_RELEASE_DIRECTORY/cms-identity.sh"
source "$SIGN_RELEASE_DIRECTORY/cms-verify.sh"
metadata_sign_error() { printf 'release metadata signing refused: %s\n' "$1" >&2; return 1; }
file_identity() { stat -c '%d:%i' "$1" 2>/dev/null || stat -f '%d:%i' "$1"; }
cleanup_owned_file() { local path="$1" identity="$2"; [[ -n "$identity" && -f "$path" && ! -L "$path" && "$(file_identity "$path")" == "$identity" ]] && rm -f -- "$path" || :; }
cleanup_owned_directory() { local path="$1" identity="$2"; [[ -n "$identity" && -d "$path" && ! -L "$path" && "$(file_identity "$path")" == "$identity" ]] && rm -rf -- "$path" || :; }
canonical_directory() { local absolute physical; absolute="$(cd "$1" && pwd -P)" || return 1; physical="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1")"; [[ "$absolute" == "$physical" ]] || return 1; printf '%s\n' "$physical"; }
publish_owned_noreplace() {
  local source="$1" destination="$2" expected_identity="$3"
  [[ "$(file_identity "$source")" == "$expected_identity" ]] || return 1
  ln "$source" "$destination" || return 1
  [[ "$(file_identity "$source")" == "$expected_identity" && "$(file_identity "$destination")" == "$expected_identity" ]] || return 1
  rm -f -- "$source" || return 1
}
sign_release_metadata() (
  [[ "$#" -eq 4 ]] || metadata_sign_error "usage: sign-release-metadata.sh FINAL_DIR OUTPUT_DIR BUILD_NUMBER FULL_COMMIT"
  local final output build="$3" commit="$4" metadata cms temporary validated candidate recovered certificate validated_identity="" candidate_identity="" temporary_identity=""
  for tool in bun security openssl cmp mktemp ln python3 stat; do command -v "$tool" >/dev/null || metadata_sign_error "$tool is required"; done
  final="$(canonical_directory "$1")" || metadata_sign_error "final directory must be canonical and physical"
  output="$(canonical_directory "$2")" || metadata_sign_error "output directory must be canonical and physical"
  [[ "$final" != "$output" && "$final" != "$output"/* && "$output" != "$final"/* ]] || metadata_sign_error "final and output directories must be separate"
  metadata="$output/macos-release.json"; cms="$output/macos-release.cms"
  [[ ! -e "$cms" && ! -L "$cms" ]] || metadata_sign_error "refusing to replace macos-release.cms"
  temporary="$(mktemp -d "$output/.index-release-cms-sign.XXXXXX")"; chmod 700 "$temporary"; temporary_identity="$(file_identity "$temporary")"
  validated="$temporary/validated-metadata.json"; candidate="$output/.macos-release.cms.$$.owned"; recovered="$temporary/recovered.json"; certificate="$temporary/certificate.pem"
  trap 'cleanup_owned_file "$candidate" "$candidate_identity"; cleanup_owned_file "$validated" "$validated_identity"; cleanup_owned_directory "$temporary" "$temporary_identity"' EXIT
  bun "$SIGN_RELEASE_DIRECTORY/generate-release-metadata.ts" --copy-validated "$final" "$output" "$build" "$commit" "$validated"
  validated_identity="$(file_identity "$validated")"
  resolve_cms_identity "$certificate"
  security cms -S -N "$CMS_RESOLVED_IDENTITY_LABEL" -i "$validated" -o "$candidate" 2>/dev/null || metadata_sign_error "CMS signing failed"
  [[ -f "$candidate" && ! -L "$candidate" ]] || metadata_sign_error "CMS candidate is not a regular file"; candidate_identity="$(file_identity "$candidate")"
  security cms -D -i "$candidate" -o "$recovered" 2>/dev/null || metadata_sign_error "signed CMS cannot be recovered"
  cmp -s "$recovered" "$validated" || metadata_sign_error "signed CMS recovered bytes differ from validated metadata"
  verify_opaque_cms_signer "$candidate" "$validated" "$temporary" || { metadata_sign_error "private CMS signer validation failed"; return 1; }
  [[ "$(file_identity "$candidate")" == "$candidate_identity" ]] || metadata_sign_error "private CMS identity changed before publication"
  cmp -s "$validated" "$metadata" || metadata_sign_error "validated metadata changed before CMS publication"
  publish_owned_noreplace "$candidate" "$cms" "$candidate_identity" || { metadata_sign_error "CMS no-clobber publication failed"; return 1; }
  candidate_identity=""
)
sign_release_metadata "$@"
