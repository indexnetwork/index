# Hermes Secure Standalone Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Hermes connect to and use all normal Index capabilities on macOS without the Index app while keeping Hermes and owner credentials in Keychain and preserving PR #1348's negotiation safety contracts.

**Architecture:** A distinct `hermes-agent` server principal is authorized through a PKCE browser flow and activated only after plaintext cleanup and Keychain verification. A signed native Index Connector owns the Hermes credential and provides a bounded JSON transport to the plugin; the optional Index app uses a separate Keychain item and a native API bridge so no owner secret enters JavaScript.

**Tech Stack:** Bun/TypeScript, Elysia controllers, Drizzle/PostgreSQL, React, Python Hermes plugin, Swift/Foundation/Security.framework, macOS 13+, provider-free contract tests, native macOS fixtures.

## Global Constraints

- Base this PR on PR #1348; do not weaken its generation, one-shot capability, privacy projection, atomic response/outbox, stale-heartbeat fallback, or exact four-tool negotiator contracts.
- Production support is macOS 13+ only.
- Persist only the canonical actions `manage:identity`, `manage:premises`, `manage:intents`, `manage:networks`, `manage:opportunities`, and `manage:negotiations`; never persist retired `manage:profile` or `manage:contacts`.
- Keep `hermes-negotiator` default-denied outside its existing negotiation routes; add a distinct `hermes-agent` audience for full mode.
- Credentials expire after exactly 30 days and warn beginning seven days before expiry; there is no refresh token.
- Production credentials may exist only in Keychain and process memory. They must not appear in `.env`, Application Support JSON, argv, logs, callback URLs, WebKit storage, generated HTML, or connector responses.
- Index app owner and standalone Hermes credentials use separate Keychain access groups and cannot read one another.
- Production endpoints are embedded in the signed connector; caller-supplied endpoints are development-only.
- Database-backed tests run only against a proven dedicated disposable database with `TEST_DATABASE_SAFE=1`.
- Regenerate, never hand-edit, `packages/hermes-plugin/desktop/dist/plugin.js` and `apps/mac/IndexApp/Resources/index.html`.
- Do not merge, deploy, or issue production credentials without explicit authorization.

---

### Task 1: Prove the Keychain and connector protocol boundaries

**Files:**
- Create: `apps/mac/Security/Sources/IndexKeychainStore.swift`
- Create: `apps/mac/Security/Tests/IndexKeychainIntegrationFixture.swift`
- Create: `apps/mac/IndexConnector/Sources/ConnectorProtocol.swift`
- Create: `apps/mac/IndexConnector/Tests/ConnectorProtocolFixture.swift`
- Create: `apps/mac/IndexConnector/Info.plist`
- Create: `apps/mac/IndexConnector/IndexConnector.entitlements`
- Create: `apps/mac/IndexConnector/build.sh`
- Create: `apps/mac/IndexConnector/connector-contract.spec.mjs`
- Modify: `.github/workflows/mac-app-build.yml`

**Interfaces:**
- Produces: `IndexKeychainItemDescriptor(service:account:accessGroup:)`.
- Produces: `IndexKeychainStore.putAndVerify(_:descriptor:)`, `.read(descriptor:)`, and `.delete(descriptor:)`.
- Produces: `ConnectorRequest`, `ConnectorResponse`, `ConnectorOperation`, and `connectorProtocolVersion = 1`.
- Produces: the `IndexConnector.app/Contents/MacOS/IndexConnector` executable contract consumed by Tasks 4 and 5.

- [ ] **Step 1: Write failing provider-free connector contract tests**

