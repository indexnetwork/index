import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createIndexApiClient, createNativeAPIRequestBridge } from './client.mjs';

const mainSwift = readFileSync(new URL('../IndexApp/Sources/main.swift', import.meta.url), 'utf8');
const ownerStore = readFileSync(new URL('../IndexApp/Sources/OwnerCredentialStore.swift', import.meta.url), 'utf8');
const nativeBridge = readFileSync(new URL('../IndexApp/Sources/NativeAPIRequestBridge.swift', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('./client.mjs', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../IndexApp/src/index-amiga/api.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../IndexApp/src/index-amiga/app.jsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../IndexApp/src/index-amiga/settings.jsx', import.meta.url), 'utf8');
const plist = readFileSync(new URL('../IndexApp/Info.plist', import.meta.url), 'utf8');
const build = readFileSync(new URL('../IndexApp/build.sh', import.meta.url), 'utf8');
const migrationFixture = readFileSync(new URL('../IndexApp/Tests/OwnerCredentialMigrationFixture.swift', import.meta.url), 'utf8');
const streamFixture = readFileSync(new URL('../IndexApp/Tests/NativeAPIStreamDelegateFixture.swift', import.meta.url), 'utf8');
const bodyFixture = readFileSync(new URL('../IndexApp/Tests/NativeAPIBodyValidationFixture.swift', import.meta.url), 'utf8');
const quarantineFixture = readFileSync(new URL('../IndexApp/Tests/NativeAPIQuarantineFixture.swift', import.meta.url), 'utf8');
const macWorkflow = readFileSync(new URL('../../../.github/workflows/mac-app-build.yml', import.meta.url), 'utf8');
const mcpTransportSource = readFileSync(new URL('../../../node_modules/@modelcontextprotocol/server/dist/index.mjs', import.meta.url), 'utf8');

function createBridgeHarness() {
  const posted = [];
  let next = 0;
  const bridge = createNativeAPIRequestBridge({
    createRequestId: () => `opaque-${++next}`,
    postMessage: (message) => posted.push(message),
    timeoutMs: 1_000,
  });
  return { bridge, posted };
}

describe('credential-free native API JavaScript boundary', () => {
  it('correlates one terminal response and drops duplicates', async () => {
    const { bridge, posted } = createBridgeHarness();
    const pending = bridge.request({ kind: 'http', method: 'GET', path: '/auth/me' });
    expect(posted).toEqual([{
      requestId: 'opaque-1',
      operation: { kind: 'http', method: 'GET', path: '/auth/me' },
    }]);
    expect(bridge.receive({ requestId: 'opaque-1', ok: true, status: 200, body: { user: { id: 'u1' } } })).toBe(true);
    expect(bridge.receive({ requestId: 'opaque-1', ok: true, status: 200, body: { user: { id: 'attacker' } } })).toBe(false);
    await expect(pending).resolves.toEqual({ status: 200, body: { user: { id: 'u1' } }, headers: {} });
  });

  it('delivers bounded events and sends correlated cancellation on abort', async () => {
    const { bridge, posted } = createBridgeHarness();
    const controller = new AbortController();
    const events = [];
    const pending = bridge.request(
      { kind: 'sse', method: 'GET', path: '/conversations/stream' },
      { signal: controller.signal, onEvent: (event) => events.push(event) },
    );
    expect(bridge.receiveEvent({ requestId: 'opaque-1', sequence: 0, event: { type: 'message' } })).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual([{ type: 'message' }]);
    expect(posted.at(-1)).toEqual({
      requestId: 'opaque-2',
      operation: { kind: 'cancel', targetRequestId: 'opaque-1' },
    });
  });

  it('preserves resource wrappers over structured native operations', async () => {
    const operations = [];
    const client = createIndexApiClient({
      nativeRequest: async (operation) => {
        operations.push(operation);
        return { status: 200, body: { opportunities: [] }, headers: {} };
      },
    });
    await client.opportunities.list({ status: 'pending', limit: 10 });
    await client.questions.dismiss('question/1');
    expect(operations).toEqual([
      { kind: 'http', method: 'GET', path: '/opportunities?status=pending&limit=10' },
      { kind: 'http', method: 'POST', path: '/questions/question%2F1/dismiss', body: {} },
    ]);
  });

  it('contains no JavaScript-visible owner credential path', () => {
    for (const source of [apiSource, appSource, settingsSource]) {
      expect(source).not.toMatch(/x-api-key|ownerCredential|INDEX_NATIVE\.apiKey|native\(\)\.apiKey/);
    }
    expect(mainSwift).not.toMatch(/"apiKey"\s*:|__indexAuthChanged\([^)]*(?:apiKey|key)/);
    expect(mainSwift).not.toContain('targetKey');
    expect(apiSource).not.toMatch(/\bmcpCall\s*,|\binvokeTool\s*,/);
    expect(clientSource).not.toContain('invoke: (toolName');
  });
});

describe('native owner migration and transport source contracts', () => {
  it('keeps a strict durable revocation journal and deletes only credential.json', () => {
    expect(ownerStore).toContain('revocation_pending');
    expect(ownerStore).toContain('credential.json');
    expect(ownerStore).toContain('owner-credential-migration.json');
    expect(ownerStore).toContain('verifyLegacyCredentialAbsent');
    expect(ownerStore).toContain('Set(object.keys) == Self.legacyCredentialKeys');
    expect(ownerStore).toContain('^[A-Za-z0-9_-]+$');
    expect(ownerStore).not.toContain('removeItem(at: applicationSupportDirectory)');
    expect(mainSwift).not.toContain('removeItem(at: applicationSupportDirectory)');
    for (const evidence of [
      'malformed plaintext accepted', 'deletion failure accepted',
      'offline revocation evidence was not durable', 'legacy key ID missing',
      'absence read-back failure accepted', 'invalid legacy key ID accepted',
      'invalid legacy key ID source was deleted', 'Keychain read-back mismatch accepted',
    ]) expect(migrationFixture).toContain(evidence);
    expect(migrationFixture).not.toMatch(/require\(\s*try/s);
    expect(build).toContain('--fixture OwnerCredentialMigrationFixture');
    expect(macWorkflow).toContain('./build.sh --fixture OwnerCredentialMigrationFixture');
  });

  it('enforces exact native method/path/MCP/upload/SSE bounds before network work', () => {
    expect(nativeBridge).toContain('maximumJSONRequestBytes = 262_144');
    expect(nativeBridge).toContain('maximumJSONDepth = 16');
    expect(nativeBridge).toContain('maximumObjectKeys = 64');
    expect(nativeBridge).toContain('maximumArrayItems = 100');
    expect(nativeBridge).toContain('maximumStringBytes = 65_536');
    expect(nativeBridge).toContain('maximumUploadBytes = 8_388_608');
    expect(nativeBridge).toContain('maximumResponseBytes = 1_048_576');
    expect(nativeBridge).toContain('maximumEventBytes = 65_536');
    expect(nativeBridge).toContain('maximumEvents = 256');
    expect(nativeBridge).toContain('maximumPendingRequests = 32');
    expect(nativeBridge).toContain('containsForbiddenResponseField');
    expect(nativeBridge).toContain('allowedHTTPRoutes');
    expect(nativeBridge).toContain('/agent-runtime/reconcile-index');
    expect(nativeBridge).toContain('required: ["agentId", "installationId", "setupAttemptId"]');
    expect(nativeBridge).toContain('allowedMCPTools');
    expect(nativeBridge).toContain('/tools/read_user_contexts');
    expect(nativeBridge).toContain('/tools/preview_user_context');
    expect(nativeBridge).toContain('/tools/confirm_user_context');
    expect(nativeBridge).not.toContain('^/tools/[^/?]+$');
    expect(nativeBridge).toContain('isGloballyBoundedJSON');
    expect(nativeBridge).toContain('isAllowedBody');
    expect(nativeBridge).toContain('isAllowedSSEBody');
    expect(nativeBridge).toContain('isAllowedMCPArguments');
    expect(nativeBridge).toContain('exactTypedObject');
    expect(nativeBridge).toContain('boundedStringArray');
    expect(nativeBridge).toContain('validMessageParts');
    expect(nativeBridge).toContain('validDraft');
    expect(nativeBridge).toContain('hasAllowedQuery');
    expect(nativeBridge).toContain('create_intent');
    expect(mcpTransportSource).toContain('Client must accept both application/json and text/event-stream');
    expect(nativeBridge).toContain('application/json, text/event-stream');
    expect(nativeBridge).toContain('URLSessionDataDelegate');
    expect(nativeBridge).toContain('didReceive data: Data');
    expect(nativeBridge).toContain('maximumPartialFrameBytes = 65_536');
    expect(nativeBridge).toContain('maximumEventAggregateBytes = 1_048_576');
    expect(nativeBridge).toContain('rawBytesReceived');
    expect(nativeBridge).toContain('data.count <= NativeAPIRequestBridge.maximumEventAggregateBytes - rawBytesReceived');
    expect(nativeBridge).toContain('beginQuarantine');
    expect(nativeBridge).toContain('endQuarantineAfterCredentialReadBack');
    expect(streamFixture).toContain('mid-stream event was completion-buffered');
    expect(streamFixture).toContain('partial-frame overflow was not cancelled');
    expect(streamFixture).toContain('malformed SSE was not cancelled');
    expect(streamFixture).toContain('comment-only raw-byte overflow was not cancelled');
    expect(streamFixture).toContain('framing-overhead overflow published a decoded event');
    expect(build).toContain('--fixture NativeAPIStreamDelegateFixture');
    expect(build).toContain('--fixture NativeAPIBodyValidationFixture');
    expect(build).toContain('--fixture NativeAPIQuarantineFixture');
    expect(macWorkflow).toContain('./build.sh --fixture NativeAPIStreamDelegateFixture');
    expect(macWorkflow).toContain('./build.sh --fixture NativeAPIBodyValidationFixture');
    expect(macWorkflow).toContain('./build.sh --fixture NativeAPIQuarantineFixture');
    for (const evidence of ['depth overflow accepted', 'object-key overflow accepted', 'array overflow accepted',
      'string overflow accepted', 'serialized overflow accepted', 'wrong/null/unknown typed body accepted',
      'bool-as-number accepted', 'arbitrary MCP tool accepted', 'arbitrary REST tool accepted',
      'intent enum parity failed', 'opportunity owner subset parity failed', 'unused global opportunity status accepted']) {
      expect(bodyFixture).toContain(evidence);
    }
    expect(nativeBridge).toContain('enumString($0["status"], ["ACTIVE", "PAUSED"])');
    expect(nativeBridge).toContain('enumString(item["status"], ["accepted", "rejected"])');
    expect(nativeBridge).toContain('message.frameInfo.isMainFrame');
    const handler = nativeBridge.match(/func handle\(_ message: WKScriptMessage\)[\s\S]*?private func decode/)?.[0] || '';
    expect(handler.indexOf('trustedMessage(message)')).toBeLessThan(handler.indexOf('message.body'));
    expect(nativeBridge).not.toMatch(/request\.headers|operation\.headers|URL\(string:\s*operation/);
  });

  it('quarantines and drains in-flight mutation/SSE work before logout revocation', () => {
    const quarantine = nativeBridge.match(/func beginQuarantine[\s\S]*?func endQuarantineAfterCredentialReadBack/)?.[0] || '';
    expect(quarantine).toContain('quarantined = true');
    expect(quarantine).toContain('snapshot.forEach { $0.cancel() }');
    expect(quarantine.indexOf('quarantined = true')).toBeLessThan(quarantine.indexOf('snapshot.forEach'));
    expect(nativeBridge).toContain('guard !quarantined, tasks.count < Self.maximumPendingRequests');
    const finish = nativeBridge.match(/private func finish\(_ response[\s\S]*?\n    }\n}/)?.[0] || '';
    expect(finish.indexOf('terminal(response)')).toBeLessThan(finish.indexOf('drains.forEach'));
    expect(finish).toContain('streamContexts.removeValue');
    expect(mainSwift).toContain('retryPendingOwnerRevocation');
    expect(quarantineFixture).toContain('logout revoked before active requests drained');
    expect(quarantineFixture).toContain('quarantine admitted a new request');
    expect(quarantineFixture).toContain('SSE terminal did not precede revoke drain');
    expect(quarantineFixture).toContain('verified activation did not reopen quarantine');
  });

  it('uses code-only PKCE exchange, Keychain verification, activation/rollback, and ordered revocation', () => {
    expect(mainSwift).toContain('Data(SHA256.hash');
    expect(mainSwift).toContain('secureRandomState');
    expect(mainSwift).toContain('secureRandomBytesProvider');
    expect(mainSwift).toContain('secure_random_unavailable');
    const login = mainSwift.match(/private func startLogin[\s\S]*?private func finishLogin/)?.[0] || '';
    expect(login.indexOf('secureRandomState()')).toBeLessThan(login.indexOf('LoopbackAuthServer(state:'));
    expect(login.indexOf('secure_random_unavailable')).toBeLessThan(login.indexOf('performOwnerRequest'));
    expect(mainSwift).not.toMatch(/UUID\(\)\.uuidString \+ UUID\(\)\.uuidString/);
    expect(mainSwift).toContain('/index-app-owner-authorizations/exchange');
    expect(mainSwift).toContain('try store.putAndVerify(record)');
    expect(mainSwift).toContain('/index-app-owner-authorizations/activate');
    expect(mainSwift).toContain('/index-app-owner-authorizations/rollback');
    expect(mainSwift).toContain('/index-app-owner-authorizations/revoke');
    const logoutBlock = mainSwift.match(/private func logout[\s\S]*?private func verifyCredentialDenied/)?.[0] || '';
    expect(logoutBlock.indexOf('beginQuarantine')).toBeLessThan(logoutBlock.indexOf('revokeAndDelete'));
    expect(logoutBlock.indexOf('verifyCredentialDenied')).toBeLessThan(logoutBlock.indexOf('store.deleteAndVerify()'));
    expect(mainSwift).toContain('Set(names) == ["request_id", "code", "state"]');
    expect(mainSwift).not.toMatch(/api_key|session_token|targetKey/);
  });

  it('requires the owner-only access group and macOS 13 production inspection boundary', () => {
    expect(ownerStore).toContain('network.index.system6.owner-credentials');
    expect(ownerStore).not.toContain('network.index.connector.credentials');
    expect(build).toContain('Sources/OwnerCredentialStore.swift');
    expect(build).toContain('Sources/NativeAPIRequestBridge.swift');
    expect(build).toContain('apple-macosx13.0');
    expect(plist).toMatch(/<key>LSMinimumSystemVersion<\/key>\s*<string>13\.0<\/string>/);
    expect(mainSwift).toContain('#if INDEX_DEVELOPMENT_BUILD');
    expect(mainSwift).toContain('developerExtrasEnabled');
    expect(mainSwift).toContain('isInspectable');
  });
});
