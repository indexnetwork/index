#!/usr/bin/env bash
# Notarize, staple, and reverify one already-signed production app bundle.
# Invoke only in a protected macOS context. Credential values are never logged.
set -euo pipefail
set +x

NOTARY_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTARY_MAC_DIRECTORY="$(cd "$NOTARY_RELEASE_DIRECTORY/.." && pwd)"

# shellcheck source=release-config.sh
if [[ -z "${INDEX_PRODUCTION_TEAM_ID+x}" ]]; then
  source "$NOTARY_RELEASE_DIRECTORY/release-config.sh"
fi

notary_error() {
  printf 'production bundle notarization refused: %s\n' "$1" >&2
  return 1
}

require_notary_tool() {
  command -v "$1" >/dev/null 2>&1 || notary_error "$1 is required"
}

parse_accepted_status() {
  python3 -c 'import json,sys
try:
 value=json.load(sys.stdin)
except Exception:
 raise SystemExit(2)
if not isinstance(value,dict) or value.get("status") != "Accepted":
 raise SystemExit(1)' || notary_error "notary submission status was malformed or not Accepted"
}

validate_notarized_bundle_contract() {
  local bundle="$1" plist="$bundle/Contents/Info.plist" version channel development
  version="$(python3 - "$plist" <<'PY'
import plistlib,sys
try:
 value=plistlib.load(open(sys.argv[1], 'rb'))
except Exception:
 raise SystemExit(1)
if value.get('IndexReleaseChannel') != 'production' or value.get('IndexDevelopmentBuild') is not False:
 raise SystemExit(1)
print(value.get('IndexReleaseVersion', ''))
PY
)" || notary_error "bundle release configuration is malformed or non-production"
  [[ "$version" == "$INDEX_FIRST_PRODUCTION_VERSION" ]] \
    || notary_error "bundle release version must equal $INDEX_FIRST_PRODUCTION_VERSION"
  if [[ -n "${INDEX_RELEASE_VERSION:-}" && "$INDEX_RELEASE_VERSION" != "$version" ]]; then
    notary_error "requested release version does not match the bundle"
  fi
}

verify_release_architecture_and_config() {
  local signed_directory="$1"
  bash -c '
set -euo pipefail
source "$1"
directory="$2"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-release-reverify.XXXXXX")"
trap '\''rm -rf "$temporary"'\'' EXIT
for role in app connector; do
  if [[ "$role" == app ]]; then
    bundle="$directory/Index.app"; binary="$bundle/Contents/MacOS/Index"; prefix=Index
  else
    bundle="$directory/IndexConnector.app"; binary="$bundle/Contents/MacOS/IndexConnector"; prefix=IndexConnector
  fi
  verify_macho "$binary"
  expected="$temporary/$prefix.expected.json"
  write_compiled_identity "$role" "$bundle/Contents/Info.plist" "$expected"
  extract_compiled_identity "$binary" arm64 "$temporary/$prefix.arm64.json"
  extract_compiled_identity "$binary" x86_64 "$temporary/$prefix.x86_64.json"
  cmp -s "$temporary/$prefix.arm64.json" "$temporary/$prefix.x86_64.json" \
    || release_error "$prefix slices have different compiled identities"
  cmp -s "$temporary/$prefix.arm64.json" "$expected" \
    || release_error "$prefix compiled identity does not match shipped bundle configuration"
done
' _ "$NOTARY_RELEASE_DIRECTORY/build-universal.sh" "$signed_directory"
}

verify_release_directory() {
  local signed_directory="$1"
  bash "$NOTARY_RELEASE_DIRECTORY/verify-signatures.sh" "$signed_directory"
  verify_release_architecture_and_config "$signed_directory"
}

verify_release_bundle_path() {
  local bundle="$1" name role bundle_id host group binary
  name="$(basename "$bundle")"
  case "$name" in
    Index.app)
      role=app; bundle_id="$INDEX_APP_BUNDLE_ID"; host=index.network
      group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_APP_BUNDLE_ID}.owner-credentials"
      binary="$bundle/Contents/MacOS/Index"
      ;;
    IndexConnector.app)
      role=connector; bundle_id="$INDEX_CONNECTOR_BUNDLE_ID"; host=''
      group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_CONNECTOR_BUNDLE_ID}.credentials"
      binary="$bundle/Contents/MacOS/IndexConnector"
      ;;
    *) notary_error "bundle must be Index.app or IndexConnector.app"; return 1 ;;
  esac
  bash -c 'set -euo pipefail; source "$1"; verify_release_bundle "$2" "$3" "$4" "$5" "$6"' \
    _ "$NOTARY_RELEASE_DIRECTORY/verify-signatures.sh" "$bundle" "$bundle_id" "$role" "$host" "$group"
  bash -c '
set -euo pipefail
source "$1"
bundle="$2"; binary="$3"; role="$4"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-bundle-reverify.XXXXXX")"
trap '\''rm -rf "$temporary"'\'' EXIT
verify_macho "$binary"
write_compiled_identity "$role" "$bundle/Contents/Info.plist" "$temporary/expected.json"
extract_compiled_identity "$binary" arm64 "$temporary/arm64.json"
extract_compiled_identity "$binary" x86_64 "$temporary/x86_64.json"
cmp -s "$temporary/arm64.json" "$temporary/x86_64.json" \
  || release_error "shipped slices have different compiled identities"
cmp -s "$temporary/arm64.json" "$temporary/expected.json" \
  || release_error "compiled identity does not match shipped bundle configuration"
' _ "$NOTARY_RELEASE_DIRECTORY/build-universal.sh" "$bundle" "$binary" "$role"
}

notarize_bundle_main() (
  [[ "$(uname -s)" == Darwin ]] || notary_error "macOS is required"
  [[ "$#" -eq 1 ]] || notary_error "usage: notarize-bundle.sh <signed-app>"
  [[ -n "${NOTARYTOOL_PROFILE:-}" ]] \
    || notary_error "NOTARYTOOL_PROFILE is required in the protected notarization context"
  local bundle="$1" archive response
  [[ -d "$bundle/Contents" ]] || notary_error "signed app bundle is missing"
  for tool in ditto xcrun spctl python3; do require_notary_tool "$tool"; done

  validate_notarized_bundle_contract "$bundle"
  verify_release_bundle_path "$bundle"
  archive="$(mktemp "${TMPDIR:-/tmp}/index-notary-upload.XXXXXX.zip")"
  response="$(mktemp "${TMPDIR:-/tmp}/index-notary-response.XXXXXX.json")"
  trap 'rm -f "$archive" "$response"' EXIT
  rm -f "$archive"
  COPYFILE_DISABLE=1 ditto -c -k --keepParent --norsrc "$bundle" "$archive"
  xcrun notarytool submit "$archive" \
    --keychain-profile "$NOTARYTOOL_PROFILE" --wait --output-format json >"$response"
  parse_accepted_status <"$response"
  xcrun stapler staple "$bundle"
  xcrun stapler validate "$bundle"
  spctl --assess --type execute --verbose=4 "$bundle"
  verify_release_bundle_path "$bundle"
  rm -f "$archive" "$response"
  trap - EXIT
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then notarize_bundle_main "$@"; fi
