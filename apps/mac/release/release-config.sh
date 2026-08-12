#!/usr/bin/env bash
# Immutable production identity shared by the Index app and connector bundles.
# Source this file to call its functions. No credential is accepted or emitted.

readonly INDEX_PRODUCTION_TEAM_ID="LMQ3XNXLAD"
readonly INDEX_PRODUCTION_API_URL="https://protocol.index.network"
readonly INDEX_PRODUCTION_WEB_URL="https://index.network"
readonly INDEX_FIRST_PRODUCTION_VERSION="1.0.0"
readonly INDEX_APP_BUNDLE_ID="network.index.system6"
readonly INDEX_CONNECTOR_BUNDLE_ID="network.index.connector"

release_config_error() {
  printf 'release configuration refused: %s\n' "$1" >&2
  return 1
}

validate_release_version() {
  local value="${1:-}"
  [[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
    || release_config_error "release version must be canonical major.minor.patch"
}

validate_production_url() {
  local value="${1:-}"
  python3 - "$value" <<'PY'
import ipaddress
import sys
from urllib.parse import urlsplit

value = sys.argv[1]
try:
    parsed = urlsplit(value)
except ValueError:
    raise SystemExit('release configuration refused: production URL is malformed')

if parsed.scheme != 'https' or not parsed.hostname:
    raise SystemExit('release configuration refused: production URL must use https')
if parsed.username is not None or parsed.password is not None:
    raise SystemExit('release configuration refused: production URL cannot contain credentials')
if parsed.query or parsed.fragment or parsed.path:
    raise SystemExit('release configuration refused: production URL must be an origin with no path, query, or fragment')
if parsed.port is not None:
    raise SystemExit('release configuration refused: production URL cannot contain an explicit port')
if parsed.netloc != parsed.hostname or parsed.hostname.endswith('.'):
    raise SystemExit('release configuration refused: production URL host must be canonical')
host = parsed.hostname
if host == 'localhost' or host.endswith('.localhost'):
    raise SystemExit('release configuration refused: loopback hosts are forbidden')
try:
    address = ipaddress.ip_address(host.strip('[]'))
except ValueError:
    address = None
if address is not None and (address.is_loopback or address.is_private or address.is_link_local or address.is_unspecified):
    raise SystemExit('release configuration refused: non-public addresses are forbidden')
labels = set(host.split('.'))
if labels.intersection({'dev', 'development', 'staging', 'stage', 'test', 'testing', 'preview', 'local'}):
    raise SystemExit('release configuration refused: non-production host label is forbidden')
PY
}

require_release_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || release_config_error "$name is required"
}

validate_release_inputs() {
  local name
  for name in \
    INDEX_RELEASE_VERSION INDEX_BUILD_NUMBER INDEX_RELEASE_COMMIT \
    INDEX_API_URL INDEX_WEB_URL INDEX_EXPECTED_TEAM_ID \
    INDEX_CONNECTOR_PROTOCOL_VERSION; do
    require_release_value "$name" || return 1
  done

  validate_release_version "$INDEX_RELEASE_VERSION" || return 1
  [[ "$INDEX_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] \
    || release_config_error "INDEX_BUILD_NUMBER must be a positive integer" || return 1
  [[ "$INDEX_RELEASE_COMMIT" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] \
    || release_config_error "INDEX_RELEASE_COMMIT must be a full lowercase Git commit" || return 1
  validate_production_url "$INDEX_API_URL" || return 1
  validate_production_url "$INDEX_WEB_URL" || return 1
  [[ "$INDEX_API_URL" == "$INDEX_PRODUCTION_API_URL" ]] \
    || release_config_error "INDEX_API_URL must equal $INDEX_PRODUCTION_API_URL" || return 1
  [[ "$INDEX_WEB_URL" == "$INDEX_PRODUCTION_WEB_URL" ]] \
    || release_config_error "INDEX_WEB_URL must equal $INDEX_PRODUCTION_WEB_URL" || return 1
  [[ "$INDEX_EXPECTED_TEAM_ID" == "$INDEX_PRODUCTION_TEAM_ID" ]] \
    || release_config_error "INDEX_EXPECTED_TEAM_ID must equal the pinned Team ID" || return 1
  [[ "$INDEX_CONNECTOR_PROTOCOL_VERSION" =~ ^[1-9][0-9]*$ ]] \
    || release_config_error "INDEX_CONNECTOR_PROTOCOL_VERSION must be a positive integer" || return 1
}

write_plist_release_config() {
  local source="$1" destination="$2"
  python3 - \
    "$source" "$destination" \
    "$INDEX_RELEASE_VERSION" "$INDEX_BUILD_NUMBER" "$INDEX_RELEASE_COMMIT" \
    "$INDEX_API_URL" "$INDEX_WEB_URL" "$INDEX_EXPECTED_TEAM_ID" \
    "$INDEX_CONNECTOR_PROTOCOL_VERSION" <<'PY'
import plistlib
import sys

(
    source, destination, release_version, build_number, commit, api_url,
    web_url, team_id, connector_protocol_version,
) = sys.argv[1:]
with open(source, 'rb') as stream:
    plist = plistlib.load(stream)
plist.update({
    'CFBundleShortVersionString': release_version,
    'CFBundleVersion': build_number,
    'LSMinimumSystemVersion': '13.0',
    'IndexReleaseChannel': 'production',
    'IndexReleaseVersion': release_version,
    'IndexReleaseCommit': commit,
    'IndexAPIURL': api_url,
    'IndexWebURL': web_url,
    'IndexExpectedTeamID': team_id,
    'IndexConnectorProtocolVersion': connector_protocol_version,
    'IndexDevelopmentBuild': False,
})
with open(destination, 'wb') as stream:
    plistlib.dump(plist, stream, fmt=plistlib.FMT_XML, sort_keys=False)
PY
}

write_release_config() {
  local app_plist="${1:-}" connector_plist="${2:-}"
  [[ "$#" -eq 2 && -f "$app_plist" && -f "$connector_plist" ]] \
    || release_config_error "write_release_config requires app and connector plist paths" || return 1
  validate_release_inputs || return 1

  local directory app_temporary connector_temporary
  directory="$(mktemp -d "${TMPDIR:-/tmp}/index-release-config.XXXXXX")" || return 1
  app_temporary="$directory/app.plist"
  connector_temporary="$directory/connector.plist"

  write_plist_release_config "$app_plist" "$app_temporary" \
    && write_plist_release_config "$connector_plist" "$connector_temporary" \
    && mv "$app_temporary" "$app_plist" \
    && mv "$connector_temporary" "$connector_plist"
  local status=$?
  rm -rf "$directory"
  return "$status"
}
