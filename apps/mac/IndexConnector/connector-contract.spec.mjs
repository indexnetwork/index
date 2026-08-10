import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

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
    .split('write_app_entitlements() {')[0];
  const appEntitlementWriter = build
    .split('write_app_entitlements() {')[1]
    .split('write_fixture_app_entitlements() {')[0];
  expect(connectorEntitlementWriter).toContain('${connector_group}');
  expect(connectorEntitlementWriter).not.toContain('${app_group}');
  expect(connectorEntitlementWriter).not.toContain('associated-domains');
  expect(appEntitlementWriter).toContain('${app_group}');
  expect(appEntitlementWriter).not.toContain('${connector_group}');
  expect(appEntitlementWriter).toContain('com.apple.developer.associated-domains');
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
});

test('macOS CI runs native fixtures and keeps signed identity verification gated', () => {
  const workflow = read('../../../.github/workflows/mac-app-build.yml');
  expect(workflow).toContain('IndexConnector/connector-contract.spec.mjs');
  expect(workflow).toContain('./build.sh --fixture ConnectorProtocolFixture');
  expect(workflow).toContain('./build.sh --fixture KeychainIntegrationFixture');
  expect(workflow).toContain('INDEX_KEYCHAIN_SIGNING_FIXTURE');
  expect(workflow).toContain('./build.sh --signed-access-fixture');
});
