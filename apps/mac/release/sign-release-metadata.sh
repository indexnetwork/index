#!/usr/bin/env bash
# CMS-sign canonical release metadata only in the later protected context.
set -euo pipefail
set +x
metadata_sign_error() { printf 'release metadata signing refused: %s\n' "$1" >&2; return 1; }
sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
certificate_details() {
  local identity="$1" certificate="$2" subject team
  security find-identity -v -p codesigning 2>/dev/null | grep -qF "\"$identity\"" \
    || metadata_sign_error "CMS signing identity is unavailable"
  security find-certificate -c "$identity" -p >"$certificate" 2>/dev/null \
    || metadata_sign_error "CMS signing certificate is unavailable"
  subject="$(openssl x509 -in "$certificate" -noout -subject -nameopt RFC2253)" \
    || metadata_sign_error "CMS signing certificate subject is unreadable"
  [[ "$subject" == *"CN=Developer ID Application:"* ]] \
    || metadata_sign_error "CMS signer is not Developer ID Application"
  team="$(openssl x509 -in "$certificate" -noout -subject -nameopt RFC2253 | tr ',' '\n' | sed -n 's/^OU=//p')"
  [[ "$team" == "LMQ3XNXLAD" ]] || metadata_sign_error "CMS signer Team ID does not match production"
}
sign_release_metadata() (
  [[ "$#" -eq 1 ]] || metadata_sign_error "usage: sign-release-metadata.sh OUTPUT_DIR"
  local output="$1" metadata cms temporary certificate before
  : "${INDEX_RELEASE_CMS_SIGNING_IDENTITY:?INDEX_RELEASE_CMS_SIGNING_IDENTITY is required}"
  for tool in security openssl shasum cmp mktemp; do command -v "$tool" >/dev/null || metadata_sign_error "$tool is required"; done
  metadata="$output/macos-release.json"; cms="$output/macos-release.cms"
  [[ -f "$metadata" && ! -L "$metadata" ]] || metadata_sign_error "canonical macos-release.json is required"
  [[ ! -e "$cms" && ! -L "$cms" ]] || metadata_sign_error "refusing to replace macos-release.cms"
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-release-cms-sign.XXXXXX")"; chmod 700 "$temporary"; trap 'rm -rf "$temporary"' EXIT
  certificate="$temporary/signing-certificate.pem"
  certificate_details "$INDEX_RELEASE_CMS_SIGNING_IDENTITY" "$certificate"
  before="$(sha256_file "$metadata")"
  security cms -S -N "$INDEX_RELEASE_CMS_SIGNING_IDENTITY" -i "$metadata" -o "$temporary/macos-release.cms" 2>/dev/null \
    || metadata_sign_error "CMS signing failed"
  [[ "$(sha256_file "$metadata")" == "$before" ]] || metadata_sign_error "metadata bytes changed during signing"
  mv "$temporary/macos-release.cms" "$cms"
)
sign_release_metadata "$@"
