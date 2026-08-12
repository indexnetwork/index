#!/usr/bin/env bash
# Mount a final DMG read-only and verify the bundle from mounted bytes only.
set -euo pipefail

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=notarize-bundle.sh
source "$RELEASE_DIRECTORY/notarize-bundle.sh"

mounted_error() {
  printf 'mounted DMG verification refused: %s\n' "$1" >&2
  return 1
}

mounted_bundle_name() {
  case "$(basename "$1")" in
    "Index-macOS-${INDEX_FIRST_PRODUCTION_VERSION}-universal.dmg") printf 'Index.app\n' ;;
    "IndexConnector-${INDEX_FIRST_PRODUCTION_VERSION}-universal.dmg") printf 'IndexConnector.app\n' ;;
    *) mounted_error "DMG filename does not identify an approved product" ;;
  esac
}

parse_exact_mount_point() {
  local expected="$1"
  python3 -c 'import plistlib,sys
expected=sys.argv[1]
try:
 value=plistlib.loads(sys.stdin.buffer.read())
 points=[entity.get("mount-point") for entity in value.get("system-entities",[]) if entity.get("mount-point")]
except Exception:
 raise SystemExit(1)
if points != [expected]:
 raise SystemExit(1)' "$expected" || mounted_error "hdiutil mount output was malformed or named an unexpected mount"
}

verify_mounted_dmg_main() (
  [[ "$(uname -s)" == Darwin ]] || mounted_error "macOS is required"
  [[ "$#" -eq 1 ]] || mounted_error "usage: verify-mounted-dmg.sh <final.dmg>"
  local dmg="$1" attach_plist mount_point bundle_name mounted_bundle status=0 mounted=0
  [[ -f "$dmg" ]] || mounted_error "DMG is missing"
  for tool in hdiutil python3; do command -v "$tool" >/dev/null 2>&1 || mounted_error "$tool is required"; done
  bundle_name="$(mounted_bundle_name "$dmg")"
  attach_plist="$(mktemp "${TMPDIR:-/tmp}/index-dmg-attach.XXXXXX.plist")"
  mount_point="$(mktemp -d "${TMPDIR:-/tmp}/index-dmg-mount.XXXXXX")"
  cleanup_mounted_dmg() {
    local cleanup_status=$?
    if [[ "$mounted" -eq 1 ]]; then
      hdiutil detach "$mount_point" >/dev/null 2>&1 || cleanup_status=1
    fi
    rm -f "$attach_plist"
    rmdir "$mount_point" >/dev/null 2>&1 || cleanup_status=1
    return "$cleanup_status"
  }
  # The known mountpoint makes detachment possible even if plist parsing fails.
  trap cleanup_mounted_dmg EXIT
  # Attempt detachment even if hdiutil mounts successfully but then reports an
  # error before returning; a failed detach keeps the result failed closed.
  mounted=1
  hdiutil attach -readonly -nobrowse -mountpoint "$mount_point" -plist "$dmg" >"$attach_plist"
  parse_exact_mount_point "$mount_point" <"$attach_plist"
  mounted_bundle="$mount_point/$bundle_name"
  [[ -d "$mounted_bundle/Contents" ]] || mounted_error "expected bundle is absent from mounted DMG"
  # This exact mounted path, never apps/mac/dist/signed or staging, is passed to
  # Task 3 signing verification and Task 2 architecture/config verification.
  verify_release_bundle_path "$mounted_bundle" || status=$?
  [[ "$status" -eq 0 ]] || exit "$status"
  trap - EXIT
  cleanup_mounted_dmg
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then verify_mounted_dmg_main "$@"; fi
