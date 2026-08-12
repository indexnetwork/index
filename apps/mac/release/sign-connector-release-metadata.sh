#!/usr/bin/env bash
# Generate and CMS-sign the exact connector metadata for a protected candidate.
set -euo pipefail
set +x
umask 077
readonly CONNECTOR_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$CONNECTOR_RELEASE_DIRECTORY/cms-identity.sh"
source "$CONNECTOR_RELEASE_DIRECTORY/cms-verify.sh"
connector_metadata_error() { printf 'connector release metadata signing refused: %s\n' "$1" >&2; return 1; }
connector_metadata_main() (
  [[ "$#" -eq 3 ]] || connector_metadata_error "usage: sign-connector-release-metadata.sh CONNECTOR_EXECUTABLE OUTPUT_CMS OUTPUT_SHA256"
  local connector="$1" output="$2" digest_output="$3" temporary metadata candidate recovered certificate digest
  for tool in bun security openssl cmp mktemp shasum; do command -v "$tool" >/dev/null || connector_metadata_error "$tool is required"; done
  [[ -f "$connector" && ! -L "$connector" ]] || connector_metadata_error "connector must be a regular non-link file"
  [[ ! -e "$output" && ! -L "$output" && ! -e "$digest_output" && ! -L "$digest_output" ]] || connector_metadata_error "outputs must not already exist"
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-connector-release.XXXXXX")"; chmod 700 "$temporary"
  trap 'rm -rf -- "$temporary"' EXIT
  metadata="$temporary/connector-release.json"; candidate="$temporary/connector-release.cms"; recovered="$temporary/recovered.json"; certificate="$temporary/certificate.pem"
  bun "$CONNECTOR_RELEASE_DIRECTORY/generate-connector-release-metadata.ts" "$connector" "$metadata"
  resolve_cms_identity "$certificate"
  security cms -S -N "$CMS_RESOLVED_IDENTITY_LABEL" -i "$metadata" -o "$candidate" 2>/dev/null || connector_metadata_error "CMS signing failed"
  security cms -D -i "$candidate" -o "$recovered" 2>/dev/null || connector_metadata_error "signed CMS cannot be recovered"
  cmp -s "$recovered" "$metadata" || connector_metadata_error "signed CMS recovered bytes differ"
  verify_opaque_cms_signer "$candidate" "$metadata" "$temporary" || connector_metadata_error "CMS signer validation failed"
  digest="$(shasum -a 256 "$candidate" | awk '{print $1}')"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || connector_metadata_error "CMS digest is noncanonical"
  (umask 077; set -o noclobber; cat "$candidate" >"$output") || connector_metadata_error "CMS publication failed"
  (umask 077; set -o noclobber; printf '%s\n' "$digest" >"$digest_output") || { rm -f -- "$output"; connector_metadata_error "digest publication failed"; }
)
connector_metadata_main "$@"