```javascript
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Sources/ConnectorProtocol.swift', import.meta.url), 'utf8');

test('connector protocol is exact, bounded, and credential-free', () => {
  expect(source).toContain('static let current = 1');
  expect(source).toContain('case hello, status, authorizeStart, authorizePoll, rest, mcp, disconnect');
  expect(source).toContain('rejectUnknownKeys');
  expect(source).toContain('maximumRequestBytes = 262_144');
  expect(source).not.toMatch(/apiKey.*ConnectorResponse|credential.*ConnectorResponse/);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `bun test apps/mac/IndexConnector/connector-contract.spec.mjs`
Expected: FAIL because the connector protocol files do not exist.

- [ ] **Step 3: Implement exact Swift request/response types and strict decoding**

```swift
enum ConnectorProtocolVersion { static let current = 1 }
indirect enum JSONValue: Codable {
    case null, bool(Bool), number(Double), string(String)
    case array([JSONValue]), object([String: JSONValue])
}
enum ConnectorOperation: String, Codable {
    case hello, status, authorizeStart, authorizePoll, rest, mcp, disconnect
}
struct ConnectorRequest: Codable {
    let protocolVersion: Int
    let id: String
    let operation: ConnectorOperation
    let payload: [String: JSONValue]
}
struct ConnectorResponse: Codable {
    let protocolVersion: Int
    let id: String
    let success: Bool
    let result: JSONValue?
    let error: ConnectorError?
}
```

Implement `StrictConnectorDecoder.decode(_:)` with a 262,144-byte request limit, exact top-level keys, a 128-character correlation-ID limit, and rejection of credential/code/verifier/header fields in responses.

- [ ] **Step 4: Write and run real Keychain CRUD/failure fixtures**

```swift
let descriptor = IndexKeychainItemDescriptor(
    service: "network.index.connector.fixture",
    account: UUID().uuidString,
    accessGroup: ProcessInfo.processInfo.environment["INDEX_TEST_KEYCHAIN_GROUP"]
)
try store.putAndVerify(Data("fixture-secret".utf8), descriptor: descriptor)
precondition(try store.read(descriptor: descriptor) == Data("fixture-secret".utf8))
try store.delete(descriptor: descriptor)
precondition(try store.read(descriptor: descriptor) == nil)
```

Run on macOS:

```bash
swiftc -parse-as-library -framework Foundation -framework Security \
  apps/mac/Security/Sources/IndexKeychainStore.swift \
  apps/mac/Security/Tests/IndexKeychainIntegrationFixture.swift \
  -o "$RUNNER_TEMP/index-keychain-fixture"
"$RUNNER_TEMP/index-keychain-fixture"
```

Expected: PASS for add/read/update/delete, duplicate replacement, injected `errSecInteractionNotAllowed`, failed read-back, and deletion failure.

- [ ] **Step 5: Add distinct signed-identity contract gates**

`IndexConnector.entitlements` must contain only the connector access group. The app's generated entitlements must contain only the app owner-credential access group plus associated domains. Add a fixture that signs two small app bundles and asserts each receives `errSecItemNotFound` for the other descriptor; gate the protected signed run on `INDEX_KEYCHAIN_SIGNING_FIXTURE=1`.

Run: `bun test apps/mac/IndexConnector/connector-contract.spec.mjs`
Expected: PASS and no shared access-group string between app and connector contracts.

- [ ] **Step 6: Commit**

```bash
git add apps/mac/Security apps/mac/IndexConnector .github/workflows/mac-app-build.yml
git commit -m "feat(mac): add secure Index connector foundation"
```

---

### Task 2: Add transactional Hermes browser authorization

**Files:**
- Create: `services/api/drizzle/0120_add_hermes_authorizations.sql`
- Create: `services/api/drizzle/meta/0120_snapshot.json`
- Modify: `services/api/drizzle/meta/_journal.json`
- Create: `services/api/src/lib/agent/hermes-capabilities.ts`
- Create: `services/api/src/lib/agent/hermes-authorization.ts`
- Create: `services/api/src/adapters/hermes-authorization.database.adapter.ts`
- Create: `services/api/src/services/hermes-authorization.service.ts`
- Create: `services/api/src/controllers/hermes-authorization.controller.ts`
- Create: `services/api/src/controllers/tests/hermes-authorization.controller.spec.ts`
- Create: `services/api/src/adapters/tests/hermes-authorization.database.isolated.ts`
- Modify: `services/api/src/schemas/database.schema.ts`
- Modify: `services/api/src/main.ts`
- Modify: `services/api/.test-isolated`

**Interfaces:**
- Consumes: connector protocol version `1` and PKCE S256 challenge.
- Produces: `HERMES_AGENT_AUDIENCE = "hermes-agent"`.
- Produces: `HERMES_CANONICAL_ACTIONS` and `HermesCapability`.
- Produces routes `POST /hermes-authorizations`, `POST /hermes-authorizations/:id/approve`, `POST /hermes-authorizations/exchange`, and `POST /hermes-authorizations/activate`.
- Produces `idxh_` credentials in the dedicated `hermes_agent_credentials` table; no `idxh_` secret or hash is inserted into the legacy `apikey` table.
- Produces pending credential metadata `{ audience, agentId, installationId, setupAttemptId, credentialId, actions, expiresAt, activationState }`.

- [ ] **Step 1: Write failing canonical-capability and PKCE tests**

```typescript
expect(HERMES_CANONICAL_ACTIONS).toEqual([
  'manage:identity', 'manage:premises', 'manage:intents',
  'manage:networks', 'manage:opportunities', 'manage:negotiations',
]);
expect(normalizeHermesCapabilities(['manage:profile'])).toEqual([
  'manage:identity', 'manage:premises',
]);
expect(() => normalizeHermesCapabilities(['manage:contacts'])).toThrow('retired_action');
```

Controller cases must cover unauthenticated approval, wrong verifier, wrong redirect, expired code, replayed code, duplicate parameters, and activation before Keychain confirmation.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd services/api
bun test src/controllers/tests/hermes-authorization.controller.spec.ts
```

