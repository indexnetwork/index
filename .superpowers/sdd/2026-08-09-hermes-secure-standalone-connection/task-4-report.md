# Task 4 implementation report

## Status

Implemented and committed Task 4.

Commit: `7b7bf483f feat(mac): connect Hermes through Keychain`

The working tree is clean and `git diff --cached --name-only` produced no output.

## Summary

- Added a serialized JSON-lines connector runtime with exact `hello`, `status`, `authorize.start`, `authorize.poll`, `rest`, `mcp`, and `disconnect` operations.
- Added in-process asynchronous browser authorization state, SecRandom-generated PKCE/state, an exact `127.0.0.1` high-ephemeral callback listener, strict host/path/query/state validation, and one successful callback consumption.
- Added a Keychain-only Codable credential record. The signed connector access group is resolved from the process entitlement; credential bytes never enter connector responses, argv, runtime environment, installation JSON, browser authorization URLs, or logs.
- Added a stable non-secret installation UUID/revocation journal in `~/Library/Application Support/network.index.connector/` with symlink checks, atomic writes, and restrictive modes.
- Added embedded production endpoints and compile-time-only development endpoints behind exact `-DINDEX_CONNECTOR_NONPRODUCTION`. Runtime JSON/argv/environment cannot override endpoints. `hello` reports labels, never URLs.
- Added an exact REST method/path policy, exact 31-tool MCP policy, fixed headers, redirect refusal, 30-second timeouts, 8 MiB uploads, streaming 1 MiB response enforcement, and stable sanitized errors.
- Added recovery-only disconnect. Keychain deletion requires an exact transactional receipt matching local credential/generation IDs; active unexpired credentials additionally require a 401 post-revocation probe. Network/receipt/deletion uncertainty retains the key and recovery journal for retry.
- Added narrow, idempotent `POST /hermes-authorizations/disconnect`. It resolves only the exact dedicated hash for self-revocation, including expired/already-revoked rows, returns a stable identity receipt, removes authority only when the row is still the current generation, and does not disturb newer generations.
- Added native authorization/transport fixtures and CI wiring. No Python plugin transport or UI was implemented.

## Changed files

- `.github/workflows/mac-app-build.yml`
- `apps/mac/IndexConnector/Sources/BrowserAuthorization.swift`
- `apps/mac/IndexConnector/Sources/ConnectorCredentialStore.swift`
- `apps/mac/IndexConnector/Sources/ConnectorHTTPClient.swift`
- `apps/mac/IndexConnector/Sources/ConnectorIdentity.swift`
- `apps/mac/IndexConnector/Sources/ConnectorInstallationStore.swift`
- `apps/mac/IndexConnector/Sources/ConnectorProtocol.swift`
- `apps/mac/IndexConnector/Sources/ConnectorRuntime.swift`
- `apps/mac/IndexConnector/Sources/main.swift`
- `apps/mac/IndexConnector/Tests/AuthorizationFixture.swift`
- `apps/mac/IndexConnector/Tests/TransportFixture.swift`
- `apps/mac/IndexConnector/build.sh`
- `apps/mac/IndexConnector/connector-contract.spec.mjs`
- `services/api/src/adapters/hermes-authorization.database.adapter.ts`
- `services/api/src/controllers/hermes-authorization.controller.ts`
- `services/api/src/controllers/tests/hermes-authorization.controller.spec.ts`
- `services/api/src/guards/auth.guard.ts`
- `services/api/src/guards/tests/hermes-agent-audience.spec.ts`
- `services/api/src/lib/agent/hermes-authorization.ts`
- `services/api/src/services/hermes-authorization.service.ts`

## TDD evidence

### RED — connector source contracts

Command:

```bash
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

Observed before implementation:

```text
6 pass
4 fail
78 expect() calls
```

Failures named missing native fixture CI entries and missing `ConnectorIdentity.swift`, `BrowserAuthorization.swift`, and `AuthorizationFixture.swift`.

### RED — self-revocation API

Command:

```bash
cd services/api
bun test src/controllers/tests/hermes-authorization.controller.spec.ts \
  src/guards/tests/hermes-agent-audience.spec.ts
