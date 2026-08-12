#!/usr/bin/env bash
# Notarize, staple, and reverify one already-signed production app bundle.
set -euo pipefail
set +x

NOTARY_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTARY_MAC_DIRECTORY="$(cd "$NOTARY_RELEASE_DIRECTORY/.." && pwd)"

# Never trust caller-populated authority variables. Preserve them only to prove
# that immutable committed pins replace them exactly.
_PRESET_TEAM_ID="${INDEX_PRODUCTION_TEAM_ID-}"
_PRESET_APP_ID="${INDEX_APP_BUNDLE_ID-}"
_PRESET_CONNECTOR_ID="${INDEX_CONNECTOR_BUNDLE_ID-}"
_PRESET_VERSION="${INDEX_FIRST_PRODUCTION_VERSION-}"
unset INDEX_PRODUCTION_TEAM_ID INDEX_APP_BUNDLE_ID INDEX_CONNECTOR_BUNDLE_ID INDEX_FIRST_PRODUCTION_VERSION
# shellcheck source=release-config.sh
source "$NOTARY_RELEASE_DIRECTORY/release-config.sh"
if { [[ -n "$_PRESET_TEAM_ID" && "$_PRESET_TEAM_ID" != "LMQ3XNXLAD" ]] ||
     [[ -n "$_PRESET_APP_ID" && "$_PRESET_APP_ID" != "network.index.system6" ]] ||
     [[ -n "$_PRESET_CONNECTOR_ID" && "$_PRESET_CONNECTOR_ID" != "network.index.connector" ]] ||
     [[ -n "$_PRESET_VERSION" && "$_PRESET_VERSION" != "1.0.0" ]] ||
     [[ "$INDEX_PRODUCTION_TEAM_ID" != "LMQ3XNXLAD" ]] ||
     [[ "$INDEX_APP_BUNDLE_ID" != "network.index.system6" ]] ||
     [[ "$INDEX_CONNECTOR_BUNDLE_ID" != "network.index.connector" ]] ||
     [[ "$INDEX_FIRST_PRODUCTION_VERSION" != "1.0.0" ]]; }; then
  printf 'production bundle notarization refused: immutable production release pins do not match literals\n' >&2
  return 1 2>/dev/null || exit 1
fi
unset _PRESET_TEAM_ID _PRESET_APP_ID _PRESET_CONNECTOR_ID _PRESET_VERSION

notary_error() { printf 'production bundle notarization refused: %s\n' "$1" >&2; return 1; }
require_notary_tool() { command -v "$1" >/dev/null 2>&1 || notary_error "$1 is required"; }

parse_accepted_status() {
  python3 -c 'import json,sys
try: value=json.load(sys.stdin)
except Exception: raise SystemExit(2)
if not isinstance(value,dict) or value.get("status") != "Accepted": raise SystemExit(1)' \
    || notary_error "notary submission status was malformed or not Accepted"
}

validate_zip_inventory() {
  local archive="$1" expected="$2"
  python3 - "$archive" "$expected" <<'PY' || notary_error "submission ZIP inventory contains extra roots, traversal, or a symlink"
import pathlib, stat, sys, zipfile
archive, expected = sys.argv[1:]
with zipfile.ZipFile(archive) as value:
    entries=value.infolist()
    if not entries: raise SystemExit(1)
    for item in entries:
        path=pathlib.PurePosixPath(item.filename)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != expected:
            raise SystemExit(1)
        mode=(item.external_attr >> 16) & 0xffff
        if stat.S_ISLNK(mode): raise SystemExit(1)
PY
}

validate_exact_product_tree() {
  local root="$1" expected="$2"
  python3 - "$root" "$expected" <<'PY' || notary_error "product inventory contains extra content, a symlink, or an unsafe path"
import os, stat, sys
root, expected = map(os.path.abspath, sys.argv[1:])
if os.path.basename(expected) not in ('Index.app','IndexConnector.app') or os.path.dirname(expected) != root:
    raise SystemExit(1)
st = os.lstat(root)
if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode): raise SystemExit(1)
if os.listdir(root) != [os.path.basename(expected)]: raise SystemExit(1)
for directory, names, files in os.walk(root, followlinks=False):
    for name in names + files:
        path=os.path.join(directory,name); st=os.lstat(path)
        if stat.S_ISLNK(st.st_mode): raise SystemExit(1)
        real=os.path.realpath(path)
        if os.path.commonpath((root,real)) != root: raise SystemExit(1)
PY
}

validate_notarized_bundle_contract() {
  local bundle="$1" plist="$bundle/Contents/Info.plist" version
  version="$(python3 - "$plist" <<'PY'
import plistlib,sys
try: value=plistlib.load(open(sys.argv[1], 'rb'))
except Exception: raise SystemExit(1)
if value.get('IndexReleaseChannel') != 'production' or value.get('IndexDevelopmentBuild') is not False: raise SystemExit(1)
print(value.get('IndexReleaseVersion', ''))
PY
)" || notary_error "bundle release configuration is malformed or non-production"
  [[ "$version" == "1.0.0" ]] || notary_error "bundle release version must equal 1.0.0"
  [[ -z "${INDEX_RELEASE_VERSION:-}" || "$INDEX_RELEASE_VERSION" == "$version" ]] \
    || notary_error "requested release version does not match the bundle"
}