Expected: FAIL because authorization routes and capability contracts are missing.

- [ ] **Step 3: Implement schema and one-time authorization records**

Create authorization records containing request ID, owner/agent/installation, exact loopback redirect, S256 challenge, requested canonical actions, hashed authorization code, expiry, approval/consumption timestamps, setup generation, and replay receipt. Create `hermes_agent_credentials` with a credential-row UUID, `idxh_` secret hash, owner/agent/installation/generation, canonical actions, pending/active/revoked state, issued/expiry timestamps, and unique live-generation indexes. Store no verifier, raw authorization code, or raw `idxh_` credential.

Migration invariants:

```sql
CHECK (code_challenge_method = 'S256');
CHECK (expires_at > created_at);
CREATE UNIQUE INDEX hermes_authorization_code_hash_unique
  ON hermes_authorizations (code_hash) WHERE code_hash IS NOT NULL;
```

- [ ] **Step 4: Implement prepare, exchange, and activation transactions**

`approveAuthorization()` acquires the owner advisory lock, selects Index fallback, revokes prior credentials for the installation, and creates a pending generation. `exchangeAuthorizationCode()` atomically consumes the code, verifies `BASE64URL(SHA256(verifier))`, creates one 30-day `idxh_` credential in `hermes_agent_credentials`, and returns the raw key once. `activatePendingHermesCredential()` verifies exact row/generation/actions and installs permissions only after connector confirmation. Add a compatibility assertion that the same hash has no row in `apikey`, so the PR #1348 base auth path rejects it as unknown.

- [ ] **Step 5: Run provider-free and disposable-database tests**

```bash
cd services/api
bun test src/controllers/tests/hermes-authorization.controller.spec.ts
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hermes_secure_connect \
TEST_DATABASE_SAFE=1 \
API_TEST_ISOLATED_TARGET=src/adapters/tests/hermes-authorization.database.isolated.ts \
bun test src/lib/testing/isolated-test-import-harness.spec.ts
```

Expected: all replay, expiry, prior-revocation, Index-fallback, pending, activation, and idempotency cases pass.

- [ ] **Step 6: Commit**

```bash
git add services/api/drizzle services/api/src services/api/.test-isolated
git commit -m "feat(api): authorize standalone Hermes securely"
```

---

### Task 3: Enforce the full Hermes principal without weakening negotiator mode

**Files:**
- Modify: `services/api/src/lib/agent/hermes-credential.ts`
- Modify: `services/api/src/lib/request-auth-context.ts`
- Modify: `services/api/src/guards/auth.guard.ts`
- Modify: `packages/protocol/src/mcp/mcp.authorization-policy.ts`
- Modify: `services/api/src/lib/agent/negotiation-runtime-authority.ts`
- Modify: `services/api/src/adapters/agent.database.adapter.ts`
- Modify: `services/api/src/services/agent-runtime.service.ts`
- Create: `services/api/src/guards/tests/hermes-agent-audience.spec.ts`
- Modify: `services/api/src/guards/tests/hermes-negotiator-audience.spec.ts`
- Modify: `services/api/src/controllers/tests/agent-negotiation-authorization.spec.ts`
- Modify: `packages/protocol/src/mcp/tests/mcp.authorization-policy.spec.ts`

