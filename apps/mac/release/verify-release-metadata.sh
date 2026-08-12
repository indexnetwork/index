#!/usr/bin/env bash
# Verify canonical metadata, exact checksums, CMS trust, recovered bytes, and signer pin.
set -euo pipefail
set +x
readonly VERIFY_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
metadata_verify_error() { printf 'release metadata verification refused: %s\n' "$1" >&2; return 1; }
certificate_fingerprint() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^[^=]*=//;s/://g' | tr '[:lower:]' '[:upper:]'; }
certificate_details() {
  local identity="$1" certificate="$2" subject team
  security find-identity -v -p codesigning 2>/dev/null | grep -qF "\"$identity\"" \
    || metadata_verify_error "pinned CMS signing identity is unavailable"
  security find-certificate -c "$identity" -p >"$certificate" 2>/dev/null \
    || metadata_verify_error "pinned CMS signing certificate is unavailable"
  subject="$(openssl x509 -in "$certificate" -noout -subject -nameopt RFC2253)" \
    || metadata_verify_error "pinned CMS certificate subject is unreadable"
  [[ "$subject" == *"CN=Developer ID Application:"* ]] \
    || metadata_verify_error "CMS signer is not Developer ID Application"
  team="$(openssl x509 -in "$certificate" -noout -subject -nameopt RFC2253 | tr ',' '\n' | sed -n 's/^OU=//p')"
  [[ "$team" == "LMQ3XNXLAD" ]] || metadata_verify_error "CMS signer Team ID does not match production"
}
verify_release_metadata() (
  [[ "$#" -eq 4 ]] || metadata_verify_error "usage: verify-release-metadata.sh FINAL_DIR OUTPUT_DIR BUILD_NUMBER FULL_COMMIT"
  local final="$1" output="$2" build="$3" commit="$4" metadata cms sums temporary expected_certificate signer_certificate expected_fingerprint signer_fingerprint name
  : "${INDEX_RELEASE_CMS_SIGNING_IDENTITY:?INDEX_RELEASE_CMS_SIGNING_IDENTITY is required}"
  for tool in bun security openssl shasum cmp mktemp; do command -v "$tool" >/dev/null || metadata_verify_error "$tool is required"; done
  metadata="$output/macos-release.json"; cms="$output/macos-release.cms"; sums="$output/SHA256SUMS"
  for path in "$metadata" "$cms" "$sums"; do [[ -f "$path" && ! -L "$path" ]] || metadata_verify_error "required release file missing or linked"; done
  bun "$VERIFY_RELEASE_DIRECTORY/generate-release-metadata.ts" --verify "$final" "$output" "$build" "$commit"
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-release-cms-verify.XXXXXX")"; chmod 700 "$temporary"; trap 'rm -rf "$temporary"' EXIT
  expected_certificate="$temporary/expected.pem"; signer_certificate="$temporary/signer.pem"
  certificate_details "$INDEX_RELEASE_CMS_SIGNING_IDENTITY" "$expected_certificate"
  # -V performs platform trust/signature verification; -D recovers the signed content.
  security cms -V -i "$cms" -o "$temporary/verified.json" 2>/dev/null || metadata_verify_error "CMS trust or signature verification failed"
  security cms -D -i "$cms" -o "$temporary/recovered.json" 2>/dev/null || metadata_verify_error "CMS content recovery failed"
  cmp -s "$temporary/verified.json" "$temporary/recovered.json" || metadata_verify_error "CMS verification and recovery disagree"
  cmp -s "$temporary/recovered.json" "$metadata" || metadata_verify_error "CMS recovered bytes differ from canonical macos-release.json"
  # Extract the actual CMS signer and require it to be the independently located pinned certificate.
  openssl cms -verify -inform DER -in "$cms" -out "$temporary/openssl-recovered.json" -signer "$signer_certificate" 2>/dev/null \
    || metadata_verify_error "CMS signer certificate cannot be extracted and verified"
  cmp -s "$temporary/openssl-recovered.json" "$metadata" || metadata_verify_error "OpenSSL recovered bytes differ from canonical metadata"
  expected_fingerprint="$(certificate_fingerprint "$expected_certificate")"; signer_fingerprint="$(certificate_fingerprint "$signer_certificate")"
  [[ -n "$expected_fingerprint" && "$signer_fingerprint" == "$expected_fingerprint" ]] \
    || metadata_verify_error "CMS signer certificate does not match the pinned certificate"
  (
    cd "$final"
    shasum -a 256 -c "$sums"
  )
  [[ "$(wc -l <"$sums" | tr -d ' ')" == 2 ]] || metadata_verify_error "SHA256SUMS must contain exactly two entries"
  while IFS= read -r name; do
    case "$name" in Index-macOS-1.0.0-universal.dmg|IndexConnector-1.0.0-universal.dmg);; *) metadata_verify_error "SHA256SUMS contains an unapproved name";; esac
  done < <(awk '{print $2}' "$sums")
)
verify_release_metadata "$@"
