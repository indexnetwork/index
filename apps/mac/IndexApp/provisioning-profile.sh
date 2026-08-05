#!/usr/bin/env bash

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
if not isinstance(domains, list) or not all(isinstance(value, str) for value in domains):
    fail('does not authorize Associated Domains')
expected_domain = f'applinks:{host}'
if expected_domain not in domains and 'applinks:*' not in domains and '*' not in domains:
    fail('does not authorize the selected host')
PY
}

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