```

Observed before implementation:

```text
35 pass
2 fail
117 expect() calls
```

The expected failures were `controller.disconnect is not a function` and denial of `POST /api/hermes-authorizations/disconnect`.

## GREEN evidence

### Provider-free connector contracts (final post-commit)

```bash
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

```text
10 pass
0 fail
116 expect() calls
Ran 10 tests across 1 file.
```

### Authorization and active-audience API contracts (final post-commit)

```bash
cd services/api
bun test src/controllers/tests/hermes-authorization.controller.spec.ts \
  src/guards/tests/hermes-agent-audience.spec.ts
```

```text
39 pass
0 fail
245 expect() calls
Ran 39 tests across 2 files.
```

This covers strict disconnect bodies, pending/active/expired self-revocation, stable retry receipts, and exact REST admission in addition to the existing authorization/audience matrix.

### API build/typecheck

```bash
cd services/api
bun run build
```

```text
$ bun run --cwd ../../packages/protocol build && tsc
$ rm -rf dist && tsc
```

Exit status `0`.

`cd services/api && bunx tsc --noEmit` also exited `0` with no diagnostics.

### Targeted lint

```bash
cd services/api
bunx eslint <all seven affected TypeScript files>
```

No output; exit status `0`.

### Shell/static checks

```bash
bash -n apps/mac/IndexConnector/build.sh
git diff HEAD^..HEAD --check
```

Both exited `0` with no output.

### Native Apple fixture availability

Commands attempted:

```bash
cd apps/mac/IndexConnector
./build.sh --fixture AuthorizationFixture
./build.sh --fixture TransportFixture
```

Both failed before compilation with the honest environment limitation:

```text
./build.sh: line 60: swiftc: command not found
```

The host is Linux. No native fixture PASS or Apple-framework evidence is claimed. The updated macOS CI compiles/runs both fixtures and assembles the connector app.

### Commit hook

`git commit` ran lint-staged ESLint and adapter naming checks successfully and created `7b7bf483f`.

## Self-review

- Scope remains native connector plus the narrowly required server self-disconnect seam; no plugin or UI files changed.
- Production endpoint constants are exact and no runtime endpoint source exists. Development constants are generated only by the explicit non-production build path and compile flag.
- Authorization request fields match Task 2 exactly; the callback carries only state/code and never a credential/verifier.
- Keychain write/read verification happens before activation. Injected write failure omits activation.
- Connector status and polling return only sanitized metadata.
- URL redirects are refused so a credential cannot be forwarded to another origin.
- General REST does not expose authorization internals; self-disconnect remains a structured connector operation with receipt and recovery semantics.
- The server disconnect transaction is idempotent. Already-revoked rows return the same receipt; old-generation rows revoke only themselves; current rows select Index and remove current generation authority.
- No blocker was found in the committed diff.

## Concerns / residual risk