**Interfaces:**
- Consumes: `HERMES_AGENT_AUDIENCE`, canonical actions, pending/active metadata from Task 2.
- Produces: `assertHermesAgentAudienceRoute(context, request)` and an exact MCP tool-to-capability profile.
- Preserves: `hermes-negotiator` route allowlist and MCP denial.

- [ ] **Step 1: Write an explicit allow/deny matrix test**

```typescript
const denied = [
  ['POST', '/auth/api-key'], ['DELETE', '/auth/account'],
  ['POST', '/agents'], ['POST', '/agents/permissions'],
  ['POST', '/billing/checkout'],
] as const;
for (const [method, path] of denied) {
  expect(authorizeHermesAgent({ method, path, actions: HERMES_CANONICAL_ACTIONS }))
    .toEqual({ allowed: false, reason: 'dedicated_principal_route_denied' });
}
expect(authorizeHermesAgent({ method: 'POST', path: '/mcp', actions: HERMES_CANONICAL_ACTIONS }).allowed)
  .toBe(true);
```

Also assert the negotiator audience remains denied for `/mcp` and every non-negotiation route.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd services/api
bun test src/guards/tests/hermes-agent-audience.spec.ts src/guards/tests/hermes-negotiator-audience.spec.ts
```

Expected: FAIL because the full principal is not recognized.

- [ ] **Step 3: Implement metadata validation before route admission**

Route `idxh_` inputs to the dedicated credential lookup before the legacy Better Auth key path. Require exact audience, agent, installation, setup generation, dedicated credential-row ID, canonical actions, active state, and expiry. Unknown or retired actions make the credential malformed rather than broadening access. Add a frozen base-auth fixture proving the pre-PR binary queries only `apikey` and rejects every `idxh_` value.

- [ ] **Step 4: Add exact MCP policy mapping**

Map every exposed Hermes tool to one canonical action. Profile and contact product operations must resolve through canonical identity/premises/network actions; never restore retired permission strings. Unknown MCP tools default deny.

- [ ] **Step 5: Preserve transaction-time negotiation fencing**

Allow `hermes-agent` only when the active credential still has `manage:negotiations`, then recheck selected executor, credential row, generation, expiry, expected speaker, and one-shot capability under the owner lock.

- [ ] **Step 6: Run affected protocol and API tests**

```bash
cd packages/protocol
bun test src/mcp/tests/mcp.authorization-policy.spec.ts
cd ../../services/api
bun test src/guards/tests/hermes-agent-audience.spec.ts \
  src/guards/tests/hermes-negotiator-audience.spec.ts \
  src/controllers/tests/agent-negotiation-authorization.spec.ts
```

Expected: PASS with no change to negotiator-mode denials.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/mcp services/api/src
git commit -m "feat(api): scope full Hermes agent access"
```

---

### Task 4: Implement native authorization and bounded Index transport

**Files:**
- Create: `apps/mac/IndexConnector/Sources/main.swift`
- Create: `apps/mac/IndexConnector/Sources/ConnectorRuntime.swift`
- Create: `apps/mac/IndexConnector/Sources/BrowserAuthorization.swift`
- Create: `apps/mac/IndexConnector/Sources/ConnectorHTTPClient.swift`
- Create: `apps/mac/IndexConnector/Sources/ConnectorCredentialStore.swift`
- Create: `apps/mac/IndexConnector/Sources/ConnectorIdentity.swift`
- Create: `apps/mac/IndexConnector/Tests/AuthorizationFixture.swift`
- Create: `apps/mac/IndexConnector/Tests/TransportFixture.swift`
- Modify: `apps/mac/IndexConnector/build.sh`
- Modify: `.github/workflows/mac-app-build.yml`

**Interfaces:**
- Consumes: Task 1 protocol/store and Task 2 authorization routes.
- Produces operations `hello`, `status`, `authorize.start`, `authorize.poll`, `rest`, `mcp`, `disconnect`.
- Produces status `{ connected, accountLabel, installationId, actions, expiresAt, health, revocationPending }` with no secret fields.

- [ ] **Step 1: Write failing native authorization fixture cases**

Use a local fixture server and assert: exact `127.0.0.1` callback, random ephemeral port, state equality, S256 verifier, one callback only, no credential in callback URL, Keychain write/read before activation, and activation omitted after injected Keychain failure.

- [ ] **Step 2: Compile and verify RED**

```bash
cd apps/mac/IndexConnector
./build.sh --fixture AuthorizationFixture
```

