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

write_development_endpoints() {
  local destination="$1" web="$2" api="$3" mcp="$4"
  python3 - "$destination" "$web" "$api" "$mcp" <<'PY'
import json
import sys

path, web, api, mcp = sys.argv[1:]
with open(path, 'w', encoding='utf-8') as output:
    output.write('enum ConnectorEmbeddedDevelopmentEndpoints {\n')
    output.write(f'    static let web = {json.dumps(web)}\n')
    output.write(f'    static let api = {json.dumps(api)}\n')
    output.write(f'    static let mcp = {json.dumps(mcp)}\n')
    output.write('}\n')
PY
}

compile_runtime_fixture() {
  local fixture="$1"
  local output="$(runner_temp)/index-connector-${fixture}"
  local generated="$(runner_temp)/index-connector-fixture-endpoints.swift"
  write_development_endpoints \
    "$generated" \
    "http://127.0.0.1:49152" \
    "http://127.0.0.1:49152/api" \
    "http://127.0.0.1:49152/mcp"
  local -a sources=(
    Sources/ConnectorProtocol.swift
    Sources/ConnectorIdentity.swift
    Sources/ConnectorCredentialStore.swift
    Sources/ConnectorInstallationStore.swift
    Sources/ConnectorHTTPClient.swift
    Sources/BrowserAuthorization.swift
    Sources/ConnectorRuntime.swift
    ../Security/Sources/IndexKeychainStore.swift
  )
  swiftc -parse-as-library -DINDEX_CONNECTOR_NONPRODUCTION \
    -framework Foundation -framework Security -framework AppKit -framework CryptoKit \
    "${sources[@]}" "$generated" "Tests/${fixture}.swift" \
    -o "$output"
  "$output"
}

validate_development_endpoint() {
  local value="$1" expected_suffix="$2"
  python3 - "$value" "$expected_suffix" <<'PY'
import sys
from urllib.parse import urlsplit

value, suffix = sys.argv[1:]
parsed = urlsplit(value)
if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
    raise SystemExit('development endpoint is not an absolute trusted build input')
if parsed.scheme == 'http' and parsed.hostname != '127.0.0.1':
    raise SystemExit('plaintext development endpoints must use exact 127.0.0.1')
if suffix and not parsed.path.endswith(suffix):
    raise SystemExit(f'development endpoint must end in {suffix}')
PY
}

