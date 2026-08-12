#!/usr/bin/env bash
# Build credential-free, ad-hoc Universal 2 production bundles from one checkout.
set -euo pipefail

readonly RELEASE_DIRECTORY="$(cd "$(dirname "$0")" && pwd)"
readonly MAC_DIRECTORY="$(cd "$RELEASE_DIRECTORY/.." && pwd)"
readonly REPO_ROOT="$(cd "$MAC_DIRECTORY/../.." && pwd)"
readonly DIST_DIRECTORY="$MAC_DIRECTORY/dist/unsigned"
readonly WORK_DIRECTORY="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/index-universal-build"
readonly APP_BUNDLE="$DIST_DIRECTORY/Index.app"
readonly CONNECTOR_BUNDLE="$DIST_DIRECTORY/IndexConnector.app"
readonly APP_BINARY="$APP_BUNDLE/Contents/MacOS/Index"
readonly CONNECTOR_BINARY="$CONNECTOR_BUNDLE/Contents/MacOS/IndexConnector"

release_error() {
  printf 'Universal 2 release build refused: %s\n' "$1" >&2
  return 1
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || release_error "$1 is required"
}

require_clean_release_inputs() {
  [[ "$(uname -s)" == "Darwin" ]] || release_error "macOS is required"
  local name
  for name in CODESIGN_IDENTITY PROVISIONING_PROFILE INDEX_DEVELOPMENT_BUILD INDEX_CONNECTOR_NONPRODUCTION_BUILD; do
    [[ -z "${!name:-}" ]] || release_error "$name is forbidden for the unsigned production build"
  done
  [[ "$#" -eq 0 ]] || release_error "this build accepts immutable environment inputs only"
}

cleanup_build() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    rm -rf "$DIST_DIRECTORY"
  fi
  rm -rf "$WORK_DIRECTORY"
  exit "$status"
}

# compile_slice(target, arch, output)
compile_slice() {
  local target="$1" arch="$2" output="$3" identity
  case "$target" in
    app)
      identity="$WORK_DIRECTORY/Index.app.identity.json"
      bash "$MAC_DIRECTORY/scripts/build.sh" --release-slice "$arch" "$output" "$identity"
      ;;
    connector)
      identity="$WORK_DIRECTORY/IndexConnector.identity.json"
      bash "$MAC_DIRECTORY/IndexConnector/build.sh" --release-slice "$arch" "$output" "$identity"
      ;;
    *) release_error "unknown native target: $target" ;;
  esac
}

# merge_universal(arm64, x86_64, output)
merge_universal() {
  local arm64="$1" x86_64="$2" output="$3"
  mkdir -p "$(dirname "$output")"
  lipo -create "$arm64" "$x86_64" -output "$output"
  chmod 0755 "$output"
}

verify_architectures() {
  local binary="$1" archs
  archs="$(lipo -archs "$binary")"
  [[ " $archs " == *" arm64 "* && " $archs " == *" x86_64 "* ]] \
    || release_error "$binary is not Universal 2: $archs"
  [[ "$(wc -w <<<"$archs" | tr -d ' ')" == "2" ]] \
    || release_error "$binary contains unexpected architectures: $archs"
}

verify_deployment_target() {
  local binary="$1" arch details
  for arch in arm64 x86_64; do
    details="$(otool -arch "$arch" -l "$binary")"
    grep -Fq 'LC_BUILD_VERSION' <<<"$details" \
      || release_error "$binary $arch has no LC_BUILD_VERSION"
    [[ "$(awk '/LC_BUILD_VERSION/{seen=1; next} seen && $1=="minos" {print $2; exit}' <<<"$details")" == "13.0" ]] \
      || release_error "$binary $arch does not declare minos 13.0"
  done
}

