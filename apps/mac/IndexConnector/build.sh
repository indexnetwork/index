#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

readonly CONNECTOR_BUNDLE_ID="network.index.connector"
readonly APP_BUNDLE_ID="network.index.system6"
readonly CONNECTOR_EXECUTABLE_CONTRACT="IndexConnector.app/Contents/MacOS/IndexConnector"
readonly CONNECTOR_GROUP_SUFFIX="network.index.connector.credentials"
readonly APP_GROUP_SUFFIX="network.index.system6.owner-credentials"

runner_temp() {
  printf '%s\n' "${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
}

compile_connector_protocol_fixture() {
  local output="$(runner_temp)/index-connector-protocol-fixture"
  swiftc -parse-as-library \
    Sources/ConnectorProtocol.swift \
    Tests/ConnectorProtocolFixture.swift \
    -o "$output"
  "$output"
}

compile_keychain_fixture() {
  local output="$(runner_temp)/index-keychain-fixture"
  swiftc -parse-as-library -framework Foundation -framework Security \
    ../Security/Sources/IndexKeychainStore.swift \
    ../Security/Tests/IndexKeychainIntegrationFixture.swift \
    -o "$output"
  "$output"
}

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required for the signed access fixture" >&2
    exit 64
  fi
}

write_fixture_info_plist() {
  local destination="$1" bundle_name="$2" bundle_id="$3" executable="$4"
  cat >"$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${bundle_name}</string>
  <key>CFBundleIdentifier</key><string>${bundle_id}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${executable}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
EOF
}

write_connector_entitlements() {
  local destination="$1" connector_group="$2"
  cat >"$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>keychain-access-groups</key>
  <array><string>${connector_group}</string></array>
</dict></plist>
EOF
}

write_app_entitlements() {
  local destination="$1" app_group="$2"
  cat >"$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>keychain-access-groups</key>
  <array><string>${app_group}</string></array>
  <key>com.apple.developer.associated-domains</key>
  <array><string>applinks:index.network</string></array>
</dict></plist>
EOF
}

write_fixture_app_entitlements() {
  local destination="$1" app_group="$2"
  cat >"$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>keychain-access-groups</key>
  <array><string>${app_group}</string></array>
</dict></plist>
EOF
}

validate_minimal_fixture_entitlements() {
  local entitlements="$1" expected_group="$2"
  python3 - "$entitlements" "$expected_group" <<'PY'
import plistlib
import sys

path, expected_group = sys.argv[1:]
with open(path, 'rb') as source:
    entitlements = plistlib.load(source)
expected = {'keychain-access-groups': [expected_group]}
if entitlements != expected:
    raise SystemExit('signed fixture entitlements are not the exact single-group contract')
PY
}

signing_team_id() {
  local identity="$1"
  security find-certificate -c "$identity" -p 2>/dev/null \
    | openssl x509 -noout -subject -nameopt RFC2253 2>/dev/null \
    | awk -F'OU=' 'NF > 1 { split($2, parts, ","); print parts[1]; exit }'
}