- Native Swift compilation and runtime fixtures remain unverified locally because this Linux host has no `swiftc` or Apple frameworks. macOS CI is the required evidence gate.
- The new Drizzle self-disconnect transaction was typechecked and covered through provider-free service/controller fixtures, but was not executed against PostgreSQL because no proven disposable database was supplied. It should be exercised in the guarded database environment.
- The connector app assembled by this task is not claimed as signed/notarized release evidence; protected release signing remains later-plan scope.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Commit 7b7bf483f implements the bounded native connector, browser/Keychain flow, exact connector operations, native fixtures/CI, and only the required self-disconnect API prerequisite; no Python plugin transport or UI was added."
    }
  ],
  "changedFiles": [
    ".github/workflows/mac-app-build.yml",
    "apps/mac/IndexConnector/Sources/BrowserAuthorization.swift",
    "apps/mac/IndexConnector/Sources/ConnectorCredentialStore.swift",
    "apps/mac/IndexConnector/Sources/ConnectorHTTPClient.swift",
    "apps/mac/IndexConnector/Sources/ConnectorIdentity.swift",
    "apps/mac/IndexConnector/Sources/ConnectorInstallationStore.swift",
    "apps/mac/IndexConnector/Sources/ConnectorProtocol.swift",
    "apps/mac/IndexConnector/Sources/ConnectorRuntime.swift",
    "apps/mac/IndexConnector/Sources/main.swift",
    "apps/mac/IndexConnector/Tests/AuthorizationFixture.swift",
    "apps/mac/IndexConnector/Tests/TransportFixture.swift",
    "apps/mac/IndexConnector/build.sh",
    "apps/mac/IndexConnector/connector-contract.spec.mjs",
    "services/api/src/adapters/hermes-authorization.database.adapter.ts",
    "services/api/src/controllers/hermes-authorization.controller.ts",
    "services/api/src/controllers/tests/hermes-authorization.controller.spec.ts",
    "services/api/src/guards/auth.guard.ts",
    "services/api/src/guards/tests/hermes-agent-audience.spec.ts",
    "services/api/src/lib/agent/hermes-authorization.ts",
    "services/api/src/services/hermes-authorization.service.ts"
  ],
  "testsAddedOrUpdated": [
    "apps/mac/IndexConnector/Tests/AuthorizationFixture.swift",
    "apps/mac/IndexConnector/Tests/TransportFixture.swift",
    "apps/mac/IndexConnector/connector-contract.spec.mjs",
    "services/api/src/controllers/tests/hermes-authorization.controller.spec.ts",
    "services/api/src/guards/tests/hermes-agent-audience.spec.ts"
  ],
  "commandsRun": [
    {
      "command": "bun test apps/mac/IndexConnector/connector-contract.spec.mjs (RED)",
      "result": "failed",
      "summary": "Expected RED: 6 pass, 4 fail, 78 expectations; native connector files/CI entries were absent."
    },
    {
      "command": "cd services/api && bun test src/controllers/tests/hermes-authorization.controller.spec.ts src/guards/tests/hermes-agent-audience.spec.ts (RED)",
      "result": "failed",
      "summary": "Expected RED: 35 pass, 2 fail; disconnect handler and route admission were absent."
    },
    {
      "command": "bun test apps/mac/IndexConnector/connector-contract.spec.mjs",
      "result": "passed",
      "summary": "Final post-commit: 10 pass, 0 fail, 116 expectations."
    },
    {
      "command": "cd services/api && bun test src/controllers/tests/hermes-authorization.controller.spec.ts src/guards/tests/hermes-agent-audience.spec.ts",
      "result": "passed",
      "summary": "Final post-commit: 39 pass, 0 fail, 245 expectations."
    },
    {
      "command": "cd services/api && bun run build",
      "result": "passed",
      "summary": "Protocol build plus API TypeScript build passed."
    },
    {
      "command": "cd services/api && bunx tsc --noEmit",
      "result": "passed",
      "summary": "No TypeScript diagnostics."
    },
    {
      "command": "cd services/api && bunx eslint <affected TypeScript files>",
      "result": "passed",
      "summary": "No lint diagnostics."
    },
    {
      "command": "bash -n apps/mac/IndexConnector/build.sh && git diff HEAD^..HEAD --check",
      "result": "passed",
      "summary": "Shell syntax and committed diff whitespace checks passed."
    },
    {
      "command": "cd apps/mac/IndexConnector && ./build.sh --fixture AuthorizationFixture",
      "result": "failed",
      "summary": "Environment limitation: swiftc command not found on Linux; no Apple evidence claimed."
    },
    {
      "command": "cd apps/mac/IndexConnector && ./build.sh --fixture TransportFixture",
      "result": "failed",
      "summary": "Environment limitation: swiftc command not found on Linux; no Apple evidence claimed."
    },
    {
      "command": "git commit -m 'feat(mac): connect Hermes through Keychain'",
      "result": "passed",
      "summary": "Created 7b7bf483f; lint-staged and adapter naming checks passed."
    }
  ],
  "validationOutput": [
    "Provider-free connector contracts: 10 pass, 0 fail, 116 expectations.",
    "Authorization/audience contracts: 39 pass, 0 fail, 245 expectations.",
    "API build/typecheck and targeted ESLint exited 0.",
    "Shell syntax and diff checks exited 0.",
    "Native Apple fixtures were not runnable: swiftc is absent on this Linux host.",
    "Final git status is clean; no staged files."
  ],
  "residualRisks": [
    "Native Swift compilation and fixtures require the configured macOS CI runner; no local Apple PASS is claimed.",
    "The self-disconnect Drizzle transaction still requires execution against a migrated, proven disposable PostgreSQL database with TEST_DATABASE_SAFE=1."
  ],
  "noStagedFiles": true,
  "diffSummary": "20 files changed: production connector runtime/browser/HTTP/Keychain/identity/persistence, two native fixtures, production/non-production build paths and macOS CI, exact dotted protocol operation names, and the narrow idempotent self-disconnect server seam.",
  "reviewFindings": [
    "no blockers",
    "native Apple compile evidence unavailable locally and delegated to macOS CI",
    "guarded PostgreSQL execution remains outstanding"
  ],
  "manualNotes": "Authoritative report path is this artifact. Commit: 7b7bf483f."
}
```

---

## Fix round 1/5 — URL-free authorization responses and staged recovery

### Status

Resolved all round-1 Critical/Important findings without changing the plugin, UI, or unrelated server behavior.

### Changes

- `authorize.start` now opens the browser internally and returns exactly `{status:"pending"}`. No authorization/setup URL, request ID, state, or redirect URI crosses the connector response boundary.
- Added encoded-response assertions both at the protocol encoder boundary and through the real `ConnectorRuntime.authorize.start` path.
- Replaced the Boolean revocation flag with exact durable phases: `activation_requested`, `revocation_requested`, `server_receipt_confirmed`, and `revocation_probe_confirmed`.
- The Keychain credential record is authoritative and the Application Support journal mirrors only non-secret phase state. Existing Boolean journals and pre-phase Keychain records decode conservatively.
- Added a shared current-process fail-closed latch. Recovery begins in memory before any persistence or server mutation; REST/MCP deny when the process latch, Keychain record, pending activation, or journal indicates uncertainty.
- Disconnect now persists Keychain+journal recovery before the server call, retains the key on server/receipt/probe/persistence uncertainty, resumes idempotently from confirmed phases, and deletes only after exact receipt plus the required active/unexpired 401 probe.
- If Keychain deletion succeeds and journal cleanup fails, the confirmed journal plus no-key state retries cleanup and converges to disconnected.
- Activation now persists `activation_requested` before `/activate`. A confirmed activation is immediately persisted as active before optional `/auth/me`; account-label failure or label-update failure cannot regress active authority. Ambiguous activation and active-record write failure retain the pending credential in recovery-only state for self-disconnect.
- `authorize.start` refuses every existing credential and every activation/revocation recovery state.
- Native fixtures now inject first recovery persistence failure/current-process denial, activation connection uncertainty, account-label failure, active-record write failure, receipt mismatch, active-probe failure, server uncertainty/key retention, Keychain deletion failure, and journal-clear failure/no-key convergence.

### RED evidence

Command:

```bash
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

