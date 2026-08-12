#!/usr/bin/env bash
# Verify the complete Developer ID/Hardened Runtime signing contract provider-free.
set -euo pipefail

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MAC_DIRECTORY="$(cd "$RELEASE_DIRECTORY/.." && pwd)"
readonly DEFAULT_SIGNED_DIRECTORY="$MAC_DIRECTORY/dist/signed"

source "$RELEASE_DIRECTORY/release-config.sh"
source "$MAC_DIRECTORY/scripts/provisioning-profile.sh"

verify_error() {
  printf 'production signature verification refused: %s\n' "$1" >&2
  return 1
}

require_verify_tool() {
  command -v "$1" >/dev/null 2>&1 || verify_error "$1 is required"
}

plist_value() {
  "${PLIST_BUDDY:-/usr/libexec/PlistBuddy}" -c "Print :$2" "$1"
}

validate_code_identifier() {
  local identifier="$1"
  [[ "$identifier" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ \
    && "$identifier" != *..* && "$identifier" != *.-* && "$identifier" != *-. ]] \
    || verify_error "signed code identifier is invalid"
}

expected_requirement() {
  local identifier="$1" team_id="$2"
  validate_code_identifier "$identifier" || return 1
  [[ "$team_id" =~ ^[A-Z0-9]{10}$ ]] || verify_error "requirement Team ID is invalid"
  printf 'identifier "%s" and anchor apple generic and certificate leaf[subject.OU] = "%s"\n' \
    "$identifier" "$team_id"
}

read_designated_requirement() {
  local path="$1" output normalized
  output="$(codesign -d -r- "$path" 2>&1)" \
    || verify_error "could not read designated requirement"
  normalized="$(python3 - "$output" <<'PY'
import sys
lines = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
requirements = [line.removeprefix('designated =>').strip() for line in lines if line.startswith('designated =>')]
if len(requirements) != 1:
    raise SystemExit(1)
print(requirements[0])
PY
)" || verify_error "designated requirement output is malformed"
  printf '%s\n' "$normalized"
}

require_exact_requirement() {
  local path="$1" identifier="$2" team_id="$3" actual expected
  expected="$(expected_requirement "$identifier" "$team_id")" || return 1
  actual="$(read_designated_requirement "$path")" || return 1
  [[ "$actual" == "$expected" ]] \
    || verify_error "designated requirement does not exactly match identifier and Team ID authority"
  codesign --verify --strict -R="$expected" "$path" \
    || verify_error "designated requirement evaluation failed"
}

verify_runtime_keychain_group() {
  local bundle="$1" expected="$2" actual
  actual="$(plist_value "$bundle/Contents/Info.plist" IndexOwnerKeychainAccessGroup)" \
    || verify_error "could not read runtime owner Keychain group"
  [[ "$actual" == "$expected" ]] \
    || verify_error "runtime owner Keychain group does not match the release contract"
}

require_bundle_identity() {
  local bundle="$1" expected_bundle_id="$2" actual team_config
  actual="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)" \
    || verify_error "could not read a bundle identifier"
  validate_code_identifier "$actual" || return 1
  [[ "$actual" == "$expected_bundle_id" ]] \
    || verify_error "bundle identifier does not match the release contract"
  team_config="$(plist_value "$bundle/Contents/Info.plist" IndexExpectedTeamID)" \
    || verify_error "could not read embedded Team ID authority"
  [[ "$team_config" == "$INDEX_PRODUCTION_TEAM_ID" ]] \
    || verify_error "embedded Team ID authority does not match the independent release pin"
}

# verify_designated_requirement(bundle, teamId)
verify_designated_requirement() {
  local bundle="$1" team_id="$2" bundle_id
  bundle_id="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)" \
    || verify_error "could not read designated-requirement bundle identifier"
  require_exact_requirement "$bundle" "$bundle_id" "$team_id"
}

validate_secure_timestamp() {
  local details="$1" value count
  count="$(grep -c '^Timestamp=' <<<"$details" || true)"
  [[ "$count" == 1 ]] || verify_error "secure signing timestamp is missing or malformed"
  value="$(awk -F= '$1 == "Timestamp" { print substr($0, 11) }' <<<"$details")"
  python3 - "$value" <<'PY' >/dev/null || verify_error "secure signing timestamp is missing or malformed"
import datetime
import re
import sys
value = sys.argv[1]
if not value or value.lower() == 'none' or not re.fullmatch(
    r'[A-Z][a-z]{2} [0-9]{1,2}, [0-9]{4} at [0-9]{1,2}:[0-9]{2}:[0-9]{2}(?: [AP]M)?', value
):
    raise SystemExit(1)
for pattern in ('%b %d, %Y at %H:%M:%S', '%b %d, %Y at %I:%M:%S %p'):
    try:
        datetime.datetime.strptime(value, pattern)
        break
    except ValueError:
        pass
else:
    raise SystemExit(1)
PY
}

verify_runtime_signature() {
  local path="$1" role="${2:-nested}" details identifier
  codesign --verify --strict "$path" \
    || verify_error "strict code signature verification failed"
  details="$(codesign -dvv "$path" 2>&1)" \
    || verify_error "could not inspect code signature"
  python3 - "$details" <<'PY' >/dev/null || verify_error "Hardened Runtime flag is missing"
import re, sys
lines = [line for line in sys.argv[1].splitlines() if line.startswith('CodeDirectory ')]
if len(lines) != 1:
    raise SystemExit(1)
match = re.search(r'\bflags=0x[0-9a-fA-F]+\(([^)]*)\)', lines[0])
if not match or 'runtime' not in {value.strip() for value in match.group(1).split(',')}:
    raise SystemExit(1)
PY
  grep -Fq 'Authority=Developer ID Application:' <<<"$details" \
    || verify_error "signature is not from a Developer ID Application certificate"
  validate_secure_timestamp "$details"
  grep -Fqx "TeamIdentifier=$INDEX_PRODUCTION_TEAM_ID" <<<"$details" \
    || verify_error "signed Team ID does not match the release authority"
  identifier="$(awk -F= '$1 == "Identifier" { print substr($0, 12); exit }' <<<"$details")"
  validate_code_identifier "$identifier" || return 1
  require_exact_requirement "$path" "$identifier" "$INDEX_PRODUCTION_TEAM_ID"
  if [[ "$role" == nested ]]; then
    validate_code_entitlements "$path" nested "" ""
  fi
}