validate_fixture_profile() {
  local profile="$1" identity="$2" bundle_id="$3" access_group="$4"
  local expected_team="${INDEX_APP_IDENTIFIER_PREFIX%.}"
  local identity_team
  [[ -f "$profile" ]] || { echo "fixture provisioning profile does not exist: $profile" >&2; exit 64; }
  identity_team="$(signing_team_id "$identity")"
  if [[ -z "$identity_team" || "$identity_team" != "$expected_team" ]]; then
    echo "fixture signing identity does not match INDEX_APP_IDENTIFIER_PREFIX" >&2
    exit 64
  fi

  local decoded
  decoded="$(mktemp "${TMPDIR:-/tmp}/index-fixture-profile.XXXXXX.plist")"
  if ! security cms -D -i "$profile" -o "$decoded" >/dev/null 2>&1; then
    rm -f "$decoded"
    echo "fixture provisioning profile could not be decoded" >&2
    exit 64
  fi
  if ! python3 - "$decoded" "$expected_team" "$bundle_id" "$access_group" <<'PY'
import fnmatch
import plistlib
import sys
from datetime import datetime, timezone

profile_path, expected_team, bundle_id, access_group = sys.argv[1:]
with open(profile_path, 'rb') as source:
    profile = plistlib.load(source)

expiration = profile.get('ExpirationDate')
if not isinstance(expiration, datetime) or expiration <= datetime.now(timezone.utc).replace(tzinfo=None):
    raise SystemExit('fixture provisioning profile is expired')
if expected_team not in profile.get('TeamIdentifier', []):
    raise SystemExit('fixture provisioning profile has the wrong team')
if expected_team not in profile.get('ApplicationIdentifierPrefix', []):
    raise SystemExit('fixture provisioning profile has the wrong application identifier prefix')
entitlements = profile.get('Entitlements')
if not isinstance(entitlements, dict):
    raise SystemExit('fixture provisioning profile has no entitlements')
application_id = entitlements.get('com.apple.application-identifier') or entitlements.get('application-identifier')
expected_application_id = f'{expected_team}.{bundle_id}'
if not isinstance(application_id, str) or not fnmatch.fnmatchcase(expected_application_id, application_id):
    raise SystemExit('fixture provisioning profile does not authorize the bundle identifier')
groups = entitlements.get('keychain-access-groups')
if not isinstance(groups, list) or not any(
    isinstance(pattern, str) and fnmatch.fnmatchcase(access_group, pattern)
    for pattern in groups
):
    raise SystemExit('fixture provisioning profile does not authorize the Keychain access group')
PY
  then
    rm -f "$decoded"
    exit 64
  fi
  rm -f "$decoded"
}

