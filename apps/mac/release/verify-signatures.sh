#!/usr/bin/env bash
# Verify the complete Developer ID/Hardened Runtime signing contract provider-free.
# This script reads signed bundles and profiles; it never signs or accesses secrets.
set -euo pipefail

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MAC_DIRECTORY="$(cd "$RELEASE_DIRECTORY/.." && pwd)"
readonly DEFAULT_SIGNED_DIRECTORY="$MAC_DIRECTORY/dist/signed"

# shellcheck source=release-config.sh
source "$RELEASE_DIRECTORY/release-config.sh"
# shellcheck source=../IndexApp/provisioning-profile.sh
source "$MAC_DIRECTORY/IndexApp/provisioning-profile.sh"

verify_error() {
  printf 'production signature verification refused: %s\n' "$1" >&2
  return 1
}

require_verify_tool() {
  command -v "$1" >/dev/null 2>&1 || verify_error "$1 is required"
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

require_bundle_identity() {
  local bundle="$1" expected_bundle_id="$2" actual team_config
  actual="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)" \
    || verify_error "could not read a bundle identifier"
  [[ "$actual" == "$expected_bundle_id" ]] \
    || verify_error "bundle identifier does not match the release contract"
  team_config="$(plist_value "$bundle/Contents/Info.plist" IndexExpectedTeamID)" \
    || verify_error "could not read embedded Team ID authority"
  [[ "$team_config" == "$INDEX_PRODUCTION_TEAM_ID" ]] \
    || verify_error "embedded Team ID authority does not match the independent release pin"
}

# verify_designated_requirement(bundle, teamId)
verify_designated_requirement() {
  local bundle="$1" team_id="$2" bundle_id requirement expected
  bundle_id="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)" \
    || verify_error "could not read designated-requirement bundle identifier"
  requirement="$(codesign -d -r- "$bundle" 2>&1)" \
    || verify_error "could not read designated requirement"
  expected="identifier \"$bundle_id\" and anchor apple generic and certificate leaf[subject.OU] = \"$team_id\""
  [[ "$requirement" == *"designated => $expected" ]] \
    || verify_error "designated requirement does not match exact identifier and Team ID authority"
  codesign --verify --strict -R="$expected" "$bundle" \
    || verify_error "designated requirement evaluation failed"
}

verify_runtime_signature() {
  local path="$1" details identifier requirement expected
  codesign --verify --strict "$path" \
    || verify_error "strict code signature verification failed"
  details="$(codesign -dvv "$path" 2>&1)" \
    || verify_error "could not inspect code signature"
  grep -Eq '(^|,)flags=.*runtime' <<<"$details" \
    || verify_error "Hardened Runtime flag is missing"
  grep -Fq 'Authority=Developer ID Application:' <<<"$details" \
    || verify_error "signature is not from a Developer ID Application certificate"
  grep -Eq '^Timestamp=.+' <<<"$details" \
    || verify_error "secure signing timestamp is missing"
  grep -Fq "TeamIdentifier=$INDEX_PRODUCTION_TEAM_ID" <<<"$details" \
    || verify_error "signed Team ID does not match the release authority"
  identifier="$(awk -F= '$1 == "Identifier" { print $2; exit }' <<<"$details")"
  [[ -n "$identifier" ]] || verify_error "signed Mach-O has no identifier"
  requirement="$(codesign -d -r- "$path" 2>&1)" \
    || verify_error "could not read Mach-O designated requirement"
  expected="identifier \"$identifier\" and anchor apple generic and certificate leaf[subject.OU] = \"$INDEX_PRODUCTION_TEAM_ID\""
  [[ "$requirement" == *"designated => $expected" ]] \
    || verify_error "Mach-O designated requirement does not match exact identifier and Team ID authority"
  codesign --verify --strict -R="$expected" "$path" \
    || verify_error "Mach-O designated requirement evaluation failed"
}

for_each_macho() {
  local bundle="$1" callback="$2" path kind found=0
  while IFS= read -r -d '' path; do
    kind="$(file -b "$path")"
    [[ "$kind" == *"Mach-O"* ]] || continue
    found=1
    "$callback" "$path"
  done < <(find "$bundle" -type f -print0)
  [[ "$found" -eq 1 ]] || verify_error "bundle contains no Mach-O files"
}

validate_embedded_release_profile() (
  local bundle="$1" role="$2" bundle_id="$3" host="$4" group="$5"
  local profile="$bundle/Contents/embedded.provisionprofile" decoded=''
  trap '[[ -z "$decoded" ]] || rm -f "$decoded"' EXIT
  [[ -f "$profile" ]] || verify_error "embedded.provisionprofile is missing"
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-release-profile.XXXXXX")"
  security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1 \
    || verify_error "embedded profile could not be decoded"
  validate_release_profile_plist \
    "$decoded" "$INDEX_PRODUCTION_TEAM_ID" "$bundle_id" "$role" "$host" "$group"
)

validate_bundle_entitlements() (
  local bundle="$1" role="$2" host="$3" group="$4" entitlements=''
  trap '[[ -z "$entitlements" ]] || rm -f "$entitlements"' EXIT
  entitlements="$(mktemp "${TMPDIR:-/tmp}/index-release-entitlements.XXXXXX")"
  codesign -d --entitlements :- "$bundle" >"$entitlements" 2>/dev/null \
    || verify_error "could not read signed entitlements"
  validate_release_entitlements "$entitlements" "$role" "$host" "$group"
)

verify_release_bundle() {
  local bundle="$1" bundle_id="$2" role="$3" host="$4" group="$5"
  [[ -d "$bundle/Contents" ]] || verify_error "signed bundle is missing"
  require_bundle_identity "$bundle" "$bundle_id"
  validate_embedded_release_profile "$bundle" "$role" "$bundle_id" "$host" "$group"
  for_each_macho "$bundle" verify_runtime_signature
  verify_runtime_signature "$bundle"
  verify_designated_requirement "$bundle" "$INDEX_PRODUCTION_TEAM_ID"
  validate_bundle_entitlements "$bundle" "$role" "$host" "$group"
  # Additional whole-tree verification only; --deep is never a signing strategy.
  codesign --verify --deep --strict "$bundle" \
    || verify_error "additional deep verification failed"
}

main() {
  [[ "$(uname -s)" == "Darwin" ]] || verify_error "macOS is required"
  [[ "$#" -le 1 ]] || verify_error "usage: verify-signatures.sh [signed-directory]"
  require_verify_tool codesign
  require_verify_tool security
  require_verify_tool file
  require_verify_tool find
  require_verify_tool python3

  local signed_directory="${1:-$DEFAULT_SIGNED_DIRECTORY}"
  local app_group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_APP_BUNDLE_ID}.owner-credentials"
  local connector_group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_CONNECTOR_BUNDLE_ID}.credentials"
  [[ "$app_group" != "$connector_group" ]] || verify_error "release Keychain groups must be distinct"

  verify_release_bundle \
    "$signed_directory/Index.app" "$INDEX_APP_BUNDLE_ID" app index.network "$app_group"
  verify_release_bundle \
    "$signed_directory/IndexConnector.app" "$INDEX_CONNECTOR_BUNDLE_ID" connector "" "$connector_group"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