Expected: compiler failure because native authorization types are missing.

- [ ] **Step 3: Implement browser authorization without argv secrets**

Generate state and verifier with `SecRandomCopyBytes`. Send only challenge, installation ID, redirect, and requested actions to `POST /hermes-authorizations`. Exchange the returned code from the loopback callback inside connector memory. Never emit code or verifier through stdout.

- [ ] **Step 4: Implement route/tool allowlists and bounded HTTP**

`ConnectorHTTPClient` accepts embedded HTTPS API/MCP endpoints and structured operations, not arbitrary URLs or headers. Set 30-second timeouts, 1 MiB responses, 8 MiB upload limits, and sanitized stable errors. `disconnect` enters recovery-only mode until server revocation succeeds, then deletes the Keychain item.

- [ ] **Step 5: Run native and provider-free contracts**

```bash
cd apps/mac/IndexConnector
./build.sh --fixture AuthorizationFixture
./build.sh --fixture TransportFixture
cd ../../..
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

Expected: PASS for wrong state, callback replay, wrong path/host, expired code, Keychain failures, denied route/tool, oversized payload, endpoint override, and pending revocation.

- [ ] **Step 6: Commit**

```bash
git add apps/mac/IndexConnector .github/workflows/mac-app-build.yml
git commit -m "feat(mac): connect Hermes through Keychain"
```

---

### Task 5: Move the Hermes plugin onto Index Connector

**Files:**
- Create: `packages/hermes-plugin/transport.py`
- Create: `packages/hermes-plugin/connector_transport.py`
- Create: `packages/hermes-plugin/env_transport.py`
- Create: `packages/hermes-plugin/migration.py`
- Create: `packages/hermes-plugin/tests/connector_protocol.py`
- Create: `packages/hermes-plugin/tests/migration.py`
- Modify: `packages/hermes-plugin/tools.py`
- Modify: `packages/hermes-plugin/dashboard/plugin_api.py`
- Modify: `packages/hermes-plugin/dashboard/auth_login.py`
- Modify: `packages/hermes-plugin/__init__.py`
- Modify: `packages/hermes-plugin/tests/smoke.py`
- Modify: `packages/hermes-plugin/tests/gateway.py`
- Modify: `packages/hermes-plugin/plugin.yaml`

**Interfaces:**
- Consumes: connector operations from Task 4.
- Produces: `IndexTransport.status()`, `.start_authorization()`, `.poll_authorization()`, `.request_rest()`, `.call_mcp()`, and `.disconnect()`.
- Production connector discovery checks only `/Applications/Index Connector.app/Contents/MacOS/IndexConnector` and `$HOME/Applications/Index Connector.app/Contents/MacOS/IndexConnector`; it never searches `PATH` or accepts an environment path.
- Preserves: existing tool handler names and hidden negotiation run-state behavior.

- [ ] **Step 1: Write failing fake-transport and migration tests**

```python
class FakeTransport:
    def call_mcp(self, tool_name, arguments):
        return {"content": [{"type": "text", "text": "ok"}]}

def test_production_never_reads_environment_key(monkeypatch):
    monkeypatch.setenv("INDEX_API_KEY", "must-not-be-read")
    monkeypatch.delenv("INDEX_PLUGIN_DEVELOPMENT_TRANSPORT", raising=False)
    transport = build_transport(platform="darwin")
    assert transport.__class__.__name__ == "ConnectorTransport"
```

Migration tests must prove `.env` cleanup and verification finish before `authorize.start`, and cleanup failure leaves Hermes paused.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd packages/hermes-plugin
python3 tests/connector_protocol.py
python3 tests/migration.py
```

Expected: FAIL because the transport modules are missing.

- [ ] **Step 3: Implement one transport seam for every MCP/REST/upload path**

Route `_call_index_mcp`, `_api_request`, dashboard multipart upload, conversations, SSE setup, and auth/status through `IndexTransport`. `EnvironmentCredentialTransport` requires both `INDEX_PLUGIN_DEVELOPMENT_TRANSPORT=1` and a non-production package marker. Production discovery checks only the two fixed Applications locations, verifies the signed identity/hash, and returns the signed download-page URL when absent.

- [ ] **Step 4: Implement forced secure relogin migration**

