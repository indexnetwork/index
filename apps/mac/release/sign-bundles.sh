#!/usr/bin/env bash
# Sign Task 2's Universal 2 bundles with Developer ID Application credentials.
# Invoke only in a protected macOS context. The script never prints identities,
# certificate contents, provisioning profiles, or other credential material.
set -euo pipefail
set +x

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MAC_DIRECTORY="$(cd "$RELEASE_DIRECTORY/.." && pwd)"
readonly UNSIGNED_DIRECTORY="$MAC_DIRECTORY/dist/unsigned"
readonly SIGNED_DIRECTORY="$MAC_DIRECTORY/dist/signed"
readonly SIGNED_APP_BUNDLE="$SIGNED_DIRECTORY/Index.app"
readonly SIGNED_CONNECTOR_BUNDLE="$SIGNED_DIRECTORY/IndexConnector.app"

# shellcheck source=release-config.sh
source "$RELEASE_DIRECTORY/release-config.sh"
# shellcheck source=../IndexApp/provisioning-profile.sh
source "$MAC_DIRECTORY/IndexApp/provisioning-profile.sh"

sign_error() {
  printf 'production signing refused: %s\n' "$1" >&2
  return 1
}

require_sign_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || sign_error "$name is required in the protected signing context"
}

require_sign_tool() {
  command -v "$1" >/dev/null 2>&1 || sign_error "$1 is required"
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

require_sign_bundle_identity() {
  local bundle="$1" expected_bundle_id="$2" actual team_config
  actual="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)" \
    || sign_error "could not read a bundle identifier"
  [[ "$actual" == "$expected_bundle_id" ]] \
    || sign_error "bundle identifier does not match the release contract"
  team_config="$(plist_value "$bundle/Contents/Info.plist" IndexExpectedTeamID)" \
    || sign_error "could not read embedded Team ID authority"
  [[ "$team_config" == "$INDEX_PRODUCTION_TEAM_ID" ]] \
    || sign_error "embedded Team ID authority does not match the independent release pin"
}

validate_identity_authority() {
  local identity="$1" certificate_team embedded_team
  [[ "$identity" == Developer\ ID\ Application:* ]] \
    || sign_error "CODESIGN_IDENTITY must name a Developer ID Application identity"
  security find-identity -v -p codesigning 2>/dev/null | grep -qF "$identity" \
    || sign_error "the requested Developer ID Application identity is unavailable"
  certificate_team="$(certificate_team_id "$identity")" \
    || sign_error "could not derive Team ID from the signing certificate"
  [[ -n "$certificate_team" && "$certificate_team" == "$INDEX_PRODUCTION_TEAM_ID" ]] \
    || sign_error "certificate Team ID does not match the independent release pin"

  local bundle
  for bundle in "$SIGNED_APP_BUNDLE" "$SIGNED_CONNECTOR_BUNDLE"; do
    embedded_team="$(plist_value "$bundle/Contents/Info.plist" IndexExpectedTeamID)" \
      || sign_error "could not read embedded Team ID authority"
    [[ "$embedded_team" == "$INDEX_PRODUCTION_TEAM_ID" ]] \
      || sign_error "embedded Team ID authority does not match the independent release pin"
  done
}

decode_and_validate_profile() (
  local profile="$1" bundle_id="$2" role="$3" host="$4" group="$5" destination="$6"
  local decoded=''
  trap '[[ -z "$decoded" ]] || rm -f "$decoded"' EXIT
  [[ -f "$profile" ]] || sign_error "required provisioning profile does not exist"
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-signing-profile.XXXXXX")"
  security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1 \
    || sign_error "required provisioning profile could not be decoded"
  validate_release_profile_plist \
    "$decoded" "$INDEX_PRODUCTION_TEAM_ID" "$bundle_id" "$role" "$host" "$group"
  cp "$profile" "$destination/Contents/embedded.provisionprofile"
)

write_release_entitlements() {
  local template="$1" destination="$2" expected_group="$3" role="$4" host="$5"
  python3 - "$template" "$destination" "$INDEX_PRODUCTION_TEAM_ID." <<'PY'
import plistlib
import sys

source, destination, prefix = sys.argv[1:]
with open(source, 'rb') as stream:
    raw = stream.read().replace(b'$(AppIdentifierPrefix)', prefix.encode())
value = plistlib.loads(raw)
with open(destination, 'wb') as stream:
    plistlib.dump(value, stream)
PY
  validate_release_entitlements "$destination" "$role" "$host" "$expected_group"
}

sign_code_path() {
  local path="$1" identity="$2" identifier requirement
  if [[ -f "$path/Contents/Info.plist" ]]; then
    identifier="$(plist_value "$path/Contents/Info.plist" CFBundleIdentifier)"
  elif [[ -f "$path/Resources/Info.plist" ]]; then
    identifier="$(plist_value "$path/Resources/Info.plist" CFBundleIdentifier)"
  else
    identifier="$(basename "$path")"
  fi
  [[ -n "$identifier" ]] || sign_error "nested code has no signing identifier"
  requirement="=designated => identifier \"$identifier\" and anchor apple generic and certificate leaf[subject.OU] = \"$INDEX_PRODUCTION_TEAM_ID\""
  codesign --force --options runtime --timestamp --identifier "$identifier" \
    --requirements "$requirement" --sign "$identity" "$path"
}

sign_deepest_first() {
  local path
  if [[ "$#" -eq 0 ]]; then
    return 0
  fi
  while IFS= read -r path; do
    sign_code_path "$path" "$SIGN_INSIDE_OUT_IDENTITY"
  done < <(printf '%s\n' "$@" | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)
}

# sign_inside_out(bundle, identity)
sign_inside_out() {
  local bundle="$1" identity="$2" path kind
  local -a macho_paths=() nested_bundles=()
  while IFS= read -r -d '' path; do
    kind="$(file -b "$path")"
    [[ "$kind" == *"Mach-O"* ]] && macho_paths+=("$path")
  done < <(find "$bundle" -type f -print0)
  while IFS= read -r -d '' path; do
    [[ "$path" == "$bundle" ]] || nested_bundles+=("$path")
  done < <(find "$bundle" -type d \( -name '*.framework' -o -name '*.app' -o -name '*.xpc' -o -name '*.appex' \) -print0)

  # Deepest executable/framework/helper code precedes its containing bundle.
  SIGN_INSIDE_OUT_IDENTITY="$identity"
  sign_deepest_first "${macho_paths[@]}"
  sign_deepest_first "${nested_bundles[@]}"
  unset SIGN_INSIDE_OUT_IDENTITY
}

sign_bundle() {
  local bundle="$1" identity="$2" entitlements="$3" bundle_id requirement
  bundle_id="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)"
  requirement="=designated => identifier \"$bundle_id\" and anchor apple generic and certificate leaf[subject.OU] = \"$INDEX_PRODUCTION_TEAM_ID\""
  codesign --force --options runtime --timestamp --identifier "$bundle_id" \
    --requirements "$requirement" --entitlements "$entitlements" \
    --sign "$identity" "$bundle"
}

cleanup_signing() {
  local status=$?
  rm -rf "${SIGNING_WORK_DIRECTORY:-}"
  if [[ "$status" -ne 0 ]]; then
    rm -rf "$SIGNED_DIRECTORY"
  fi
  exit "$status"
}

main() {
  trap cleanup_signing EXIT
  rm -rf "$SIGNED_DIRECTORY"

  [[ "$(uname -s)" == "Darwin" ]] || sign_error "macOS is required"
  [[ "$#" -eq 0 ]] || sign_error "signing accepts protected environment inputs only"
  require_sign_tool codesign
  require_sign_tool security
  require_sign_tool file
  require_sign_tool find
  require_sign_tool python3
  require_sign_value CODESIGN_IDENTITY
  require_sign_value INDEX_APP_PROVISIONING_PROFILE
  require_sign_value INDEX_CONNECTOR_PROVISIONING_PROFILE
  [[ -d "$UNSIGNED_DIRECTORY/Index.app" && -d "$UNSIGNED_DIRECTORY/IndexConnector.app" ]] \
    || sign_error "apps/mac/dist/unsigned must contain both Task 2 bundles"

  cp -R "$UNSIGNED_DIRECTORY" "$SIGNED_DIRECTORY"
  require_sign_bundle_identity "$SIGNED_APP_BUNDLE" "$INDEX_APP_BUNDLE_ID"
  require_sign_bundle_identity "$SIGNED_CONNECTOR_BUNDLE" "$INDEX_CONNECTOR_BUNDLE_ID"
  validate_identity_authority "$CODESIGN_IDENTITY"

  local app_group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_APP_BUNDLE_ID}.owner-credentials"
  local connector_group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_CONNECTOR_BUNDLE_ID}.credentials"
  [[ "$app_group" != "$connector_group" ]] || sign_error "release Keychain groups must be distinct"

  decode_and_validate_profile \
    "$INDEX_APP_PROVISIONING_PROFILE" "$INDEX_APP_BUNDLE_ID" app index.network "$app_group" \
    "$SIGNED_APP_BUNDLE"
  decode_and_validate_profile \
    "$INDEX_CONNECTOR_PROVISIONING_PROFILE" "$INDEX_CONNECTOR_BUNDLE_ID" connector "" "$connector_group" \
    "$SIGNED_CONNECTOR_BUNDLE"

  SIGNING_WORK_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/index-production-signing.XXXXXX")"
  local app_entitlements="$SIGNING_WORK_DIRECTORY/app.entitlements"
  local connector_entitlements="$SIGNING_WORK_DIRECTORY/connector.entitlements"
  write_release_entitlements \
    "$MAC_DIRECTORY/IndexApp/IndexApp.entitlements" "$app_entitlements" \
    "$app_group" app index.network
  write_release_entitlements \
    "$MAC_DIRECTORY/IndexConnector/IndexConnector.entitlements" "$connector_entitlements" \
    "$connector_group" connector ""

  # Explicit inside-out order: connector code then connector bundle, app code
  # then app bundle. There is deliberately no codesign --deep signing command.
  sign_inside_out "$SIGNED_CONNECTOR_BUNDLE" "$CODESIGN_IDENTITY"
  sign_bundle "$SIGNED_CONNECTOR_BUNDLE" "$CODESIGN_IDENTITY" "$connector_entitlements"
  sign_inside_out "$SIGNED_APP_BUNDLE" "$CODESIGN_IDENTITY"
  sign_bundle "$SIGNED_APP_BUNDLE" "$CODESIGN_IDENTITY" "$app_entitlements"

  bash "$RELEASE_DIRECTORY/verify-signatures.sh" "$SIGNED_DIRECTORY"
  rm -rf "$SIGNING_WORK_DIRECTORY"
  trap - EXIT
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
