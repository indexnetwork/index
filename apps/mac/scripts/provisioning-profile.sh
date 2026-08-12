#!/usr/bin/env bash

profile_error() {
  echo "provisioning profile $1" >&2
  exit 1
}

certificate_team_id() {
  identity="$1"
  security find-certificate -c "$identity" -p 2>/dev/null \
    | openssl x509 -noout -subject -nameopt RFC2253 2>/dev/null \
    | awk -F'OU=' 'NF > 1 { split($2, parts, ","); print parts[1]; exit }'
}

validate_profile_plist() {
  local profile_path="$1"
  local expected_team="$2"
  local bundle_id="$3"
  local host="$4"
  local expected_owner_group="$5"

  validate_release_profile_plist \
    "$profile_path" "$expected_team" "$bundle_id" app "$host" "$expected_owner_group"
}

validate_release_profile_plist() {
  local profile_path="$1"
  local expected_team="$2"
  local bundle_id="$3"
  local role="$4"
  local host="$5"
  local expected_group="$6"

  python3 - \
    "$profile_path" "$expected_team" "$bundle_id" "$role" "$host" "$expected_group" <<'PY'
import plistlib
import sys
from datetime import datetime, timezone

profile_path, expected_team, bundle_id, role, host, expected_group = sys.argv[1:]


def fail(message):
    print(f'provisioning profile {message}', file=sys.stderr)
    raise SystemExit(1)


with open(profile_path, 'rb') as source:
    profile = plistlib.load(source)

expiration = profile.get('ExpirationDate')
if not isinstance(expiration, datetime) or expiration <= datetime.now(timezone.utc).replace(tzinfo=None):
    fail('is expired')

teams = profile.get('TeamIdentifier')
if teams != [expected_team]:
    if isinstance(teams, list) and expected_team in teams:
        fail('team identifiers do not exactly match the signing certificate')
    fail('team does not match the signing certificate')

prefixes = profile.get('ApplicationIdentifierPrefix')
if prefixes != [expected_team]:
    fail('application identifier prefix does not match the signing Team')

entitlements = profile.get('Entitlements')
if not isinstance(entitlements, dict):
    fail('has no entitlements dictionary')

expected_application_id = f'{expected_team}.{bundle_id}'
if role == 'app':
    canonical_group = f'{expected_team}.{bundle_id}.owner-credentials'
    if expected_group != canonical_group:
        fail('owner Keychain group does not match the signing Team and bundle')
    expected_entitlements = {
        'com.apple.application-identifier': expected_application_id,
        'com.apple.developer.team-identifier': expected_team,
        'com.apple.developer.associated-domains': [f'applinks:{host}'],
        'keychain-access-groups': [expected_group],
    }
    group_error = 'does not authorize exactly the owner Keychain group'
elif role == 'connector':
    if host:
        fail('connector validation does not accept an Associated Domains host')
    canonical_group = f'{expected_team}.{bundle_id}.credentials'
    if expected_group != canonical_group:
        fail('connector Keychain group does not match the signing Team and bundle')
    expected_entitlements = {
        'com.apple.application-identifier': expected_application_id,
        'com.apple.developer.team-identifier': expected_team,
        'keychain-access-groups': [expected_group],
    }
    group_error = 'does not authorize exactly the connector Keychain group'
else:
    fail('has an unknown release bundle role')

if entitlements.get('com.apple.developer.team-identifier') != expected_team:
    fail('team entitlement does not match the signing certificate')
if entitlements.get('com.apple.application-identifier') != expected_application_id:
    fail('application identifier does not match the bundle')
if entitlements.get('keychain-access-groups') != [expected_group]:
    fail(group_error)
if role == 'app' and entitlements.get('com.apple.developer.associated-domains') != [f'applinks:{host}']:
    fail('does not authorize exactly the selected host')
if entitlements != expected_entitlements:
    fail(f'contains entitlements outside the exact {role} profile contract')
PY
}

embed_provisioning_profile() (
  profile="$1"; contents="$2"; identity="$3"; bundle_id="$4"; host="$5"; expected_owner_group="$6"
  [ -f "$profile" ] || profile_error 'file does not exist'
  team_id="$(certificate_team_id "$identity")" || team_id=''
  [ -n "$team_id" ] || profile_error 'could not derive the signing team'
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-profile.plist.XXXXXX")"
  trap 'rm -f "$decoded"' EXIT
  security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1 \
    || profile_error 'could not be decoded'
  validate_profile_plist \
    "$decoded" "$team_id" "$bundle_id" "$host" "$expected_owner_group"
  cp "$profile" "$contents/embedded.provisionprofile"
)