Observed before the fix:

```text
9 pass
2 fail
118 expect() calls
```

The expected failures showed that `ConnectorRuntime` still emitted `authorizationUrl` and that the required staged fault-injection fixture cases were absent.

### GREEN evidence

Provider-free/source connector contracts:

```bash
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

```text
11 pass
0 fail
133 expect() calls
Ran 11 tests across 1 file.
```

Focused authorization/audience API contracts (unchanged server prerequisite remains green):

```bash
cd services/api
bun test src/controllers/tests/hermes-authorization.controller.spec.ts \
  src/guards/tests/hermes-agent-audience.spec.ts
```

```text
39 pass
0 fail
245 expect() calls
Ran 39 tests across 2 files.
```

API/protocol build and typecheck:

```bash
cd services/api
bun run build
bunx tsc --noEmit
```

```text
$ bun run --cwd ../../packages/protocol build && tsc
$ rm -rf dist && tsc
```

Both exited `0`; the standalone typecheck emitted no diagnostics.

Shell/static checks:

```bash
bash -n apps/mac/IndexConnector/build.sh
git diff --check
```

Both exited `0` with no output.

Native fixture attempts:

```bash
cd apps/mac/IndexConnector
./build.sh --fixture AuthorizationFixture
./build.sh --fixture TransportFixture
```

This Linux host still cannot supply Apple evidence; both stopped before compilation with:

```text
./build.sh: line 60: swiftc: command not found
```

No native PASS is claimed. The macOS CI workflow remains the evidence gate for Swift/Foundation/Security/AppKit execution.

### Files changed in round 1

- `apps/mac/IndexConnector/Sources/BrowserAuthorization.swift`
- `apps/mac/IndexConnector/Sources/ConnectorCredentialStore.swift`
- `apps/mac/IndexConnector/Sources/ConnectorInstallationStore.swift`
- `apps/mac/IndexConnector/Sources/ConnectorRuntime.swift`
- `apps/mac/IndexConnector/Tests/AuthorizationFixture.swift`
- `apps/mac/IndexConnector/Tests/ConnectorProtocolFixture.swift`
- `apps/mac/IndexConnector/Tests/TransportFixture.swift`
- `apps/mac/IndexConnector/connector-contract.spec.mjs`
- `.superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/task-4-report.md`

### Round-1 self-review

- Browser/setup details are used only inside `BrowserAuthorization`; encoded connector results expose only pending/sanitized status.
- No server mutation occurs unless both initial Keychain and journal recovery writes succeed. A first persistence failure still latches the current process closed.
- Keychain and journal disagreement fails closed and is reconciled before the next transition.
- Exact receipt identity is checked before recording server confirmation. Active/unexpired credentials require the separate 401 probe before deletion.
- Confirmed receipt/probe phases are durable before deletion. A missing key is accepted only with a server-confirmed journal phase, allowing cleanup convergence without weakening pre-confirmation recovery.
- Activation uncertainty always retains a pending credential when issuance reached Keychain. Confirmed active state is persisted before optional account metadata.
- No blocker found in the round-1 diff.

### Round-1 residual risks

- Native Swift compilation and all new fault-injection fixtures remain unexecuted locally because `swiftc` and Apple frameworks are unavailable. macOS CI must pass before acceptance.
- No PostgreSQL behavior changed in this round. The existing Task 4 self-disconnect Drizzle transaction still awaits the previously documented guarded disposable-PostgreSQL execution.
- Independent reviewer gate remains required.

---

## Fix round 2/5 — serialized authorization ownership and epoch fencing

### Status

Resolved the asynchronous authorization/disconnect blocker. `ConnectorRuntime` is now the sole owner of exchange, credential persistence, activation, recovery transitions, account-label persistence, and disconnect. `BrowserAuthorization` only owns the loopback listener and publishes one callback code tagged by the exact authorization-attempt UUID.

### Changes

- `authorize.start` creates and durably journals a fresh attempt UUID plus operation epoch before opening the browser. The URL-private response remains exactly `{status:"pending"}`.
- The browser component now only prepares PKCE/listener state, opens the browser, validates one callback, and publishes `BrowserAuthorizationCallback { attemptId, code }`. It has no HTTP exchange/activation or Keychain/journal dependencies.
- `authorize.poll` consumes the exact tagged callback and drives create/exchange, pending credential CAS, `activation_requested` CAS, activation, active credential CAS, optional account label, and exact attempt cleanup.
- Credential records and the non-secret installation journal now carry exact attempt ownership and operation epochs. Live stores expose compare-and-set operations; runtime transitions run under a dedicated transition lock and recheck attempt/epoch ownership around network and persistence boundaries.
- `disconnect` invalidates/cancels the attempt, advances the epoch, and persists that invalidation before considering no-record/no-journal convergence.
- Stale callback/poll/activation work cannot clear or overwrite revocation state. A stale issued credential is retained in recovery when no newer credential exists. Late activation responses never write active/label state after epoch invalidation.
- Confirmed no-key cleanup remains recovery-only while a credential-affecting authorization network request is in flight. This prevents a new authorization from starting until the stale request resolves; confirmed revocation then converges through a final disconnect cleanup.
- REST/MCP admission checks the in-memory recovery latch, current/in-flight attempts, exact Keychain phase/activation state, and exact journal phase/attempt.
- Added deterministic native concurrency fixtures for disconnect-before-callback, callback-before-disconnect-before-poll, blocked activation followed by disconnect and late response, stale-poll revocation preservation, and authorization restart denial during stale/recovery state.
- Added actual phase-targeted journal failures at `activation_requested`, initial `revocation_requested`, `server_receipt_confirmed`, and `revocation_probe_confirmed`, plus active/label Keychain write faults and the prior receipt/probe/deletion/cleanup faults.

### RED evidence

Command:

```bash
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

