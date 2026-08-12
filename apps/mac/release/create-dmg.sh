#!/usr/bin/env bash
# Build two independently-created identical read-only DMGs on a pinned host.
set -euo pipefail
readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$RELEASE_DIRECTORY/notarize-bundle.sh"
package_error() { printf 'production DMG creation refused: %s\n' "$1" >&2; return 1; }
require_package_tool() { command -v "$1" >/dev/null 2>&1 || package_error "$1 is required"; }

validate_reproducible_host() {
  local actual_version actual_build actual_image actual_runner_version
  [[ -n "${INDEX_RELEASE_MACOS_VERSION:-}" && -n "${INDEX_RELEASE_MACOS_BUILD:-}" ]] \
    || package_error "pinned macOS version and build are required"
  [[ "$INDEX_RELEASE_MACOS_VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ && "$INDEX_RELEASE_MACOS_BUILD" =~ ^[A-Za-z0-9]+$ ]] \
    || package_error "pinned macOS values are not canonical"
  actual_version="$(sw_vers -productVersion)"; actual_build="$(sw_vers -buildVersion)"
  [[ "$actual_version" == "$INDEX_RELEASE_MACOS_VERSION" && "$actual_build" == "$INDEX_RELEASE_MACOS_BUILD" ]] \
    || package_error "pinned macOS host does not match"
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    [[ -n "${INDEX_RELEASE_EXPECTED_RUNNER_IMAGE:-}" && -n "${INDEX_RELEASE_EXPECTED_RUNNER_VERSION:-}" ]] \
      || package_error "reviewed expected runner image/version is required"
    actual_image="${ImageOS:-${GITHUB_RUNNER_IMAGE:-}}"
    actual_runner_version="${ImageVersion:-${GITHUB_RUNNER_IMAGE_VERSION:-}}"
    [[ "$actual_image" == "$INDEX_RELEASE_EXPECTED_RUNNER_IMAGE" && "$actual_runner_version" == "$INDEX_RELEASE_EXPECTED_RUNNER_VERSION" ]] \
      || package_error "actual runner image/version does not match reviewed runner pins"
  fi
}

validate_dmg_contract() {
  local name expected; name="$(basename "$1")"
  case "$name" in Index.app) expected="Index-macOS-1.0.0-universal.dmg";; IndexConnector.app) expected="IndexConnector-1.0.0-universal.dmg";; *) package_error "unapproved product"; return 1;; esac
  [[ "$(basename "$2")" == "$expected" ]] || package_error "DMG name must be $expected"
}
require_stapled_pair() { local d="$1" b; verify_release_directory "$d"; for b in "$d/Index.app" "$d/IndexConnector.app"; do xcrun stapler validate "$b"; spctl --assess --type execute --verbose=4 "$b"; done; verify_release_directory "$d"; }

normalize_tree() { python3 - "$1" "${SOURCE_DATE_EPOCH:-0}" <<'PY'
import os,sys
root=sys.argv[1]; epoch=int(sys.argv[2])
for d,ns,fs in os.walk(root):
 for n in ns+fs: os.utime(os.path.join(d,n),(epoch,epoch),follow_symlinks=False)
os.utime(root,(epoch,epoch),follow_symlinks=False)
PY
}
sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
build_dmg_once() {
  local staged="$1" product="$2" destination="$3"
  hdiutil create -quiet -ov -format UDRO -fs HFS+ -imagekey hfsplus-sparse-band-size=0 \
    -volname "$(basename "$product" .app)" -srcfolder "$staged" "$destination"
}

create_dmg_main() (
  [[ "$(uname -s)" == Darwin ]] || package_error "macOS is required"; [[ "$#" -eq 2 ]] || package_error "usage"
  local bundle="$1" output="$2" signed temporary stage product first second evidence
  validate_reproducible_host; validate_dmg_contract "$bundle" "$output"
  for t in hdiutil ditto xcrun spctl python3 shasum sw_vers; do require_package_tool "$t"; done
  signed="$(cd "$(dirname "$bundle")" && pwd)"; require_stapled_pair "$signed"
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/index-dmg-transaction.XXXXXX")"; trap 'rm -rf "$temporary"' EXIT
  stage="$temporary/stage"; mkdir "$stage"; product="$stage/$(basename "$bundle")"
  COPYFILE_DISABLE=1 ditto --norsrc "$bundle" "$product"
  validate_exact_product_tree "$stage" "$product"; verify_release_bundle_path "$product"; normalize_tree "$stage"
  first="$temporary/first.dmg"; second="$temporary/second.dmg"
  build_dmg_once "$stage" "$bundle" "$first"; build_dmg_once "$stage" "$bundle" "$second"
  cmp -s "$first" "$second" || package_error "independent deterministic DMG hashes differ"
  [[ "$(sha256 "$first")" == "$(sha256 "$second")" ]] || package_error "independent deterministic DMG hashes differ"
  # Credential-free evidence binds the reviewed host/toolchain and equal bytes.
  evidence="$temporary/reproducibility.txt"
  printf 'macOS.actual=%s\nmacOS.expected=%s\nbuild.actual=%s\nbuild.expected=%s\nrunner.actual=%s:%s\nrunner.expected=%s:%s\nartifact.sha256=%s\n' \
    "$(sw_vers -productVersion)" "$INDEX_RELEASE_MACOS_VERSION" "$(sw_vers -buildVersion)" "$INDEX_RELEASE_MACOS_BUILD" \
    "${ImageOS:-${GITHUB_RUNNER_IMAGE:-non-github}}" "${ImageVersion:-${GITHUB_RUNNER_IMAGE_VERSION:-non-github}}" \
    "${INDEX_RELEASE_EXPECTED_RUNNER_IMAGE:-non-github}" "${INDEX_RELEASE_EXPECTED_RUNNER_VERSION:-non-github}" "$(sha256 "$first")" >"$evidence"
  [[ ! -e "$output" && ! -e "${output}.reproducibility.txt" ]] || package_error "refusing to overwrite an existing candidate"
  mkdir -p "$(dirname "$output")"
  mv "$evidence" "${output}.reproducibility.txt"
  mv "$first" "$output"
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then create_dmg_main "$@"; fi