verify_inventory_macho() {
  local path="$1"
  if [[ "$path" == "$VERIFY_ROOT_EXECUTABLE" ]]; then
    verify_runtime_signature "$path" root
    validate_code_entitlements "$path" "$VERIFY_ROOT_ROLE" "$VERIFY_ROOT_HOST" "$VERIFY_ROOT_GROUP"
  else
    verify_runtime_signature "$path" nested
  fi
}

inventory_code_paths() {
  local bundle="$1" destination="$2" candidate kind
  local raw="$destination.raw"
  if ! find "$bundle" -type f -print0 >"$raw"; then
    rm -f "$raw" "$destination"
    verify_error "code inventory failed"
    return 1
  fi
  : >"$destination"
  while IFS= read -r -d '' candidate; do
    [[ -f "$candidate" ]] || { rm -f "$raw" "$destination"; verify_error "code inventory changed during inspection"; return 1; }
    kind="$(file -b -- "$candidate")" \
      || { rm -f "$raw" "$destination"; verify_error "code inventory inspection failed"; return 1; }
    [[ "$kind" == *"Mach-O"* ]] && printf '%s\0' "$candidate" >>"$destination"
  done <"$raw"
  rm -f "$raw"
}

for_each_macho() (
  local bundle="$1" callback="$2" path found=0 inventory
  inventory="$(mktemp "${TMPDIR:-/tmp}/index-code-inventory.XXXXXX")"
  trap 'rm -f "$inventory" "$inventory.raw"' EXIT
  inventory_code_paths "$bundle" "$inventory"
  while IFS= read -r -d '' path; do
    [[ -f "$path" ]] || verify_error "code inventory changed before verification"
    found=1
    "$callback" "$path" nested
  done <"$inventory"
  [[ "$found" -eq 1 ]] || verify_error "bundle contains no Mach-O files"
)

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

validate_code_entitlements() (
  local path="$1" role="$2" host="$3" group="$4" entitlements
  entitlements="$(mktemp "${TMPDIR:-/tmp}/index-release-entitlements.XXXXXX")"
  trap 'rm -f "$entitlements"' EXIT
  codesign -d --entitlements :- "$path" >"$entitlements" 2>/dev/null \
    || verify_error "could not read signed entitlements"
  if [[ "$role" == nested ]]; then
    python3 - "$entitlements" <<'PY' || verify_error "nested code must have no entitlements"
import plistlib
import sys
raw = open(sys.argv[1], 'rb').read()
if not raw.strip():
    raise SystemExit(0)
try:
    value = plistlib.loads(raw)
except Exception:
    raise SystemExit(1)
if value != {}:
    raise SystemExit(1)
PY
  else
    validate_release_entitlements "$entitlements" "$role" "$host" "$group"
  fi
)

verify_release_bundle() {
  local bundle="$1" bundle_id="$2" role="$3" host="$4" group="$5"
  [[ -d "$bundle/Contents" ]] || verify_error "signed bundle is missing"
  require_bundle_identity "$bundle" "$bundle_id"
  if [[ "$role" == app ]]; then
    verify_runtime_keychain_group "$bundle" "$group"
  fi
  validate_embedded_release_profile "$bundle" "$role" "$bundle_id" "$host" "$group"
  local executable_name
  executable_name="$(plist_value "$bundle/Contents/Info.plist" CFBundleExecutable)" \
    || verify_error "could not read root executable name"
  validate_code_identifier "$executable_name" || return 1
  VERIFY_ROOT_EXECUTABLE="$bundle/Contents/MacOS/$executable_name"
  VERIFY_ROOT_ROLE="$role"
  VERIFY_ROOT_HOST="$host"
  VERIFY_ROOT_GROUP="$group"
  for_each_macho "$bundle" verify_inventory_macho
  verify_runtime_signature "$bundle" root
  verify_designated_requirement "$bundle" "$INDEX_PRODUCTION_TEAM_ID"
  validate_code_entitlements "$bundle" "$role" "$host" "$group"
  codesign --verify --deep --strict "$bundle" \
    || verify_error "additional deep verification failed"
}

main() {
  [[ "$(uname -s)" == Darwin ]] || verify_error "macOS is required"
  [[ "$#" -le 1 ]] || verify_error "usage: verify-signatures.sh [signed-directory]"
  for tool in codesign security file find python3; do require_verify_tool "$tool"; done
  local signed_directory="${1:-$DEFAULT_SIGNED_DIRECTORY}"
  local app_group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_APP_BUNDLE_ID}.owner-credentials"
  local connector_group="${INDEX_PRODUCTION_TEAM_ID}.${INDEX_CONNECTOR_BUNDLE_ID}.credentials"
  [[ "$app_group" != "$connector_group" ]] || verify_error "release Keychain groups must be distinct"
  verify_release_bundle "$signed_directory/Index.app" "$INDEX_APP_BUNDLE_ID" app index.network "$app_group"
  verify_release_bundle "$signed_directory/IndexConnector.app" "$INDEX_CONNECTOR_BUNDLE_ID" connector "" "$connector_group"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
