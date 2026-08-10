import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { rm, symlink, writeFile } from 'node:fs/promises';

const temporaryPaths = [];

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const connectorRoot = new URL('.', import.meta.url).pathname;
const buildPath = `${connectorRoot}build.sh`;

async function writeDecodedProfile(applicationIdentifier, accessGroups) {
  const path = `${process.env.TMPDIR ?? '/tmp'}/index-connector-profile-${crypto.randomUUID()}.plist`;
  temporaryPaths.push(path);
  await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date>
  <key>TeamIdentifier</key><array><string>TEAM123</string></array>
  <key>ApplicationIdentifierPrefix</key><array><string>TEAM123</string></array>
  <key>Entitlements</key><dict>
    <key>com.apple.application-identifier</key><string>${applicationIdentifier}</string>
    <key>keychain-access-groups</key><array>${accessGroups.map((group) => `<string>${group}</string>`).join('')}</array>
  </dict>
</dict></plist>`);
  return path;
}

function validateProfilePair(appProfile, connectorProfile, connectorGroup = 'TEAM123.network.index.connector.credentials') {
  return Bun.spawnSync([
    'bash', buildPath, '--validate-profile-pair-fixture',
    appProfile, connectorProfile, 'TEAM123.',
    'TEAM123.network.index.system6.owner-credentials', connectorGroup,
  ]);
}

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { force: true }))));

test('connector protocol is exact, bounded, and credential-free', () => {
  const source = read('./Sources/ConnectorProtocol.swift');
  expect(source).toContain('static let current = 1');
  expect(source).toContain('case hello, status, authorizeStart, authorizePoll, rest, mcp, disconnect');
  expect(source).toContain('rejectUnknownKeys');
  expect(source).toContain('maximumRequestBytes = 262_144');
  expect(source).toContain('ConnectorResponseValidator');
  expect(source).toContain('StrictConnectorEncoder');
  expect(source).not.toMatch(/apiKey.*ConnectorResponse|credential.*ConnectorResponse/);
});

test('native fixtures cover strict decoding and forbidden response fields', () => {
  const fixture = read('./Tests/ConnectorProtocolFixture.swift');
  expect(fixture).toContain('unknownTopLevelKeys');
  expect(fixture).toContain('missingTopLevelKeys');
  expect(fixture).toContain('requestTooLarge');
  for (const field of [
    'apiKey', 'credential', 'authorizationCode', 'pkceVerifier',
    'verifier', 'headers', 'authorization', 'x-api-key',
  ]) {
    expect(fixture).toContain(`"${field}"`);
  }
});

test('keychain fixture covers real CRUD and injected Security failures', () => {
  const source = read('../Security/Sources/IndexKeychainStore.swift');
  const fixture = read('../Security/Tests/IndexKeychainIntegrationFixture.swift');
  for (const operation of ['SecItemAdd', 'SecItemCopyMatching', 'SecItemUpdate', 'SecItemDelete']) {
    expect(source).toContain(operation);
  }
  expect(fixture).toContain('fixture-secret');
  expect(fixture).toContain('errSecDuplicateItem');
  expect(fixture).toContain('errSecInteractionNotAllowed');
  expect(fixture).toContain('verificationFailed');
  expect(fixture).toContain('INDEX_TEST_KEYCHAIN_GROUP');
  expect(fixture).toContain('service: otherService');
  expect(fixture).toContain('account: otherAccount');
  expect(fixture).toContain('accessGroup: otherGroup');
  expect(fixture).toContain('errSecMissingEntitlement');
});

test('bundle and entitlement contracts keep app and connector credentials distinct', () => {
  const info = read('./Info.plist');
  const entitlements = read('./IndexConnector.entitlements');
  const build = read('./build.sh');

  expect(info).toContain('<string>network.index.connector</string>');
  expect(info).toContain('<string>IndexConnector</string>');
  expect(info).toContain('<string>13.0</string>');
  expect(entitlements).toContain('network.index.connector.credentials');
  expect(entitlements).not.toContain('network.index.system6.owner-credentials');
  expect(entitlements.match(/<key>/g)).toHaveLength(1);
  expect(build).toContain('network.index.system6.owner-credentials');
  expect(build).toContain('network.index.connector.credentials');
  const connectorEntitlementWriter = build
    .split('write_connector_entitlements() {')[1]
    .split('write_fixture_app_entitlements() {')[0];
  expect(connectorEntitlementWriter).toContain('${connector_group}');
  expect(connectorEntitlementWriter).not.toContain('${app_group}');
  expect(connectorEntitlementWriter).not.toContain('associated-domains');
  expect(build).not.toContain('write_app_entitlements()');
  expect(build).toContain('../IndexApp/link-host.sh --write-entitlements');
  expect(build).toContain('validate_generated_app_entitlements');
  expect(build).toContain('INDEX_APP_IDENTIFIER_PREFIX');
  expect(build).toContain('INDEX_TEST_APP_KEYCHAIN_GROUP');
  expect(build).toContain('INDEX_TEST_CONNECTOR_KEYCHAIN_GROUP');
  expect(build).toContain('INDEX_TEST_APP_PROVISIONING_PROFILE');
  expect(build).toContain('INDEX_TEST_CONNECTOR_PROVISIONING_PROFILE');
  expect(build).toContain('--fixture');
  expect(build).toContain('ConnectorProtocolFixture');
  expect(build).toContain('KeychainIntegrationFixture');
  expect(build).toContain('--signed-access-fixture');
  expect(build).toContain('INDEX_KEYCHAIN_SIGNING_FIXTURE');
  expect(build).toContain('IndexConnector.app/Contents/MacOS/IndexConnector');
  expect(build).toContain('validate_profile_files_distinct');
  expect(build).toContain('validate_decoded_profile_pair');
  expect(build).toContain('verify_designated_requirements');
  expect(build).toContain('--sign "$INDEX_TEST_APP_CODESIGN_IDENTITY"');
  expect(build).toContain('--sign "$INDEX_TEST_CONNECTOR_CODESIGN_IDENTITY"');
  expect(build).not.toContain('INDEX_TEST_APP_CODESIGN_IDENTITY" == "$INDEX_TEST_CONNECTOR_CODESIGN_IDENTITY');
});

test('profile pair contract rejects canonical reuse and wrong group authorization', async () => {
  const appGroup = 'TEAM123.network.index.system6.owner-credentials';
  const connectorGroup = 'TEAM123.network.index.connector.credentials';
  const appProfile = await writeDecodedProfile('TEAM123.network.index.system6', [appGroup]);
  const connectorProfile = await writeDecodedProfile('TEAM123.network.index.connector', [connectorGroup]);

  const valid = validateProfilePair(appProfile, connectorProfile);
  expect(valid.exitCode).toBe(0);

  const alias = `${appProfile}.alias`;
  temporaryPaths.push(alias);
  await symlink(appProfile, alias);
  const equalProfile = validateProfilePair(appProfile, alias);
  expect(equalProfile.exitCode).not.toBe(0);
  expect(equalProfile.stderr.toString()).toContain('distinct canonical files');

  const wrongGroupProfile = await writeDecodedProfile('TEAM123.network.index.connector', [appGroup]);
  const wrongGroup = validateProfilePair(appProfile, wrongGroupProfile);
  expect(wrongGroup.exitCode).not.toBe(0);
  expect(wrongGroup.stderr.toString()).toContain('does not authorize the expected Keychain access group');
});

test('macOS CI runs native fixtures and keeps signed identity verification gated', () => {
  const workflow = read('../../../.github/workflows/mac-app-build.yml');
  expect(workflow).toContain('IndexConnector/connector-contract.spec.mjs');
  expect(workflow).toContain('./build.sh --fixture ConnectorProtocolFixture');
  expect(workflow).toContain('./build.sh --fixture KeychainIntegrationFixture');
  expect(workflow).toContain('INDEX_KEYCHAIN_SIGNING_FIXTURE');
  expect(workflow).toContain('./build.sh --signed-access-fixture');
});
