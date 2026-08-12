#!/usr/bin/env bash
# Verify canonical metadata, platform CMS trust, one pinned signer, recovered bytes, and checksums.
set -euo pipefail
set +x
readonly VERIFY_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$VERIFY_RELEASE_DIRECTORY/cms-identity.sh"
metadata_verify_error() { printf 'release metadata verification refused: %s\n' "$1" >&2; return 1; }
file_identity() { stat -c '%d:%i' "$1" 2>/dev/null || stat -f '%d:%i' "$1"; }
cleanup_owned_directory() { local path="$1" identity="$2"; [[ -n "$identity" && -d "$path" && ! -L "$path" && "$(file_identity "$path")" == "$identity" ]] && rm -rf -- "$path" || :; }
certificate_sha256_local() { openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'; }
verify_release_metadata() (
  [[ "$#" -eq 4 ]] || metadata_verify_error "usage: verify-release-metadata.sh FINAL_DIR OUTPUT_DIR BUILD_NUMBER FULL_COMMIT"
  local final="$1" output="$2" build="$3" commit="$4" metadata cms sums temporary expected_certificate signer_certificate expected_fingerprint signer_fingerprint name printed signer_count certificate_count temporary_identity=""
  for tool in bun security openssl shasum cmp mktemp awk grep; do command -v "$tool" >/dev/null || metadata_verify_error "$tool is required"; done
  metadata="$output/macos-release.json"; cms="$output/macos-release.cms"; sums="$output/SHA256SUMS"
  bun "$VERIFY_RELEASE_DIRECTORY/generate-release-metadata.ts" --verify "$final" "$output" "$build" "$commit"
  temporary="$(mktemp -d "$output/.index-release-cms-verify.XXXXXX")"; chmod 700 "$temporary"; temporary_identity="$(file_identity "$temporary")"; trap 'cleanup_owned_directory "$temporary" "$temporary_identity"' EXIT
  expected_certificate="$temporary/expected.pem"; signer_certificate="$temporary/signer.pem"
  resolve_cms_identity "$expected_certificate"
  # Platform Security owns chain/trust verification. OpenSSL is parser/signature extraction only.
  security cms -V -i "$cms" -o "$temporary/platform-verified.json" 2>/dev/null || metadata_verify_error "CMS platform trust or signature verification failed"
  security cms -D -i "$cms" -o "$temporary/platform-recovered.json" 2>/dev/null || metadata_verify_error "CMS content recovery failed"
  cmp -s "$temporary/platform-verified.json" "$temporary/platform-recovered.json" || metadata_verify_error "platform CMS verification and recovery disagree"
  cmp -s "$temporary/platform-recovered.json" "$metadata" || metadata_verify_error "CMS recovered bytes differ from canonical metadata"
  printed="$temporary/cms.txt"; openssl cms -cmsout -print -inform DER -in "$cms" >"$printed" 2>/dev/null || metadata_verify_error "CMS structure is malformed"
  signer_count="$(grep -c '^[[:space:]]*d\.issuerAndSerialNumber:' "$printed" || :)"
  certificate_count="$(grep -c '^[[:space:]]*d\.certificate:' "$printed" || :)"
  [[ "$signer_count" == 1 && "$certificate_count" == 1 ]] || metadata_verify_error "CMS must contain exactly one SignerInfo and one signer certificate"
  openssl cms -verify -binary -noverify -purpose any -inform DER -in "$cms" -out "$temporary/openssl-recovered.json" -signer "$signer_certificate" 2>/dev/null \
    || metadata_verify_error "CMS binary content/signature extraction failed"
  cmp -s "$temporary/openssl-recovered.json" "$metadata" || metadata_verify_error "OpenSSL recovered bytes differ from canonical metadata"
  [[ "$(grep -c '^-----BEGIN CERTIFICATE-----$' "$signer_certificate" || :)" == 1 ]] || metadata_verify_error "CMS signer extraction did not return exactly one certificate"
  expected_fingerprint="$(certificate_sha256_local "$expected_certificate")"; signer_fingerprint="$(certificate_sha256_local "$signer_certificate")"
  [[ -n "$expected_fingerprint" && "$signer_fingerprint" == "$expected_fingerprint" ]] || metadata_verify_error "CMS signer certificate does not match reviewed certificate"
  [[ "$(wc -l <"$sums" | tr -d ' ')" == 2 ]] || metadata_verify_error "SHA256SUMS must contain exactly two entries"
  while IFS= read -r name; do case "$name" in Index-macOS-1.0.0-universal.dmg|IndexConnector-1.0.0-universal.dmg);; *) metadata_verify_error "SHA256SUMS contains an unapproved name";; esac; done < <(awk '{print $2}' "$sums")
  (cd "$final" && shasum -a 256 -c "$sums")
)
verify_release_metadata "$@"