verify_release_directory() {
  local directory="$1"
  bash "$NOTARY_RELEASE_DIRECTORY/verify-signatures.sh" "$directory"
  bash -c 'set -euo pipefail; source "$1"; for item in Index IndexConnector; do
    if [[ "$item" == Index ]]; then bundle="$2/Index.app"; role=app; else bundle="$2/IndexConnector.app"; role=connector; fi
    binary="$bundle/Contents/MacOS/$item"; tmp="$(mktemp -d)"; trap '\''rm -rf "$tmp"'\'' EXIT
    verify_macho "$binary"; write_compiled_identity "$role" "$bundle/Contents/Info.plist" "$tmp/expected"
    extract_compiled_identity "$binary" arm64 "$tmp/arm"; extract_compiled_identity "$binary" x86_64 "$tmp/x86"
    cmp -s "$tmp/arm" "$tmp/x86" && cmp -s "$tmp/arm" "$tmp/expected" || release_error "compiled identity mismatch"
    rm -rf "$tmp"; trap - EXIT
  done' _ "$NOTARY_RELEASE_DIRECTORY/build-universal.sh" "$directory"
}

verify_release_bundle_path() {
  local bundle="$1" name role id host group binary
  name="$(basename "$bundle")"
  case "$name" in
    Index.app) role=app; id="network.index.system6"; host=index.network; group="LMQ3XNXLAD.network.index.system6.owner-credentials"; binary="$bundle/Contents/MacOS/Index" ;;
    IndexConnector.app) role=connector; id="network.index.connector"; host=''; group="LMQ3XNXLAD.network.index.connector.credentials"; binary="$bundle/Contents/MacOS/IndexConnector" ;;
    *) notary_error "bundle must be Index.app or IndexConnector.app"; return 1 ;;
  esac
  bash -c 'set -euo pipefail; source "$1"; verify_release_bundle "$2" "$3" "$4" "$5" "$6"' \
    _ "$NOTARY_RELEASE_DIRECTORY/verify-signatures.sh" "$bundle" "$id" "$role" "$host" "$group"
  bash -c 'set -euo pipefail; source "$1"; bundle="$2"; binary="$3"; role="$4"; tmp="$(mktemp -d)"; trap '\''rm -rf "$tmp"'\'' EXIT
    verify_macho "$binary"; write_compiled_identity "$role" "$bundle/Contents/Info.plist" "$tmp/expected"
    extract_compiled_identity "$binary" arm64 "$tmp/arm"; extract_compiled_identity "$binary" x86_64 "$tmp/x86"
    cmp -s "$tmp/arm" "$tmp/x86" && cmp -s "$tmp/arm" "$tmp/expected" || release_error "compiled identity mismatch"' \
    _ "$NOTARY_RELEASE_DIRECTORY/build-universal.sh" "$bundle" "$binary" "$role"
}

notarize_bundle_main() (
  [[ "$(uname -s)" == Darwin ]] || notary_error "macOS is required"
  [[ "$#" -eq 1 ]] || notary_error "usage: notarize-bundle.sh <signed-app>"
  [[ -n "${NOTARYTOOL_PROFILE:-}" ]] || notary_error "NOTARYTOOL_PROFILE is required"
  local bundle="$1" archive response extraction
  [[ -d "$bundle/Contents" ]] || notary_error "signed app bundle is missing"
  for tool in ditto xcrun spctl python3; do require_notary_tool "$tool"; done
  validate_notarized_bundle_contract "$bundle"; verify_release_bundle_path "$bundle"
  archive="$(mktemp "${TMPDIR:-/tmp}/index-notary-upload.XXXXXX.zip")"; response="$(mktemp)"; extraction="$(mktemp -d)"
  trap 'rm -rf "$archive" "$response" "$extraction"' EXIT; rm -f "$archive"
  COPYFILE_DISABLE=1 ditto -c -k --keepParent --norsrc "$bundle" "$archive"
  validate_zip_inventory "$archive" "$(basename "$bundle")"
  ditto -x -k "$archive" "$extraction"
  validate_exact_product_tree "$extraction" "$extraction/$(basename "$bundle")"
  verify_release_bundle_path "$extraction/$(basename "$bundle")"
  xcrun notarytool submit "$archive" --keychain-profile "$NOTARYTOOL_PROFILE" --wait --output-format json >"$response"
  parse_accepted_status <"$response"
  xcrun stapler staple "$bundle"; xcrun stapler validate "$bundle"; spctl --assess --type execute --verbose=4 "$bundle"
  verify_release_bundle_path "$bundle"
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then notarize_bundle_main "$@"; fi
