#!/usr/bin/env bash
# Resolve one reviewed Keychain identity and independently pin its certificate.
set -euo pipefail
set +x
cms_identity_error() { printf 'release CMS identity refused: %s\n' "$1" >&2; return 1; }
canonical_hash_inputs() {
  [[ -z "${INDEX_RELEASE_CMS_IDENTITY_SHA256:-}" ]] || cms_identity_error "obsolete CMS identity pin is forbidden"
  [[ "${INDEX_RELEASE_CMS_IDENTITY_HASH:-}" =~ ^[0-9a-f]{40}$ ]] || cms_identity_error "CMS identity hash must be canonical lowercase 40-hex"
  [[ "${INDEX_RELEASE_CMS_CERT_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || cms_identity_error "CMS certificate pin must be canonical lowercase SHA-256"
}
certificate_sha256() { openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'; }
certificate_subject() { openssl x509 -in "$1" -noout -subject -nameopt RFC2253; }
resolve_cms_identity() {
  local certificate="$1" listing line hash label subject team actual_certificate_hash certificate_count match_count=0
  canonical_hash_inputs
  listing="$(security find-identity -v -p codesigning 2>/dev/null)" || cms_identity_error "Keychain identity enumeration failed"
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*[0-9]+\)[[:space:]]+([0-9A-Fa-f]{40})[[:space:]]+\"(Developer\ ID\ Application:[^\"]+)\"[[:space:]]*$ ]]; then
      hash="${BASH_REMATCH[1],,}"
      if [[ "$hash" == "$INDEX_RELEASE_CMS_IDENTITY_HASH" ]]; then label="${BASH_REMATCH[2]}"; ((match_count += 1)); fi
    fi
  done <<<"$listing"
  [[ "$match_count" == 1 && "$label" == Developer\ ID\ Application:* ]] || cms_identity_error "reviewed identity hash does not resolve uniquely"
  # -a exports every certificate with this exact label; exactly one PEM block is allowed.
  security find-certificate -a -c "$label" -p >"$certificate" 2>/dev/null || cms_identity_error "matching certificate export failed"
  certificate_count="$(grep -c '^-----BEGIN CERTIFICATE-----$' "$certificate" || :)"
  [[ "$certificate_count" == 1 ]] || cms_identity_error "reviewed identity label does not resolve to exactly one certificate"
  subject="$(certificate_subject "$certificate")" || cms_identity_error "certificate subject is unreadable"
  [[ "$subject" == *"CN=${label},"* || "$subject" == *",CN=${label},"* || "$subject" == *",CN=${label}" ]] || cms_identity_error "certificate label does not match resolved identity"
  team="$(printf '%s\n' "$subject" | tr ',' '\n' | sed -n 's/^OU=//p')"
  [[ "$team" == LMQ3XNXLAD ]] || cms_identity_error "certificate Team ID does not match production"
  actual_certificate_hash="$(certificate_sha256 "$certificate")"
  [[ "$actual_certificate_hash" == "$INDEX_RELEASE_CMS_CERT_SHA256" ]] || cms_identity_error "certificate SHA-256 does not match reviewed pin"
  CMS_RESOLVED_IDENTITY_LABEL="$label"
}
