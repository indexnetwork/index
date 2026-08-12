#!/usr/bin/env bash
# Mount read-only and verify only canonical, link-free mounted bytes.
set -euo pipefail
readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$RELEASE_DIRECTORY/notarize-bundle.sh"
mounted_error() { printf 'mounted DMG verification refused: %s\n' "$1" >&2; return 1; }
mounted_bundle_name() { case "$(basename "$1")" in Index-macOS-1.0.0-universal.dmg) echo Index.app;; IndexConnector-1.0.0-universal.dmg) echo IndexConnector.app;; *) mounted_error "unapproved DMG filename";; esac; }
parse_exact_mount_point() { local expected="$1"; python3 -c 'import plistlib,sys
try: v=plistlib.loads(sys.stdin.buffer.read()); p=[e.get("mount-point") for e in v.get("system-entities",[]) if e.get("mount-point")]
except Exception: raise SystemExit(1)
if p != [sys.argv[1]]: raise SystemExit(1)' "$expected" || mounted_error "attach parser rejected mount output"; }

validate_mounted_inventory() {
  local mount="$1" expected="$2"
  python3 - "$mount" "$expected" <<'PY' || mounted_error "mounted inventory contains extra content, a symlink, or an escaping path"
import os,stat,sys
root=os.path.realpath(os.path.abspath(sys.argv[1])); expected=sys.argv[2]
allowed_dirs={'.Trashes','.fseventsd','.Spotlight-V100'}
allowed_files={'.metadata_never_index'}
entries=set(os.listdir(root))
if expected not in entries or not entries <= {expected}|allowed_dirs|allowed_files: raise SystemExit(1)
for name in entries-{expected}:
 p=os.path.join(root,name); st=os.lstat(p)
 if stat.S_ISLNK(st.st_mode): raise SystemExit(1)
 if name in allowed_dirs:
  if not stat.S_ISDIR(st.st_mode) or os.listdir(p): raise SystemExit(1)
 elif name in allowed_files:
  if not stat.S_ISREG(st.st_mode) or st.st_size != 0: raise SystemExit(1)
product=os.path.join(root,expected); st=os.lstat(product)
if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode): raise SystemExit(1)
for d,ns,fs in os.walk(product,followlinks=False):
 for n in ns+fs:
  p=os.path.join(d,n); st=os.lstat(p)
  if stat.S_ISLNK(st.st_mode): raise SystemExit(1)
  if os.path.commonpath((root,os.path.realpath(p))) != root: raise SystemExit(1)
PY
}
canonical_mounted_bundle() {
  local mount="$1" name="$2" canonical_mount canonical_bundle
  canonical_mount="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$mount")"
  canonical_bundle="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$mount/$name")"
  [[ "$canonical_bundle" == "$canonical_mount/$name" ]] || mounted_error "canonical product escapes private mount"
  printf '%s\n' "$canonical_bundle"
}

verify_mounted_dmg_main() (
  [[ "$(uname -s)" == Darwin ]] || mounted_error "macOS is required"; [[ "$#" -eq 1 ]] || mounted_error "usage"
  local dmg="$1" plist mount name bundle mounted=0 status=0
  [[ -f "$dmg" && ! -L "$dmg" ]] || mounted_error "DMG is missing or linked"
  name="$(mounted_bundle_name "$dmg")"; plist="$(mktemp)"; mount="$(mktemp -d "${TMPDIR:-/tmp}/index-dmg-mount.XXXXXX")"
  cleanup() { local cleanup_status=$?; if [[ "$mounted" -eq 1 ]]; then hdiutil detach "$mount" || cleanup_status=1; fi; rm -f "$plist"; rmdir "$mount" >/dev/null 2>&1 || cleanup_status=1; return "$cleanup_status"; }
  trap cleanup EXIT
  hdiutil attach -readonly -nobrowse -mountpoint "$mount" -plist "$dmg" >"$plist"
  mounted=1
  parse_exact_mount_point "$mount" <"$plist"; validate_mounted_inventory "$mount" "$name"
  bundle="$(canonical_mounted_bundle "$mount" "$name")"
  verify_release_bundle_path "$bundle" || status=$?; [[ "$status" -eq 0 ]] || exit "$status"
  trap - EXIT; cleanup
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then verify_mounted_dmg_main "$@"; fi