Persist only installation/key IDs, pause owned scheduling, remove the six owned `.env` keys with descriptor-safe verification, and only then allow connector authorization. Never copy the old key into Keychain.

- [ ] **Step 5: Preserve full and negotiator registration tests**

```bash
cd packages/hermes-plugin
python3 tests/connector_protocol.py
python3 tests/migration.py
python3 tests/smoke.py
python3 tests/gateway.py
```

Expected: PASS; negotiator registers exactly four handlers and full mode retains broad wrappers/dashboard without direct API-key access. Status tests assert `reconnectSoon: true` at seven days remaining, immediate reconnect-required denial after expiry, and no silent renewal.

- [ ] **Step 6: Commit**

```bash
git add packages/hermes-plugin
git commit -m "feat(hermes): use secure Index connector"
```

---

### Task 6: Add browser consent and web owner controls

**Files:**
- Create: `apps/web/src/app/hermes-authorize/page.tsx`
- Create: `apps/web/src/lib/hermes-auth.ts`
- Create: `apps/web/src/services/connected-agents.ts`
- Create: `apps/web/src/app/agents/connected/page.tsx`
- Create: `apps/web/tests/hermes-authorize.page.test.tsx`
- Create: `apps/web/tests/connected-agents.page.test.tsx`
- Create: `apps/web/src/lib/__tests__/hermes-auth.test.ts`
- Modify: `apps/web/src/routes.tsx`
- Modify: `apps/web/src/contexts/AuthContext.tsx`
- Modify: `apps/web/src/components/settings/AgentApiKeysSection.tsx`

**Interfaces:**
- Consumes: authorization/connected-agent APIs from Task 2.
- Produces: `/hermes-authorize` and `/agents/connected` owner pages.

- [ ] **Step 1: Write failing strict-query and consent tests**

```typescript
expect(parseHermesAuthorizationQuery(
  '?request_id=req_123&state=opaque_state&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
)).toEqual({
  requestId: 'req_123', state: 'opaque_state',
  redirectUri: 'http://127.0.0.1:49152/callback',
});
```

Reject `localhost`, IPv6 aliases, userinfo, fragments, foreign paths, duplicate parameters, non-loopback hosts, and invalid ports.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/web
bun test src/lib/__tests__/hermes-auth.test.ts tests/hermes-authorize.page.test.tsx
```

Expected: FAIL because pages/parser are missing.

- [ ] **Step 3: Implement owner-visible exact consent**

Render the six canonical capabilities in plain product language, account/installation identity, 30-day expiry, and explicit excluded security powers. Approval sends only request ID; the browser never receives the credential or verifier.

- [ ] **Step 4: Implement connected-agent controls**

List status, heartbeat, expiry, actions, and runtime health. Pause/revoke require confirmation and refresh server state. Reconnect starts a new authorization flow; it never silently extends a credential.

- [ ] **Step 5: Run affected web tests**

```bash
cd apps/web
bun test src/lib/__tests__/hermes-auth.test.ts \
  tests/hermes-authorize.page.test.tsx \
  tests/connected-agents.page.test.tsx \
  tests/cliauth.page.test.tsx
```

Expected: PASS and legacy CLI auth remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): authorize and manage Hermes connections"
```

---

### Task 7: Move Index macOS owner access into Keychain and native requests

**Files:**
- Create: `apps/mac/IndexApp/Sources/OwnerCredentialStore.swift`
- Create: `apps/mac/IndexApp/Sources/NativeAPIRequestBridge.swift`
- Create: `apps/mac/IndexApp/Tests/OwnerCredentialMigrationFixture.swift`
- Modify: `apps/mac/IndexApp/Sources/main.swift`
- Modify: `apps/mac/IndexApp/src/index-amiga/api.jsx`
- Modify: `apps/mac/IndexApp/src/index-amiga/app.jsx`
- Modify: `apps/mac/api/client.mjs`
- Create: `apps/mac/api/native-api-bridge.spec.mjs`
- Modify: `apps/mac/IndexApp/build.sh`
- Modify: `apps/mac/IndexApp/Info.plist`

**Interfaces:**
- Consumes: Task 1 `IndexKeychainStore` with the app-only descriptor.
- Produces: correlated `indexAPI` native bridge requests with exact method/path/body/event limits.
- Removes: `window.INDEX_NATIVE.apiKey` and JavaScript credential parameters.

- [ ] **Step 1: Write failing secret-absence and migration tests**

