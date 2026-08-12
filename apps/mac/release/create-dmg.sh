#!/usr/bin/env bash
# Package one already-notarized/stapled production bundle into an exact,
# read-only DMG. No signing or provider operation occurs here.
set -euo pipefail

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=release-config.sh
source "$RELEASE_DIRECTORY/release-config.sh"
# shellcheck source=notarize-bundle.sh
source "$RELEASE_DIRECTORY/notarize-bundle.sh"

package_error() {
  printf 'production DMG creation refused: %s\n' "$1" >&2
  return 1
}

require_package_tool() {
  command -v "$1" >/dev/null 2>&1 || package_error "$1 is required"
}

validate_dmg_contract() {
  local bundle="$1" output="$2" name expected
  name="$(basename "$bundle")"
  case "$name" in
    Index.app) expected="Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg" ;;
    IndexConnector.app) expected="IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg" ;;
    *) package_error "only Index.app or IndexConnector.app may be packaged"; return 1 ;;
  esac
  [[ "$(basename "$output")" == "$expected" ]] \
    || package_error "DMG name must be $expected"
}

require_stapled_pair() {
  local signed_directory="$1" bundle
  verify_release_directory "$signed_directory"
  for bundle in "$signed_directory/Index.app" "$signed_directory/IndexConnector.app"; do
    xcrun stapler validate "$bundle"
    spctl --assess --type execute --verbose=4 "$bundle"
  done
  # Reverify after staple/Gatekeeper checks, immediately before packaging.
  verify_release_directory "$signed_directory"
}

create_dmg_main() (
  [[ "$(uname -s)" == Darwin ]] || package_error "macOS is required"
  [[ "$#" -eq 2 ]] || package_error "usage: create-dmg.sh <stapled-app> <output.dmg>"
  local bundle="$1" output="$2" signed_directory stage temporary source_epoch
  [[ -d "$bundle/Contents" ]] || package_error "stapled app bundle is missing"
  [[ -n "${INDEX_RELEASE_VERSION:-}" ]] || package_error "INDEX_RELEASE_VERSION is required"
  validate_release_version "$INDEX_RELEASE_VERSION"
  [[ "$INDEX_RELEASE_VERSION" == "$INDEX_FIRST_PRODUCTION_VERSION" ]] \
    || package_error "INDEX_RELEASE_VERSION must equal $INDEX_FIRST_PRODUCTION_VERSION"
  validate_dmg_contract "$bundle" "$output"
  for tool in hdiutil ditto xcrun spctl python3; do require_package_tool "$tool"; done
  signed_directory="$(cd "$(dirname "$bundle")" && pwd)"
  [[ -d "$signed_directory/Index.app" && -d "$signed_directory/IndexConnector.app" ]] \
    || package_error "both signed sibling bundles are required before packaging"
  require_stapled_pair "$signed_directory"

  temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-dmg-stage.XXXXXX")"
  trap 'rm -rf "$temporary" "${output}.incomplete"' EXIT
  stage="$temporary/root"
  mkdir -p "$stage"
  COPYFILE_DISABLE=1 ditto --norsrc "$bundle" "$stage/$(basename "$bundle")"
  source_epoch="${SOURCE_DATE_EPOCH:-0}"
  [[ "$source_epoch" =~ ^[0-9]+$ ]] || package_error "SOURCE_DATE_EPOCH must be a non-negative integer"
  python3 - "$stage" "$source_epoch" <<'PY'
import os, sys
root, epoch = sys.argv[1], int(sys.argv[2])
for directory, names, files in os.walk(root):
    for name in names + files:
        os.utime(os.path.join(directory, name), (epoch, epoch), follow_symlinks=False)
os.utime(root, (epoch, epoch), follow_symlinks=False)
PY
  rm -f "$output" "${output}.incomplete"
  mkdir -p "$(dirname "$output")"
  # UDRO is read-only. Fixed volume metadata and normalized staged mtimes make
  # creation deterministic to the extent supported by the installed hdiutil.
  hdiutil create -quiet -ov -format UDRO -fs HFS+ \
    -volname "$(basename "$bundle" .app)" -srcfolder "$stage" "${output}.incomplete"
  mv "${output}.incomplete" "$output"
  rm -rf "$temporary"
  trap - EXIT
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then create_dmg_main "$@"; fi
