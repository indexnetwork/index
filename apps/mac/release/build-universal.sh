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

cleanup_failed_build() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    rm -rf "$DIST_DIRECTORY"
  fi
  rm -rf "$WORK_DIRECTORY"
  exit "$status"
}

# compile_slice(target, arch, output)
compile_slice() {
  local target="$1" arch="$2" output="$3"
  case "$target" in
    app) bash "$MAC_DIRECTORY/IndexApp/build.sh" --release-slice "$arch" "$output" ;;
    connector) bash "$MAC_DIRECTORY/IndexConnector/build.sh" --release-slice "$arch" "$output" ;;
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

write_slice_configuration() {
  local target="$1" destination="$2"
  cat >"$destination" <<EOF
checkout=$INDEX_RELEASE_COMMIT
target=$target
arch-independent-release=$INDEX_RELEASE_VERSION
build=$INDEX_BUILD_NUMBER
api=$INDEX_API_URL
web=$INDEX_WEB_URL
team=$INDEX_EXPECTED_TEAM_ID
protocol=$INDEX_CONNECTOR_PROTOCOL_VERSION
EOF
}

compare_slice_configuration() {
  local arm64="$1" x86_64="$2"
  # Architecture is carried by the filename, not the immutable contents.
  cmp -s "$arm64" "$x86_64" \
    || release_error "native slices were not compiled from one immutable configuration"
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
  cp "$MAC_DIRECTORY/IndexApp/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
  cp "$MAC_DIRECTORY/IndexConnector/Info.plist" "$CONNECTOR_BUNDLE/Contents/Info.plist"
  write_release_config \
    "$APP_BUNDLE/Contents/Info.plist" \
    "$CONNECTOR_BUNDLE/Contents/Info.plist"
  verify_slice_configuration \
    "$APP_BUNDLE/Contents/Info.plist" \
    "$CONNECTOR_BUNDLE/Contents/Info.plist"
  cp "$MAC_DIRECTORY/IndexApp/Resources/index.html" "$APP_BUNDLE/Contents/Resources/index.html"
  cp "$MAC_DIRECTORY/IndexApp/Resources/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
  cp "$MAC_DIRECTORY/IndexApp/Resources/Assets.car" "$APP_BUNDLE/Contents/Resources/Assets.car"
}

main() {
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

  rm -rf "$DIST_DIRECTORY" "$WORK_DIRECTORY"
  mkdir -p "$DIST_DIRECTORY" "$WORK_DIRECTORY"
  trap cleanup_failed_build EXIT
  prepare_bundles

  compile_slice app arm64 "$WORK_DIRECTORY/Index.arm64"
  write_slice_configuration app "$WORK_DIRECTORY/Index.app.arm64.config"
  compile_slice app x86_64 "$WORK_DIRECTORY/Index.x86_64"
  write_slice_configuration app "$WORK_DIRECTORY/Index.app.x86_64.config"
  compile_slice connector arm64 "$WORK_DIRECTORY/IndexConnector.arm64"
  write_slice_configuration connector "$WORK_DIRECTORY/IndexConnector.arm64.config"
  compile_slice connector x86_64 "$WORK_DIRECTORY/IndexConnector.x86_64"
  write_slice_configuration connector "$WORK_DIRECTORY/IndexConnector.x86_64.config"

  compare_slice_configuration \
    "$WORK_DIRECTORY/Index.app.arm64.config" \
    "$WORK_DIRECTORY/Index.app.x86_64.config"
  compare_slice_configuration \
    "$WORK_DIRECTORY/IndexConnector.arm64.config" \
    "$WORK_DIRECTORY/IndexConnector.x86_64.config"

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
  trap - EXIT
  rm -rf "$WORK_DIRECTORY"
}

main "$@"
