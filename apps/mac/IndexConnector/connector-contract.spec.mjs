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
  expect(source).toContain('case hello, status, authorizeStart = "authorize.start", authorizePoll = "authorize.poll", rest, mcp, disconnect');
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
  expect(build).toContain('../scripts/link-host.sh --write-entitlements');
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
  expect(build).toContain('${flags[@]+"${flags[@]}"}');
  expect(build).toContain('${generated_sources[@]+"${generated_sources[@]}"}');
  expect(build).not.toContain('identity_flags');
  expect(build).toMatch(/if \[\[ -n "\$compiled_identity" \]\]; then[\s\S]*-Xlinker -sectcreate[\s\S]*else[\s\S]*swiftc/);
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

test('production app profile, signed entitlements, and operator docs carry the owner-group contract', () => {
  const profileHelper = read('../scripts/provisioning-profile.sh');
  const appBuild = read('../scripts/build.sh');
  const readme = read('../README.md');

  expect(profileHelper).toContain('keychain-access-groups');
  // Apple issues Developer ID profiles with the team wildcard, so the profile
  // may carry the exact owner group or that wildcard and nothing else. Pin the
  // predicate itself: silently re-tightening it breaks Developer ID signing,
  // and widening it further would admit a foreign team's groups. The runtime
  // behaviour is covered in scripts/provisioning-profile.spec.mjs.
  expect(profileHelper).toContain("groups not in ([expected_owner_group], [f'{expected_team}.*'])");
  expect(profileHelper).toContain('does not authorize the owner Keychain group');
  // The signed entitlement stays exact even when the profile carries the wildcard.
  expect(profileHelper).toContain('does not match the signed owner Keychain entitlement');
  expect(appBuild).toContain('validate_embedded_profile "${APP}" "$LINK_HOST"');
  expect(readme).toContain('all four required inputs');
  expect(readme).toContain("INDEX_APP_IDENTIFIER_PREFIX='TEAM123ABC.'");
  expect(readme).toMatch(/must\s+match the profile\/Team application-identifier prefix/);
});

test('macOS CI runs native fixtures and keeps signed identity verification gated', () => {
  const workflow = read('../../../.github/workflows/mac-app-build.yml');
  expect(workflow).toContain('IndexConnector/connector-contract.spec.mjs');
  expect(workflow).toContain('./build.sh --fixture ConnectorProtocolFixture');
  expect(workflow).toContain('./build.sh --fixture KeychainIntegrationFixture');
  expect(workflow).toContain('./build.sh --fixture AuthorizationFixture');
  expect(workflow).toContain('./build.sh --fixture TransportFixture');
  expect(workflow).toContain('INDEX_KEYCHAIN_SIGNING_FIXTURE');
  expect(workflow).toContain('./build.sh --signed-access-fixture');
});

test('dependency-free macOS CI delegates dependency-backed owner bridge checks', () => {
  const macWorkflow = read('../../../.github/workflows/mac-app-build.yml');
  const securityWorkflow = read('../../../.github/workflows/hermes-runtime-security.yml');
  expect(macWorkflow).not.toContain('api/native-api-bridge.spec.mjs');
  expect(securityWorkflow).toContain('apps/mac/api/native-api-bridge.spec.mjs');
});

test('production connector endpoints and build mode cannot be supplied by callers', () => {
  const identity = read('./Sources/ConnectorIdentity.swift');
  const runtime = read('./Sources/ConnectorRuntime.swift');
  const build = read('./build.sh');
  expect(identity).toContain('"IndexWebURL", expected: "https://index.network"');
  expect(identity).toContain('"IndexAPIURL", expected: "https://protocol.index.network"');
  expect(identity).toContain('ConnectorEmbeddedReleaseConfiguration.apiURL.appending(path: "api")');
  expect(identity).toContain('ConnectorEmbeddedReleaseConfiguration.apiURL.appending(path: "mcp")');
  expect(identity).toContain('#if INDEX_CONNECTOR_NONPRODUCTION');
  expect(build).toContain('-DINDEX_CONNECTOR_NONPRODUCTION');
  expect(runtime).not.toMatch(/apiURL|mcpURL|webURL/);
  expect(runtime).not.toMatch(/CommandLine\.arguments|ProcessInfo\.processInfo\.environment/);
});