Observed after adding the round-2 ownership/concurrency/fault contract but before completing the missing fixture cases:

```text
11 pass
1 fail
124 expect() calls
Ran 12 tests across 1 file.
```

The failing contract identified missing concrete recovery/concurrency fixture evidence, including the initial Keychain-before-activation marker and phase-specific journal failures.

### GREEN evidence

Provider-free/source connector contracts:

```bash
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
```

```text
12 pass
0 fail
148 expect() calls
Ran 12 tests across 1 file.
```

Focused authorization/audience API contracts:

```bash
cd services/api
bun test src/controllers/tests/hermes-authorization.controller.spec.ts \
  src/guards/tests/hermes-agent-audience.spec.ts
```

```text
39 pass
0 fail
245 expect() calls
Ran 39 tests across 2 files.
```

API/protocol build and typecheck:

```bash
cd services/api
bun run build
```

```text
$ bun run --cwd ../../packages/protocol build && tsc
$ rm -rf dist && tsc
```

Exit status `0`.

Shell/static checks:

```bash
bash -n apps/mac/IndexConnector/build.sh
git diff --check
```

Both exited `0` with no output.

Native fixture attempts:

```bash
cd apps/mac/IndexConnector
./build.sh --fixture AuthorizationFixture
./build.sh --fixture TransportFixture
```