```javascript
expect(mainSwift).not.toContain('"apiKey": credential.key');
expect(apiSource).not.toMatch(/x-api-key|ownerCredential|INDEX_NATIVE\.apiKey/);
expect(mainSwift).toContain('revocation_pending');
expect(mainSwift).not.toContain('removeItem(at: applicationSupportDirectory)');
```

Native fixture cases: valid plaintext, malformed file, deletion failure, offline fresh-login requirement, legacy key-ID revocation, Keychain read-back failure.

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mac
bun test api/native-api-bridge.spec.mjs
```

Expected: FAIL because the key remains JavaScript-visible.

- [ ] **Step 3: Implement forced app relogin and app-only Keychain storage**

On startup, preserve only legacy key ID, delete and verify `credential.json`, remain signed out, and require browser login. Revoke the legacy key in the owner issuance transaction before storing and verifying the replacement Keychain item. Do not delete the parent Application Support directory.

- [ ] **Step 4: Implement native allowlisted HTTP/MCP/SSE bridge**

JavaScript sends opaque request IDs plus structured operations. Swift adds the owner header from Keychain and emits sanitized correlated responses/events. Reject arbitrary URLs, headers, methods, oversized bodies, and messages from non-bundled/non-main frames.

- [ ] **Step 5: Disable production inspection at the source boundary**

Set `developerExtrasEnabled` and `isInspectable` only when the compile-time `INDEX_DEVELOPMENT_BUILD` condition is true. Set `LSMinimumSystemVersion` to `13.0`.

- [ ] **Step 6: Run Mac source/native/app tests**

```bash
cd apps/mac
bun test api/native-api-bridge.spec.mjs api/client.spec.mjs IndexApp/hermes-runtime.spec.mjs
cd IndexApp
python3 assemble.py
./build.sh
```

Expected: PASS, with no raw credential in generated HTML.

- [ ] **Step 7: Commit**

```bash
git add apps/mac
git commit -m "fix(mac): keep owner credentials native"
```

---

### Task 8: Reconcile connector-backed runtime setup, logout, and recovery

**Files:**
- Modify: `apps/mac/IndexApp/Sources/HermesRuntime.swift`
- Modify: `apps/mac/api/agent-runtime.mjs`
- Modify: `apps/mac/api/agent-runtime-saga.mjs`
- Modify: `apps/mac/api/agent-runtime.spec.mjs`
- Modify: `apps/mac/api/agent-runtime-saga.spec.mjs`
- Modify: `apps/mac/IndexApp/hermes-runtime.spec.mjs`
- Modify: `apps/mac/IndexApp/Tests/HermesPersistenceCompatibility.swift`
- Modify: `packages/hermes-plugin/dashboard/dist/index.js`
- Regenerate: `packages/hermes-plugin/desktop/dist/plugin.js`
- Regenerate: `apps/mac/IndexApp/Resources/index.html`

**Interfaces:**
- Consumes: connector status/activation/disconnect from Tasks 4 and 5.
- Preserves: installation ID, setup generation, immutable cron ownership, owner fencing, local scrub, and fallback saga.
- Removes: Hermes credential from `configureDisabled` payload and `HermesEnvironmentFile.ownedKeys`.

- [ ] **Step 1: Write failing no-plaintext runtime assertions**

```javascript
expect(runtimeSwift).not.toContain('"INDEX_API_KEY"');
expect(runtimeSaga).not.toMatch(/credential:\s*prepared\.credential/);
expect(runtimeSaga).toContain('connectorActivationConfirmed');
expect(runtimeSaga).toContain('revocation_pending');
```

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/mac
bun test api/agent-runtime.spec.mjs api/agent-runtime-saga.spec.mjs IndexApp/hermes-runtime.spec.mjs
```

Expected: FAIL because #1348 still writes the executor key to `.env`.

- [ ] **Step 3: Replace credential configuration with connector confirmation**

Keep non-secret API/MCP URLs, agent/installation IDs, and plugin mode in `.env` only when both `INDEX_PLUGIN_DEVELOPMENT_TRANSPORT=1` and the non-production package marker are present. Production connector endpoints remain embedded and all six legacy owned keys are absent. Activation requires connector Keychain read-back plus `.env` absence before server select.

- [ ] **Step 4: Make logout/revocation recovery-only when uncertain**