run_signed_access_fixture() {
  if [[ "${INDEX_KEYCHAIN_SIGNING_FIXTURE:-}" != "1" ]]; then
    echo "INDEX_KEYCHAIN_SIGNING_FIXTURE=1 is required for the protected signed fixture" >&2
    exit 64
  fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "the protected signed fixture requires macOS" >&2
    exit 69
  fi

  require_value INDEX_APP_IDENTIFIER_PREFIX
  require_value INDEX_TEST_APP_KEYCHAIN_GROUP
  require_value INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP
  require_value INDEX_TEST_APP_CODESIGN_IDENTITY
  require_value INDEX_TEST_CONNECTOR_CODESIGN_IDENTITY
  require_value INDEX_TEST_APP_PROVISIONING_PROFILE
  require_value INDEX_TEST_CONNECTOR_PROVISIONING_PROFILE

  if [[ ! "$INDEX_APP_IDENTIFIER_PREFIX" =~ ^[A-Za-z0-9]+\.$ ]]; then
    echo "INDEX_APP_IDENTIFIER_PREFIX must be an identifier prefix with a trailing period" >&2
    exit 64
  fi
  local expected_app_group="${INDEX_APP_IDENTIFIER_PREFIX}${APP_GROUP_SUFFIX}"
  local expected_connector_group="${INDEX_APP_IDENTIFIER_PREFIX}${CONNECTOR_GROUP_SUFFIX}"
  if [[ "$INDEX_TEST_APP_KEYCHAIN_GROUP" != "$expected_app_group" ]]; then
    echo "INDEX_TEST_APP_KEYCHAIN_GROUP does not match INDEX_APP_IDENTIFIER_PREFIX" >&2
    exit 64
  fi
  if [[ "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP" != "$expected_connector_group" ]]; then
    echo "INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP does not match INDEX_APP_IDENTIFIER_PREFIX" >&2
    exit 64
  fi
  if [[ "$INDEX_TEST_APP_KEYCHAIN_GROUP" == "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP" ]]; then
    echo "signed fixture access groups must be distinct" >&2
    exit 64
  fi

  local fixture_root="dist/signed-access-fixture"
  local app_bundle="${fixture_root}/Index.app"
  local connector_bundle="${fixture_root}/IndexConnector.app"
  local app_contents="${app_bundle}/Contents"
  local connector_contents="${connector_bundle}/Contents"
  local app_entitlements="${fixture_root}/app.entitlements"
  local connector_entitlements="${fixture_root}/connector.entitlements"

  rm -rf "$fixture_root"
  mkdir -p "${app_contents}/MacOS" "${connector_contents}/MacOS"
  write_fixture_info_plist \
    "${app_contents}/Info.plist" "Index" "$APP_BUNDLE_ID" "Index"
  cp Info.plist "${connector_contents}/Info.plist"
  write_fixture_app_entitlements "$app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  write_connector_entitlements \
    "$connector_entitlements" "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"
  validate_minimal_fixture_entitlements \
    "$app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  validate_minimal_fixture_entitlements \
    "$connector_entitlements" "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"
  validate_fixture_profile \
    "$INDEX_TEST_APP_PROVISIONING_PROFILE" \
    "$INDEX_TEST_APP_CODESIGN_IDENTITY" \
    "$APP_BUNDLE_ID" \
    "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  validate_fixture_profile \
    "$INDEX_TEST_CONNECTOR_PROVISIONING_PROFILE" \
    "$INDEX_TEST_CONNECTOR_CODESIGN_IDENTITY" \
    "$CONNECTOR_BUNDLE_ID" \
    "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"
  cp "$INDEX_TEST_APP_PROVISIONING_PROFILE" "${app_contents}/embedded.provisionprofile"
  cp "$INDEX_TEST_CONNECTOR_PROVISIONING_PROFILE" "${connector_contents}/embedded.provisionprofile"

  swiftc -parse-as-library -framework Foundation -framework Security \
    ../Security/Sources/IndexKeychainStore.swift \
    ../Security/Tests/IndexKeychainIntegrationFixture.swift \
    -o "${app_contents}/MacOS/Index"
  cp "${app_contents}/MacOS/Index" "${connector_contents}/MacOS/IndexConnector"

  codesign --force --options runtime --entitlements "$app_entitlements" \
    --sign "$INDEX_TEST_APP_CODESIGN_IDENTITY" "$app_bundle"
  codesign --force --options runtime --entitlements "$connector_entitlements" \
    --sign "$INDEX_TEST_CONNECTOR_CODESIGN_IDENTITY" "$connector_bundle"
  codesign --verify --strict "$app_bundle"
  codesign --verify --strict "$connector_bundle"
  local signed_app_entitlements="${fixture_root}/signed-app.entitlements"
  local signed_connector_entitlements="${fixture_root}/signed-connector.entitlements"
  codesign -d --entitlements :- "$app_bundle" >"$signed_app_entitlements" 2>/dev/null
  codesign -d --entitlements :- "$connector_bundle" >"$signed_connector_entitlements" 2>/dev/null
  validate_minimal_fixture_entitlements \
    "$signed_app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  validate_minimal_fixture_entitlements \
    "$signed_connector_entitlements" "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"

  run_role() {
    local role="$1" action="$2" executable="$3"
    INDEX_KEYCHAIN_SIGNED_ACCESS_RUN=1 \
      INDEX_KEYCHAIN_FIXTURE_ROLE="$role" \
      INDEX_KEYCHAIN_FIXTURE_ACTION="$action" \
      "$executable"
  }
  cleanup() {
    run_role app cleanup "${app_contents}/MacOS/Index" || true
    run_role connector cleanup "${connector_contents}/MacOS/IndexConnector" || true
  }
  trap cleanup EXIT
  run_role app seed "${app_contents}/MacOS/Index"
  run_role connector seed "${connector_contents}/MacOS/IndexConnector"
  run_role app check "${app_contents}/MacOS/Index"
  run_role connector check "${connector_contents}/MacOS/IndexConnector"
  cleanup
  trap - EXIT
  echo "Signed cross-identity Keychain fixture passed"
}

case "${1:-}" in
  --fixture)
    case "${2:-}" in
      ConnectorProtocolFixture) compile_connector_protocol_fixture ;;
      KeychainIntegrationFixture) compile_keychain_fixture ;;
      *) echo "unknown fixture: ${2:-}" >&2; exit 64 ;;
    esac
    ;;
  --signed-access-fixture)
    run_signed_access_fixture
    ;;
  '')
    echo "production IndexConnector.app assembly begins in Task 4; use --fixture in Task 1" >&2
    exit 64
    ;;
  *)
    echo "usage: $0 --fixture ConnectorProtocolFixture|KeychainIntegrationFixture | --signed-access-fixture" >&2
    exit 64
    ;;
esac
