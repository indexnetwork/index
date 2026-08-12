#!/usr/bin/env bash
# Shared opaque CMS structure, signature, content, and signer-certificate pin checks.
set -euo pipefail
set +x
cms_verify_error() { printf 'release CMS verification refused: %s\n' "$1" >&2; return 1; }
certificate_sha256_der() { openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'; }
verify_opaque_cms_signer() {
  local cms="$1" expected_content="$2" work="$3" printed recovered signer signer_count certificate_count signer_hash
  printed="$work/cms.txt"; recovered="$work/openssl-recovered.json"; signer="$work/signer.pem"
  openssl cms -cmsout -print -inform DER -in "$cms" >"$printed" 2>/dev/null || { cms_verify_error "CMS structure is malformed"; return 1; }
  signer_count="$(grep -c '^[[:space:]]*d\.issuerAndSerialNumber:' "$printed" || :)"
  certificate_count="$(grep -c '^[[:space:]]*d\.certificate:' "$printed" || :)"
  [[ "$signer_count" == 1 && "$certificate_count" == 1 ]] || { cms_verify_error "CMS must contain exactly one SignerInfo and one signer certificate"; return 1; }
  openssl cms -verify -binary -noverify -purpose any -inform DER -in "$cms" -out "$recovered" -signer "$signer" 2>/dev/null \
    || { cms_verify_error "CMS binary content/signature extraction failed"; return 1; }
  cmp -s "$recovered" "$expected_content" || { cms_verify_error "CMS recovered bytes differ from validated metadata"; return 1; }
  [[ "$(grep -c '^-----BEGIN CERTIFICATE-----$' "$signer" || :)" == 1 ]] || { cms_verify_error "CMS signer extraction did not return exactly one certificate"; return 1; }
  signer_hash="$(certificate_sha256_der "$signer")" || { cms_verify_error "CMS signer digest failed"; return 1; }
  [[ "$signer_hash" == "$INDEX_RELEASE_CMS_CERT_SHA256" ]] || { cms_verify_error "CMS signer certificate does not match reviewed pin"; return 1; }
}