Local cron/plugin activity pauses first. Pending server revocation retains the Keychain item and non-secret recovery journal; all connector operations except `status` and `disconnect` reject. Clear evidence only after server denial of the old credential and Keychain deletion both verify.

- [ ] **Step 5: Regenerate and run compatibility gates**

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/smoke.py
cd ../../apps/mac/IndexApp
python3 assemble.py
cd ..
bun test IndexApp/hermes-runtime.spec.mjs api/agent-runtime.spec.mjs api/agent-runtime-saga.spec.mjs
```

On macOS:

```bash
cd apps/mac/IndexApp
swiftc -parse-as-library Sources/HermesRuntime.swift Tests/HermesPersistenceCompatibility.swift \
  -o "$RUNNER_TEMP/hermes-persistence-compatibility"
"$RUNNER_TEMP/hermes-persistence-compatibility"
```

Expected: all historical non-secret state remains compatible; plaintext key expectations are replaced by secure-relogin expectations.

- [ ] **Step 6: Commit**

```bash
git add apps/mac packages/hermes-plugin/dashboard packages/hermes-plugin/desktop
git commit -m "fix(hermes): activate only secure runtime state"
```

---

### Task 9: Finish PR 1 documentation, versions, and whole-slice verification

**Files:**
- Modify: `packages/hermes-plugin/package.json`
- Modify: `packages/hermes-plugin/plugin.yaml`
- Modify: `packages/hermes-plugin/dashboard/manifest.json`
- Modify: `packages/hermes-plugin/CHANGELOG.md`
- Modify: `services/api/package.json`
- Modify: `services/api/CHANGELOG.md`
- Modify: `packages/protocol/package.json`
- Modify: `packages/protocol/CHANGELOG.md`
- Modify: `apps/mac/README.md`
- Modify: `packages/hermes-plugin/README.md`
- Modify: `docs/specs/api-reference.md`
- Modify: `docs/design/architecture-overview.md`
- Modify: `bun.lock`

**Interfaces:**
- Documents all contracts produced by Tasks 1-8.
- Produces synchronized Hermes package/manifest/dashboard versions and release notes.

- [ ] **Step 1: Add failing version/documentation inventory assertions**

Extend `packages/hermes-plugin/tests/smoke.py` to require package, plugin, and dashboard version equality and to reject production documentation that instructs users to persist `INDEX_API_KEY`.

- [ ] **Step 2: Update versions, changelogs, and API documentation**

Bump Hermes plugin `0.18.0` to `0.19.0`, API `0.78.0` to `0.79.0`, and protocol `10.1.0` to `10.2.0`; update the root lockfile. Record exact browser authorization, connector protocol, capabilities, expiry, migration, recovery, and app-optional behavior. Remove claims that current plaintext files or App Sandbox are production requirements.

- [ ] **Step 3: Run the targeted PR 1 verification matrix**

```bash
cd packages/hermes-plugin
python3 tests/connector_protocol.py
python3 tests/migration.py
python3 tests/smoke.py
python3 tests/gateway.py
bun run build:desktop

cd ../../packages/protocol
bun run build
bun run typecheck
bun test src/mcp/tests/mcp.authorization-policy.spec.ts

cd ../../services/api
bun run build
bun run typecheck
bun test src/controllers/tests/hermes-authorization.controller.spec.ts \
  src/guards/tests/hermes-agent-audience.spec.ts \
  src/guards/tests/hermes-negotiator-audience.spec.ts

cd ../../apps/mac
bun test api/native-api-bridge.spec.mjs api/agent-runtime.spec.mjs \
  api/agent-runtime-saga.spec.mjs IndexApp/hermes-runtime.spec.mjs
cd IndexApp
python3 assemble.py
./build.sh

cd ../../..
bun install --frozen-lockfile
git diff --check
git status --short
```

Expected: all targeted provider-free, generated-artifact, Swift build, typecheck, and frozen-lock checks pass. Database tests are reported separately with the exact disposable URL evidence.

- [ ] **Step 4: Run independent reviews**

Request security review of Keychain/PKCE/connector/route boundaries, correctness review of migration and revocation ordering, and integration review of full versus negotiator modes. Resolve every blocker/high/medium finding before publication.

- [ ] **Step 5: Commit**

```bash
git add packages services apps docs bun.lock
git commit -m "docs: finalize secure Hermes connection"
```
