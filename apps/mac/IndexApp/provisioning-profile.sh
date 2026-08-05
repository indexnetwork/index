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

  python3 - "$profile_path" "$expected_team" "$bundle_id" "$host" <<'PY'
import plistlib
import sys
from datetime import datetime

profile_path, expected_team, bundle_id, host = sys.argv[1:]


def fail(message):
    print(f'provisioning profile {message}', file=sys.stderr)
    raise SystemExit(1)


with open(profile_path, 'rb') as source:
    profile = plistlib.load(source)

expiration = profile.get('ExpirationDate')
if not isinstance(expiration, datetime) or expiration <= datetime.utcnow():
    fail('is expired')

teams = profile.get('TeamIdentifier')
if not isinstance(teams, list) or expected_team not in teams:
    fail('team does not match the signing certificate')

entitlements = profile.get('Entitlements')
if not isinstance(entitlements, dict):
    fail('has no entitlements dictionary')

profile_team = entitlements.get('com.apple.developer.team-identifier')
if profile_team is not None and profile_team != expected_team:
    fail('team entitlement does not match the signing certificate')

application_id = (
    entitlements.get('com.apple.application-identifier')
    or entitlements.get('application-identifier')
)
if application_id != f'{expected_team}.{bundle_id}':
    fail('application identifier does not match the bundle')

domains = entitlements.get('com.apple.developer.associated-domains')
if isinstance(domains, str):
    domains = [domains]
elif not isinstance(domains, list) or not all(isinstance(value, str) for value in domains):
    fail('does not authorize Associated Domains')
expected_domain = f'applinks:{host}'
if expected_domain not in domains and 'applinks:*' not in domains and '*' not in domains:
    fail('does not authorize the selected host')
PY
}

embed_provisioning_profile() (
  profile="$1"; contents="$2"; identity="$3"; bundle_id="$4"; host="$5"
  [ -f "$profile" ] || profile_error 'file does not exist'
  team_id="$(certificate_team_id "$identity")" || team_id=''
  [ -n "$team_id" ] || profile_error 'could not derive the signing team'
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-profile.plist.XXXXXX")"
  trap 'rm -f "$decoded"' EXIT
  security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1 \
    || profile_error 'could not be decoded'
  validate_profile_plist "$decoded" "$team_id" "$bundle_id" "$host"
  cp "$profile" "$contents/embedded.provisionprofile"
)

validate_embedded_profile() (
  app="$1"; host="$2"
  profile="$app/Contents/embedded.provisionprofile"
  [ -f "$profile" ] || profile_error 'embedded provisioning profile is missing'

  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" \
    || profile_error 'could not read the signed bundle identifier'
  signing_details="$(codesign -dvv "$app" 2>&1)" \
    || profile_error 'could not inspect the signed app'
  team_id="$(printf '%s\n' "$signing_details" | awk -F= '$1 == "TeamIdentifier" { print $2; exit }')"
  [ -n "$team_id" ] && [ "$team_id" != 'not set' ] \
    || profile_error 'could not derive the signing team'

  decoded=''
  signed_entitlements=''
  trap '[ -z "$decoded" ] || rm -f "$decoded"; [ -z "$signed_entitlements" ] || rm -f "$signed_entitlements"' EXIT
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-profile.plist.XXXXXX")"
  signed_entitlements="$(mktemp "${TMPDIR:-/tmp}/index-entitlements.plist.XXXXXX")"

  security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1 \
    || profile_error 'could not be decoded'
  validate_profile_plist "$decoded" "$team_id" "$bundle_id" "$host"
  codesign -d --entitlements :- "$app" >"$signed_entitlements" 2>/dev/null \
    || profile_error 'could not read signed entitlements'

  python3 - "$signed_entitlements" "$host" <<'PY'
import plistlib
import sys

entitlements_path, host = sys.argv[1:]


def fail(message):
    print(f'provisioning profile {message}', file=sys.stderr)
    raise SystemExit(1)


try:
    with open(entitlements_path, 'rb') as source:
        entitlements = plistlib.load(source)
except Exception:
    fail('could not read signed entitlements')

if entitlements.get('com.apple.developer.associated-domains') != [f'applinks:{host}']:
    fail('does not match the signed Associated Domains entitlement')
PY
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --validate-plist)
      if [[ "$#" -ne 5 ]]; then
        echo 'usage: provisioning-profile.sh --validate-plist <plist> <team> <bundle-id> <host>' >&2
        exit 2
      fi
      validate_profile_plist "$2" "$3" "$4" "$5"
      ;;
    *)
      echo 'usage: provisioning-profile.sh --validate-plist <plist> <team> <bundle-id> <host>' >&2
      exit 2
      ;;
  esac
fi