# verify_macho(binary)
verify_macho() {
  local binary="$1"
  [[ -x "$binary" ]] || release_error "missing executable $binary"
  verify_architectures "$binary"
  verify_deployment_target "$binary"
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

# write_compiled_identity(target, plist, destination)
write_compiled_identity() {
  local target="$1" plist="$2" destination="$3"
  python3 - "$target" "$plist" "$destination" <<'PY'
import hashlib
import json
import plistlib
import sys

target, plist_path, destination = sys.argv[1:]
with open(plist_path, 'rb') as stream:
    plist = plistlib.load(stream)
keys = [
    'CFBundleIdentifier',
    'CFBundleShortVersionString',
    'CFBundleVersion',
    'IndexReleaseChannel',
    'IndexReleaseVersion',
    'IndexReleaseCommit',
    'IndexAPIURL',
    'IndexWebURL',
    'IndexExpectedTeamID',
    'IndexConnectorProtocolVersion',
    'IndexDevelopmentBuild',
]
if target == 'app':
    keys.append('IndexOwnerKeychainAccessGroup')
identity = {'IndexBuildTarget': target, **{key: plist[key] for key in keys}}
canonical = json.dumps(identity, sort_keys=True, separators=(',', ':'))
identity['IndexBuildID'] = hashlib.sha256(canonical.encode()).hexdigest()
with open(destination, 'w', encoding='utf-8') as stream:
    json.dump(identity, stream, sort_keys=True, separators=(',', ':'))
    stream.write('\n')
PY
}

# extract_compiled_identity(binary, arch, destination)
extract_compiled_identity() {
  local binary="$1" arch="$2" destination="$3" hex
  hex="$(otool -arch "$arch" -s __TEXT __indexcfg "$binary" | awk 'NF >= 2 && $1 ~ /^[[:xdigit:]]+$/ { for (i = 2; i <= NF; i++) if ($i ~ /^[[:xdigit:]]+$/ && length($i) >= 2 && length($i) % 2 == 0) printf "%s", $i }')"
  [[ -n "$hex" ]] || { release_error "$binary $arch has no compiled identity section"; return 1; }
  python3 - "$hex" "$destination" <<'PY'
import binascii
import json
import sys

raw = binascii.unhexlify(sys.argv[1]).rstrip(b'\0')
identity = json.loads(raw.decode('utf-8'))
with open(sys.argv[2], 'w', encoding='utf-8') as stream:
    json.dump(identity, stream, sort_keys=True, separators=(',', ':'))
    stream.write('\n')
PY
}

compare_compiled_identities() {
  local arm_binary="$1" x86_binary="$2" expected="$3" prefix="$4"
  local arm_export="$WORK_DIRECTORY/${prefix}.arm64.exported.json"
  local x86_export="$WORK_DIRECTORY/${prefix}.x86_64.exported.json"
  extract_compiled_identity "$arm_binary" arm64 "$arm_export"
  extract_compiled_identity "$x86_binary" x86_64 "$x86_export"
  cmp -s "$arm_export" "$x86_export" \
    || release_error "$prefix slices have different compiled identities"
  cmp -s "$arm_export" "$expected" \
    || release_error "$prefix compiled identity does not match generated bundle configuration"
}

verify_slice_configuration() {
  local app_plist="$1" connector_plist="$2"
  local app_commit connector_commit app_version connector_version
  app_commit="$(plist_value "$app_plist" IndexReleaseCommit)"
  connector_commit="$(plist_value "$connector_plist" IndexReleaseCommit)"
  app_version="$(plist_value "$app_plist" IndexReleaseVersion)"
  connector_version="$(plist_value "$connector_plist" IndexReleaseVersion)"
  [[ "$app_commit" == "$connector_commit" && "$app_commit" == "$INDEX_RELEASE_COMMIT" ]] \
    || release_error "bundle release commits do not match the checkout configuration"
  [[ "$app_version" == "$connector_version" && "$app_version" == "$INDEX_RELEASE_VERSION" ]] \
    || release_error "bundle release versions do not match the checkout configuration"
}

prepare_bundles() {
  mkdir -p \
    "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" \
    "$CONNECTOR_BUNDLE/Contents/MacOS"
  cp "$MAC_DIRECTORY/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
  cp "$MAC_DIRECTORY/IndexConnector/Info.plist" "$CONNECTOR_BUNDLE/Contents/Info.plist"
  write_release_config \
    "$APP_BUNDLE/Contents/Info.plist" \
    "$CONNECTOR_BUNDLE/Contents/Info.plist"
  verify_slice_configuration \
    "$APP_BUNDLE/Contents/Info.plist" \
    "$CONNECTOR_BUNDLE/Contents/Info.plist"
  cp "$MAC_DIRECTORY/Resources/index.html" "$APP_BUNDLE/Contents/Resources/index.html"
  cp "$MAC_DIRECTORY/Resources/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
  cp "$MAC_DIRECTORY/Resources/Assets.car" "$APP_BUNDLE/Contents/Resources/Assets.car"
}

main() {
  trap cleanup_build EXIT
  # Remove stale/incomplete artifacts before platform, tool, or input checks.
  rm -rf "$DIST_DIRECTORY" "$WORK_DIRECTORY"

  require_clean_release_inputs "$@"
  require_tool swiftc
  require_tool lipo
  require_tool otool
  require_tool codesign
  require_tool python3

  # Immutable configuration is validated before build output is changed.
  # shellcheck source=release-config.sh
  source "$RELEASE_DIRECTORY/release-config.sh"
  validate_release_inputs
  [[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$INDEX_RELEASE_COMMIT" ]] \
    || release_error "INDEX_RELEASE_COMMIT must equal the one checked-out commit"

  mkdir -p "$DIST_DIRECTORY" "$WORK_DIRECTORY"
  prepare_bundles

  local app_identity="$WORK_DIRECTORY/Index.app.identity.json"
  local connector_identity="$WORK_DIRECTORY/IndexConnector.identity.json"
  write_compiled_identity app "$APP_BUNDLE/Contents/Info.plist" "$app_identity"
  write_compiled_identity connector "$CONNECTOR_BUNDLE/Contents/Info.plist" "$connector_identity"

  compile_slice app arm64 "$WORK_DIRECTORY/Index.arm64"
  compile_slice app x86_64 "$WORK_DIRECTORY/Index.x86_64"
  compile_slice connector arm64 "$WORK_DIRECTORY/IndexConnector.arm64"
  compile_slice connector x86_64 "$WORK_DIRECTORY/IndexConnector.x86_64"

  compare_compiled_identities \
    "$WORK_DIRECTORY/Index.arm64" "$WORK_DIRECTORY/Index.x86_64" \
    "$app_identity" Index
  compare_compiled_identities \
    "$WORK_DIRECTORY/IndexConnector.arm64" "$WORK_DIRECTORY/IndexConnector.x86_64" \
    "$connector_identity" IndexConnector

  merge_universal "$WORK_DIRECTORY/Index.arm64" "$WORK_DIRECTORY/Index.x86_64" "$APP_BINARY"
  merge_universal \
    "$WORK_DIRECTORY/IndexConnector.arm64" \
    "$WORK_DIRECTORY/IndexConnector.x86_64" \
    "$CONNECTOR_BINARY"

  verify_macho "$APP_BINARY"
  verify_macho "$CONNECTOR_BINARY"

  # Development label means distribution posture only: configuration remains
  # production and no development compile flag or endpoint override is used.
  codesign --force --deep --sign - "$APP_BUNDLE"
  codesign --force --deep --sign - "$CONNECTOR_BUNDLE"
  codesign --verify --strict "$APP_BUNDLE"
  codesign --verify --strict "$CONNECTOR_BUNDLE"

  printf 'Built unsigned/ad-hoc development-labeled Universal 2 bundles in apps/mac/dist/unsigned\n'
  lipo -archs "$APP_BINARY"
  lipo -archs "$CONNECTOR_BINARY"
  rm -rf "$WORK_DIRECTORY"
  trap - EXIT
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