test('authorization, transport, persistence, and serialized runtime remain bounded and secret-free', () => {
  const authorization = read('./Sources/BrowserAuthorization.swift');
  const transport = read('./Sources/ConnectorHTTPClient.swift');
  const installation = read('./Sources/ConnectorInstallationStore.swift');
  const installationFixture = read('./Tests/InstallationStoreMultiprocessFixture.swift');
  const main = read('./Sources/main.swift');
  expect(authorization).toContain('SecRandomCopyBytes');
  expect(authorization).toContain('127.0.0.1');
  expect(authorization).toContain('/callback');
  expect(transport).toContain('"codeChallengeMethod": .string("S256")');
  expect(transport).toContain('timeoutInterval = 30');
  expect(transport).toContain('maximumResponseBytes = 1_048_576');
  expect(transport).toContain('maximumUploadBytes = 8_388_608');
  expect(transport).toContain('hermes-authorizations/disconnect');
  expect(transport).toContain('auth/me');
  expect(installation).toContain('Application Support');
  for (const token of ['@_silgen_name("flock")', 'connectorFlock(descriptor, LOCK_EX)', 'O_NOFOLLOW', 'readDurableState()', 'fsync(descriptor)', 'rename(temporaryURL.path']) {
    expect(installation).toContain(token);
  }
  expect(installation).not.toContain('Darwin.flock');
  for (const token of ['Process()', 'authorization', 'exchange', 'staleWriteAccepted', 'second.stateSnapshot == disconnected']) {
    expect(installationFixture).toContain(token);
  }
  expect(main).toContain('readLine(strippingNewline: true)');
  for (const source of [authorization, transport, installation, main]) {
    expect(source).not.toMatch(/print\(.*(?:credential|verifier|authorizationCode|code\b)/i);
  }
});

test('status exposes only the nonsecret authority tuple required for exact runtime selection', () => {
  const runtime = read('./Sources/ConnectorRuntime.swift');
  expect(runtime).toContain('"agentId": record.map');
  expect(runtime).toContain('"setupAttemptId": record.map');
  expect(runtime).toContain('health = "active"');
  const statusBlock = runtime.match(/private func statusObject[\s\S]*?private var disconnectedResult/)?.[0] ?? '';
  expect(statusBlock).not.toContain('credentialId');
  expect(statusBlock).not.toContain('rawCredential');
});

test('browser authorization is isolated to the Hermes route and API family', () => {
  const browserAuthorization = read('./Sources/BrowserAuthorization.swift');
  const httpClient = read('./Sources/ConnectorHTTPClient.swift');
  expect(browserAuthorization).toContain('endpoints.web.appending(path: "hermes-authorize")');
  expect(httpClient).toContain('path: "/hermes-authorizations"');
  expect(browserAuthorization).not.toContain('index-app-authorize');
  expect(httpClient).not.toContain('index-app-owner-authorizations');
});

test('authorize.start response is encoded without browser or setup details', () => {
  const runtime = read('./Sources/ConnectorRuntime.swift');
  const fixture = read('./Tests/ConnectorProtocolFixture.swift');
  expect(runtime).not.toContain('authorizationUrl');
  expect(fixture).toContain('authorizeStartPendingResponse');
  expect(fixture).toContain('"status":"pending"');
  for (const forbidden of ['authorizationUrl', 'requestId', 'state', 'redirectUri', 'redirect_uri']) {
    expect(fixture).toContain(`!authorizeStartJSON.contains("${forbidden}")`);
  }
});

test('runtime exclusively owns authorization side effects and epoch-CAS recovery', () => {
  const browser = read('./Sources/BrowserAuthorization.swift');
  const runtime = read('./Sources/ConnectorRuntime.swift');
  expect(browser).not.toContain('credentialStore');
  expect(browser).not.toContain('exchangeAuthorization');
  expect(browser).not.toContain('.activate(');
  expect(browser).toContain('BrowserAuthorizationCallback');
  expect(runtime).toContain('operationEpoch');
  expect(runtime).toContain('compareAndSet');
  expect(runtime).toContain('staleAuthorization');
  expect(runtime).toContain('if let failure {');
  expect(runtime).toContain('clearAuthorizationFailure()');
  for (const token of [
    'putRecoveryAndVerify', 'readRecovery', 'compareAndSetRecovery',
    'requireRevokedCredentialProbe', 'prepareIssuedRecovery',
    'normalizedIssuedRecoveryPhase', 'persistIssuedRecoveryPhase',
    'validateIssuedRecovery', 'acceptedEntryMaximum',
    'invalidateAuthorizationAfterRecoveryReadError',
  ]) expect(runtime).toContain(token);
  expect(runtime).not.toContain('record?.recoveryPhase == .none');
  expect(runtime).not.toContain('replacing(activationState: "active", recoveryPhase: .none)');
  expect(runtime).toContain('recoveryPhase: ConnectorRecoveryPhase.none');
  expect(runtime).toContain('let credentials: (primary: ConnectorCredentialRecord?, recovery: ConnectorCredentialRecord?)');
  expect(runtime).toContain('primary.recoveryPhase == ConnectorRecoveryPhase.none');
  const disconnectBlock = runtime.match(
    /private func disconnect\(\)[\s\S]*?private func recoverIssuedCredential/
  )?.[0] ?? '';
  expect(disconnectBlock.indexOf('validateIssuedRecovery')).toBeLessThan(
    disconnectBlock.indexOf('operationEpoch =')
  );
  expect(disconnectBlock).toContain('expected: entryJournal');
  expect(disconnectBlock).toContain('acceptedEntryMaximum: durableEpoch');
  const readErrorInvalidation = runtime.match(
    /private func invalidateAuthorizationAfterRecoveryReadError[\s\S]*?private func recoverIssuedCredential/
  )?.[0] ?? '';
  expect(readErrorInvalidation.indexOf('currentAttempt = nil')).toBeLessThan(
    readErrorInvalidation.indexOf('installationStore.compareAndSet')
  );
  expect(readErrorInvalidation).toContain('expected: entryJournal');
  expect(readErrorInvalidation).toContain('http.closeResources()');
  expect(readErrorInvalidation).toContain('browser.cancel(attemptId: attemptToCancel)');
  expect(runtime).toContain('let journalReserved = authorizationOwned(');
  expect(runtime).toMatch(/guard keychainPersisted,[\s\S]*?authorizationOwned\(/);
});

test('rest variants bound uploads and poll connector-owned SSE streams', () => {
  const runtime = read('./Sources/ConnectorRuntime.swift');
  const transport = read('./Sources/ConnectorHTTPClient.swift');
  const fixture = read('./Tests/TransportFixture.swift');
  for (const token of [
    'upload.start', 'upload.chunk', 'upload.finish', 'upload.abort',
    'sse.start', 'sse.poll', 'sse.close',
  ]) expect(runtime).toContain(token);
  for (const token of [
    'maximumUploadChunkBytes = 131_072', 'maximumSSEEvents = 256',
    'maximumSSEBufferBytes = 1_048_576', 'closeResources()',
  ]) expect(transport).toContain(token);
  for (const token of ['upload_sequence_mismatch', 'upload_hash_mismatch', 'sse_overflow']) {
    expect(`${runtime}\n${transport}`).toContain(token);
  }
  for (const token of [
    'uploadSequencing', 'uploadHashMismatch', 'uploadSizeMismatch',
    'uploadCleanup', 'uploadDisallowedPath', 'streamOverflow',
    'streamClose', 'streamError',
  ]) expect(fixture).toContain(token);
});

test('ambiguous upstream response processing has one stable retry signal', () => {
  const runtime = read('./Sources/ConnectorRuntime.swift');
  const transport = read('./Sources/ConnectorHTTPClient.swift');
  const pythonTransport = read('../../../packages/hermes-plugin/connector_transport.py');
  const tools = read('../../../packages/hermes-plugin/tools.py');
  expect(transport).toContain('case upstreamAmbiguousResponse');
  expect(runtime).toContain('code: "upstream_ambiguous_response"');
  expect(pythonTransport).toContain('"upstream_ambiguous_response"');
  expect(tools).toContain('"connector_invalid_response"');
  expect(tools).toContain('"upstream_ambiguous_response"');
  expect(transport).toContain('resolveCompletedResponse');
  for (const token of [
    'known400ThenTimeout', 'known500ThenNetworkFailure',
    'successfulMalformedMutation', 'successfulTimedOutMutation',
  ]) expect(read('./Tests/TransportFixture.swift')).toContain(token);
});

test('resource caps and independent idle timer are exact and fixture-controlled', () => {
  const transport = read('./Sources/ConnectorHTTPClient.swift');
  const fixture = read('./Tests/TransportFixture.swift');
  for (const token of [
    'maxActiveUploads = 2', 'maxActiveStreams = 4',
    'maxAggregateUploadBufferBytes = 16_777_216',
    'maxAggregateStreamBufferBytes = 4_194_304',
    'cleanupCadenceSeconds = 5.0', 'resourceIdleSeconds = 120.0',
    'ConnectorDeadlineScheduling', 'cleanupTimer', 'deinit',
  ]) expect(transport).toContain(token);
  for (const token of [
    'ManualDeadlineScheduler', 'manualClock', 'uploadCapRefusal',
    'streamCapRefusal', 'idleCleanupWithoutFollowupRequest',
  ]) expect(fixture).toContain(token);
  expect(fixture).not.toContain('usleep(');
});

test('structured Hermes run authority renders only exact negotiation headers', () => {
  const runtime = read('./Sources/ConnectorRuntime.swift');
  const transport = read('./Sources/ConnectorHTTPClient.swift');
  const fixture = read('./Tests/TransportFixture.swift');
  expect(runtime).toContain('"hermesRun"');
  expect(transport).toContain('private func hermesRunHeaders');
  expect(transport).toContain('x-index-hermes-run-id');
  expect(transport).toContain('x-index-hermes-run-capability');
  expect(transport).toContain('throw ConnectorHTTPError.hermesRunDenied');
  expect(fixture).toContain('bad\\nrun');
  expect(fixture).toContain('opaque-run');
  expect(runtime).not.toContain('additionalHeaders');
});

test('native Swift fixtures evaluate throwing calls before assertion autoclosures', () => {
  for (const fixture of [
    read('../Security/Tests/IndexKeychainIntegrationFixture.swift'),
    read('./Tests/AuthorizationFixture.swift'),
    read('./Tests/TransportFixture.swift'),
    read('./Tests/InstallationStoreMultiprocessFixture.swift'),
  ]) {
    expect(fixture).not.toMatch(/(?:precondition|assert)\(\s*try/s);
    expect(fixture).not.toMatch(/\?\.recoveryPhase\s*==\s*\.none/);
    expect(fixture).not.toContain('failPhase = .none');
  }
});

test('native fixtures cover callback replay, keychain ordering, transport bounds, and recovery mode', () => {
  const authorization = read('./Tests/AuthorizationFixture.swift');
  const transport = read('./Tests/TransportFixture.swift');
  for (const token of ['wrongState', 'callbackReplay', 'wrongPath', 'wrongHost', 'keychainWriteBeforeActivation', 'activationOmittedAfterKeychainFailure']) {
    expect(authorization).toContain(token);
  }
  for (const token of ['deniedRoute', 'deniedTool', 'oversizedPayload', 'endpointOverride', 'pendingRevocation', 'recovery_only']) {
    expect(transport).toContain(token);
  }
  for (const token of [
    'firstRecoveryPersistenceFailure', 'activationTimeout', 'accountLabelFailure',
    'activeKeychainWriteFailure', 'receiptMismatch', 'activeProbeFailure',
    'serverUncertaintyKeyRetention', 'keychainDeletionFailure',
    'journalClearFailureNoKeyConvergence', 'initialRecoveryJournalFailure',
    'serverReceiptJournalFailure', 'probeConfirmedJournalFailure',
    'failNoneTransitionNumber = 2',
    'primaryEncoder.outputFormatting = [.sortedKeys]',
    'activationRequestedJournalFailure', 'labelUpdateKeychainFailure',
    'disconnectBeforeCallback', 'callbackBeforeDisconnectBeforePoll',
    'disconnectWhileActivationBlocked', 'disconnectWhileExchangeBlocked',
    'staleIssuedPreparedBeforeRevoke', 'staleIssuedJournalPreparationFailureNoNetwork',
    'staleIssuedReceiptBeforeProbe',
    'probeFailureAfterReceiptRestart', 'recoveryDeletionFailureAfterProbe',
    'immediateJournalClearFailureAfterProbe', 'recoveryEpochAdoption',
    'recoveryIdentityGenerationMismatch', 'futureRecoveryBoundaryFence',
    'legitimateRecoveryEpochAdoption', 'staleIssuedReceiptIdentityMismatch',
    'newerPrimaryRecoveryFence', 'recoveryReadErrorDuringExchange',
    'recoveryReadErrorWithoutAttempt', 'recoveryReadErrorPreservesProof',
    'recoveryReadErrorCASFailureRace',
    'failNextRecoveryRead',
    'disconnectArrived', 'releaseDisconnect', 'probeArrived', 'releaseProbe',
    'exchangeArrived', 'releaseExchange', 'repeatedExpiredPoll',
    'repeatedAmbiguousFailurePoll',
  ]) {
    expect(`${authorization}\n${transport}`).toContain(token);
  }
});