validate_signed_entitlements() {
  local entitlements_path="$1" host="$2" expected_owner_group="$3"
  validate_release_entitlements \
    "$entitlements_path" app "$host" "$expected_owner_group"
}

validate_release_entitlements() {
  local entitlements_path="$1" role="$2" host="$3" expected_group="$4"
  python3 - "$entitlements_path" "$role" "$host" "$expected_group" <<'PY'
import plistlib
import sys

entitlements_path, role, host, expected_group = sys.argv[1:]


def fail(message):
    print(f'provisioning profile {message}', file=sys.stderr)
    raise SystemExit(1)


try:
    with open(entitlements_path, 'rb') as source:
        entitlements = plistlib.load(source)
except Exception:
    fail('could not read signed entitlements')

if role == 'app':
    expected = {
        'com.apple.developer.associated-domains': [f'applinks:{host}'],
        'keychain-access-groups': [expected_group],
    }
    if entitlements.get('com.apple.developer.associated-domains') != expected['com.apple.developer.associated-domains']:
        fail('does not match the signed Associated Domains entitlement')
    if entitlements.get('keychain-access-groups') != expected['keychain-access-groups']:
        fail('does not match the signed owner Keychain entitlement')
    contract = 'app'
elif role == 'connector':
    if host:
        fail('connector signed entitlement validation does not accept a host')
    expected = {'keychain-access-groups': [expected_group]}
    if entitlements.get('keychain-access-groups') != expected['keychain-access-groups']:
        fail('does not match the signed connector Keychain entitlement')
    contract = 'connector'
else:
    fail('has an unknown signed entitlement role')
if entitlements != expected:
    fail(f'contains entitlements outside the signed {contract} contract')
PY
}

validate_embedded_profile() (
  app="$1"; host="$2"
  profile="$app/Contents/embedded.provisionprofile"
  [ -f "$profile" ] || profile_error 'embedded provisioning profile is missing'

  plist_buddy="${PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
  bundle_id="$("$plist_buddy" -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" \
    || profile_error 'could not read the signed bundle identifier'
  signing_details="$(codesign -dvv "$app" 2>&1)" \
    || profile_error 'could not inspect the signed app'
  team_id="$(printf '%s\n' "$signing_details" | awk -F= '$1 == "TeamIdentifier" { print $2; exit }')"
  [ -n "$team_id" ] && [ "$team_id" != 'not set' ] \
    || profile_error 'could not derive the signing team'
  expected_owner_group="${team_id}.${bundle_id}.owner-credentials"

  decoded=''
  signed_entitlements=''
  trap '[ -z "$decoded" ] || rm -f "$decoded"; [ -z "$signed_entitlements" ] || rm -f "$signed_entitlements"' EXIT
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-profile.plist.XXXXXX")"
  signed_entitlements="$(mktemp "${TMPDIR:-/tmp}/index-entitlements.plist.XXXXXX")"

  security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1 \
    || profile_error 'could not be decoded'
  validate_profile_plist \
    "$decoded" "$team_id" "$bundle_id" "$host" "$expected_owner_group"
  codesign -d --entitlements :- "$app" >"$signed_entitlements" 2>/dev/null \
    || profile_error 'could not read signed entitlements'
  validate_signed_entitlements "$signed_entitlements" "$host" "$expected_owner_group"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --validate-plist)
      if [[ "$#" -ne 6 ]]; then
        echo 'usage: provisioning-profile.sh --validate-plist <plist> <team> <bundle-id> <host> <owner-group>' >&2
        exit 2
      fi
      validate_profile_plist "$2" "$3" "$4" "$5" "$6"
      ;;
    --validate-signed-entitlements)
      if [[ "$#" -ne 4 ]]; then
        echo 'usage: provisioning-profile.sh --validate-signed-entitlements <plist> <host> <owner-group>' >&2
        exit 2
      fi
      validate_signed_entitlements "$2" "$3" "$4"
      ;;
    *)
      echo 'usage: provisioning-profile.sh --validate-plist ... | --validate-signed-entitlements ...' >&2
      exit 2
      ;;
  esac
fi