Both stopped before compilation on this Linux host:

```text
./build.sh: line 60: swiftc: command not found
```

No native concurrency/fault PASS is claimed. The configured macOS CI job remains the required Apple-framework compile/execution gate.

### Files changed in round 2

- `apps/mac/IndexConnector/Sources/BrowserAuthorization.swift`
- `apps/mac/IndexConnector/Sources/ConnectorCredentialStore.swift`
- `apps/mac/IndexConnector/Sources/ConnectorInstallationStore.swift`
- `apps/mac/IndexConnector/Sources/ConnectorRuntime.swift`
- `apps/mac/IndexConnector/Tests/AuthorizationFixture.swift`
- `apps/mac/IndexConnector/Tests/TransportFixture.swift`
- `apps/mac/IndexConnector/connector-contract.spec.mjs`
- `.superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/task-4-report.md`

### Round-2 self-review

- Browser code has no credential-store, exchange, activation, journal, or recovery transition dependency.
- Attempt UUID and operation epoch are persisted before browser/network work and never emitted.
- Disconnect invalidates memory/listener and advances/persists epoch before local convergence.
- Authorization and disconnect transitions use exact expected-record and expected-journal CAS values. Transition-lock ordering ensures a disconnect stage follows and supersedes any write that began just before invalidation.
- Authorization cleanup is restricted to its exact attempt/epoch and cannot clear a revocation phase.
- Blocked activation concurrency retains revocation confirmation/no-key recovery until the in-flight activation returns; the stale result performs no active or label write, restart remains denied, and cleanup then converges.
- Phase-targeted fault fixtures assert no server call before initial recovery durability, key retention on pre-confirmation uncertainty, exact confirmed phases on later faults, and no-key convergence only after server confirmation.
- URL-private authorization output and all server request/response contracts remain unchanged.
- No blocker found in the round-2 source diff by self-review.

### Round-2 residual risks

- Swift compiler and Apple frameworks are absent locally, so the substantial native refactor and deterministic concurrency fixtures require macOS CI evidence before acceptance.
- The existing guarded PostgreSQL residual for the Task 4 self-disconnect transaction is unchanged; no server/database code changed in this round.
- Independent reviewer gate remains required.