build_connector() {
  local mode="$1"
  local app="dist/IndexConnector.app"
  local contents="${app}/Contents"
  local executable="${contents}/MacOS/IndexConnector"
  local generated="$(runner_temp)/index-connector-development-endpoints.swift"
  local -a flags=()
  local -a generated_sources=()
  if [[ "$mode" == "development" ]]; then
    if [[ "${INDEX_CONNECTOR_NONPRODUCTION_BUILD:-}" != "1" ]]; then
      echo "INDEX_CONNECTOR_NONPRODUCTION_BUILD=1 is required" >&2
      exit 64
    fi
    require_value INDEX_CONNECTOR_DEV_WEB_URL
    require_value INDEX_CONNECTOR_DEV_API_URL
    require_value INDEX_CONNECTOR_DEV_MCP_URL
    validate_development_endpoint "$INDEX_CONNECTOR_DEV_WEB_URL" ""
    validate_development_endpoint "$INDEX_CONNECTOR_DEV_API_URL" "/api"
    validate_development_endpoint "$INDEX_CONNECTOR_DEV_MCP_URL" "/mcp"
    write_development_endpoints "$generated" \
      "$INDEX_CONNECTOR_DEV_WEB_URL" "$INDEX_CONNECTOR_DEV_API_URL" "$INDEX_CONNECTOR_DEV_MCP_URL"
    flags+=("-DINDEX_CONNECTOR_NONPRODUCTION")
    generated_sources+=("$generated")
  fi
  local -a sources=(
    Sources/ConnectorProtocol.swift
    Sources/ConnectorIdentity.swift
    Sources/ConnectorCredentialStore.swift
    Sources/ConnectorInstallationStore.swift
    Sources/ConnectorHTTPClient.swift
    Sources/BrowserAuthorization.swift
    Sources/ConnectorRuntime.swift
    ../Security/Sources/IndexKeychainStore.swift
  )
  rm -rf "$app"
  mkdir -p "${contents}/MacOS"
  cp Info.plist "${contents}/Info.plist"
  MACOSX_DEPLOYMENT_TARGET=13.0 swiftc -parse-as-library -O \
    -framework Foundation -framework Security -framework AppKit -framework CryptoKit \
    ${flags[@]+"${flags[@]}"} "${sources[@]}" \
    ${generated_sources[@]+"${generated_sources[@]}"} Sources/main.swift \
    -o "$executable"
  chmod 0755 "$executable"
  echo "Built ${app} (${mode})"
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

validate_generated_app_entitlements() {
  local entitlements="$1" expected_group="$2" expected_host="$3"
  python3 - "$entitlements" "$expected_group" "$expected_host" <<'PY'
import plistlib
import sys

path, expected_group, expected_host = sys.argv[1:]
with open(path, 'rb') as source:
    entitlements = plistlib.load(source)
expected = {
    'keychain-access-groups': [expected_group],
    'com.apple.developer.associated-domains': [f'applinks:{expected_host}'],
}
if entitlements != expected:
    raise SystemExit('generated Index app entitlements do not match the owner-group/domain contract')
PY
}

signing_team_id() {
  local identity="$1"
  security find-certificate -c "$identity" -p 2>/dev/null \
    | openssl x509 -noout -subject -nameopt RFC2253 2>/dev/null \
    | awk -F'OU=' 'NF > 1 { split($2, parts, ","); print parts[1]; exit }'
}

canonical_profile_file() {
  python3 - "$1" <<'PY'
import os
import sys

path = os.path.realpath(sys.argv[1])
if not os.path.isfile(path):
    raise SystemExit(f'fixture provisioning profile does not exist: {sys.argv[1]}')
print(path)
PY
}

validate_profile_files_distinct() {
  local app_profile connector_profile
  app_profile="$(canonical_profile_file "$1")" || exit 64
  connector_profile="$(canonical_profile_file "$2")" || exit 64
  if [[ "$app_profile" == "$connector_profile" || "$app_profile" -ef "$connector_profile" ]]; then
    echo "app and connector provisioning profiles must be distinct canonical files" >&2
    exit 64
  fi
}

validate_decoded_profile_pair() {
  local app_profile="$1" connector_profile="$2" identifier_prefix="$3"
  local app_group="$4" connector_group="$5"
  local expected_team="${identifier_prefix%.}"
  python3 - \
    "$app_profile" "$connector_profile" "$expected_team" \
    "$APP_BUNDLE_ID" "$CONNECTOR_BUNDLE_ID" "$app_group" "$connector_group" <<'PY'
import fnmatch
import plistlib
import sys
from datetime import datetime, timezone

(
    app_path, connector_path, expected_team, app_bundle_id,
    connector_bundle_id, app_group, connector_group,
) = sys.argv[1:]


def load(path):
    with open(path, 'rb') as source:
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
    application_id = (
        entitlements.get('com.apple.application-identifier')
        or entitlements.get('application-identifier')
    )
    groups = entitlements.get('keychain-access-groups')
    if not isinstance(application_id, str):
        raise SystemExit('fixture provisioning profile has no application identifier authorization')
    if not isinstance(groups, list) or not all(isinstance(group, str) for group in groups):
        raise SystemExit('fixture provisioning profile has no Keychain access-group authorization')
    return application_id, groups


def authorizes(value, patterns):
    return any(fnmatch.fnmatchcase(value, pattern) for pattern in patterns)


app_application_id, app_groups = load(app_path)
connector_application_id, connector_groups = load(connector_path)
expected_app_id = f'{expected_team}.{app_bundle_id}'
expected_connector_id = f'{expected_team}.{connector_bundle_id}'

if not fnmatch.fnmatchcase(expected_app_id, app_application_id):
    raise SystemExit('app fixture profile does not authorize the expected application identifier')
if fnmatch.fnmatchcase(expected_connector_id, app_application_id):
    raise SystemExit('app fixture profile also authorizes the connector application identifier')
if not fnmatch.fnmatchcase(expected_connector_id, connector_application_id):
    raise SystemExit('connector fixture profile does not authorize the expected application identifier')
if fnmatch.fnmatchcase(expected_app_id, connector_application_id):
    raise SystemExit('connector fixture profile also authorizes the app application identifier')
if not authorizes(app_group, app_groups):
    raise SystemExit('app fixture profile does not authorize the expected Keychain access group')
if authorizes(connector_group, app_groups):
    raise SystemExit('app fixture profile also authorizes the connector Keychain access group')
if not authorizes(connector_group, connector_groups):
    raise SystemExit('connector fixture profile does not authorize the expected Keychain access group')
if authorizes(app_group, connector_groups):
    raise SystemExit('connector fixture profile also authorizes the app Keychain access group')
if app_application_id == connector_application_id:
    raise SystemExit('fixture profiles must carry distinct application identifier authorizations')
if app_groups == connector_groups:
    raise SystemExit('fixture profiles must carry distinct Keychain access-group authorizations')
PY
}

decode_fixture_profile() {
  local profile="$1" identity="$2" destination="$3"
  local expected_team="${INDEX_APP_IDENTIFIER_PREFIX%.}"
  local identity_team
  identity_team="$(signing_team_id "$identity")"
  if [[ -z "$identity_team" || "$identity_team" != "$expected_team" ]]; then
    echo "fixture signing identity does not match INDEX_APP_IDENTIFIER_PREFIX" >&2
    exit 64
  fi
  if ! security cms -D -i "$profile" -o "$destination" >/dev/null 2>&1; then
    echo "fixture provisioning profile could not be decoded" >&2
    exit 64
  fi
}

verify_designated_requirements() {
  local app_bundle="$1" connector_bundle="$2"
  local app_requirement="$3" connector_requirement="$4"
  codesign -d -r- "$app_bundle" > /dev/null 2>"$app_requirement"
  codesign -d -r- "$connector_bundle" > /dev/null 2>"$connector_requirement"
  python3 - \
    "$app_requirement" "$connector_requirement" "$APP_BUNDLE_ID" "$CONNECTOR_BUNDLE_ID" <<'PY'
import re
import sys

app_path, connector_path, app_id, connector_id = sys.argv[1:]
app_requirement = open(app_path, encoding='utf-8').read()
connector_requirement = open(connector_path, encoding='utf-8').read()
if not re.search(rf'identifier\s+"{re.escape(app_id)}"', app_requirement):
    raise SystemExit('signed app designated requirement does not contain its bundle identifier')
if not re.search(rf'identifier\s+"{re.escape(connector_id)}"', connector_requirement):
    raise SystemExit('signed connector designated requirement does not contain its bundle identifier')
if app_requirement == connector_requirement:
    raise SystemExit('signed designated requirements must differ by bundle identifier')
PY
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
  validate_profile_files_distinct \
    "$INDEX_TEST_APP_PROVISIONING_PROFILE" \
    "$INDEX_TEST_CONNECTOR_PROVISIONING_PROFILE"

  local fixture_root="dist/signed-access-fixture"
  local app_bundle="${fixture_root}/Index.app"
  local connector_bundle="${fixture_root}/IndexConnector.app"
  local app_contents="${app_bundle}/Contents"
  local connector_contents="${connector_bundle}/Contents"
  local app_entitlements="${fixture_root}/app.entitlements"
  local connector_entitlements="${fixture_root}/connector.entitlements"
  local generated_app_entitlements="${fixture_root}/generated-index-app.entitlements"
  local decoded_app_profile="${fixture_root}/decoded-app-profile.plist"
  local decoded_connector_profile="${fixture_root}/decoded-connector-profile.plist"

  rm -rf "$fixture_root"
  mkdir -p "${app_contents}/MacOS" "${connector_contents}/MacOS"
  write_fixture_info_plist \
    "${app_contents}/Info.plist" "Index" "$APP_BUNDLE_ID" "Index"
  cp Info.plist "${connector_contents}/Info.plist"
  write_fixture_app_entitlements "$app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  write_connector_entitlements \
    "$connector_entitlements" "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"
  bash ../scripts/link-host.sh --write-entitlements \
    index.network "$generated_app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  validate_minimal_fixture_entitlements \
    "$app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP"
  validate_minimal_fixture_entitlements \
    "$connector_entitlements" "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"
  validate_generated_app_entitlements \
    "$generated_app_entitlements" "$INDEX_TEST_APP_KEYCHAIN_GROUP" index.network
  decode_fixture_profile \
    "$INDEX_TEST_APP_PROVISIONING_PROFILE" \
    "$INDEX_TEST_APP_CODESIGN_IDENTITY" \
    "$decoded_app_profile"
  decode_fixture_profile \
    "$INDEX_TEST_CONNECTOR_PROVISIONING_PROFILE" \
    "$INDEX_TEST_CONNECTOR_CODESIGN_IDENTITY" \
    "$decoded_connector_profile"
  validate_decoded_profile_pair \
    "$decoded_app_profile" "$decoded_connector_profile" \
    "$INDEX_APP_IDENTIFIER_PREFIX" \
    "$INDEX_TEST_APP_KEYCHAIN_GROUP" "$INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP"
  rm -f "$decoded_app_profile" "$decoded_connector_profile"
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
  verify_designated_requirements \
    "$app_bundle" "$connector_bundle" \
    "${fixture_root}/app.designated-requirement" \
    "${fixture_root}/connector.designated-requirement"

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
      AuthorizationFixture) compile_runtime_fixture AuthorizationFixture ;;
      TransportFixture) compile_runtime_fixture TransportFixture ;;
      InstallationStoreMultiprocessFixture) compile_runtime_fixture InstallationStoreMultiprocessFixture ;;
      *) echo "unknown fixture: ${2:-}" >&2; exit 64 ;;
    esac
    ;;
  --validate-profile-pair-fixture)
    if [[ "$#" -ne 6 ]]; then
      echo "usage: $0 --validate-profile-pair-fixture <app-plist> <connector-plist> <identifier-prefix> <app-group> <connector-group>" >&2
      exit 64
    fi
    validate_profile_files_distinct "$2" "$3"
    validate_decoded_profile_pair "$2" "$3" "$4" "$5" "$6"
    ;;
  --signed-access-fixture)
    run_signed_access_fixture
    ;;
  --nonproduction)
    build_connector development
    ;;
  '')
    build_connector production
    ;;
  *)
    echo "usage: $0 [--nonproduction] | --fixture ConnectorProtocolFixture|KeychainIntegrationFixture|AuthorizationFixture|TransportFixture|InstallationStoreMultiprocessFixture | --validate-profile-pair-fixture ... | --signed-access-fixture" >&2
    exit 64
    ;;
esac
