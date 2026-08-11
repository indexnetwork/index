# Hermes Suspended Connector Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unsupported macOS `/dev/fd/N` connector launch with a fail-closed suspended spawn that dynamically attests the actual loaded child before it can run user code or receive request bytes.

**Architecture:** Keep the existing statically verified random staging bundle and one-shot stdin/stdout protocol. Capture the statically verified connector's architecture-aware CDHash set, spawn its ordinary executable pathname with `POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_START_SUSPENDED`, derive the loaded child's dynamic `SecCode` from its PID, require the exact pinned requirement/Team ID/bundle ID and one allowed CDHash, then resume and begin bounded I/O. An authenticated XPC/`SMAppService` redesign remains outside this PR.

**Tech Stack:** Swift 5, Darwin `posix_spawn`, Security.framework code-signing APIs, Foundation, Bun source-contract tests, GitHub Actions `macos-latest`.

## Global Constraints

- Minimum production target remains macOS 13; the release artifact remains Universal 2.
- Production Team ID is exactly `LMQ3XNXLAD`; bundle ID is exactly `network.index.connector`; the locally compiled designated requirement remains authoritative.
- CMS-provided Team ID, bundle ID, or designated requirement values never override local immutable pins.
- The architecture-selected dynamic `kSecCodeInfoUnique` CDHash must belong to the statically verified `kSecCodeInfoCdHashes` set.
- No request byte may be written before dynamic child attestation succeeds and `SIGCONT` is sent.
- Every spawn, attestation, resume, timeout, or I/O failure must kill and reap any live child, close pipes, and return a stable sanitized failure.
- `POSIX_SPAWN_CLOEXEC_DEFAULT` is mandatory; unrelated host descriptors must not enter the connector.
- Remove all executable `/dev/fd/N`, `O_EXEC`, and `posix_spawn_file_actions_addinherit_np` assumptions from production and native fixtures.
- No credential, authorization code, PKCE verifier, request body, or response body may enter argv, environment, callback URLs, logs, or test output.
- Linux cannot validate Security.framework behavior. Provider-free source contracts run locally; native compile/runtime acceptance runs on macOS CI.
- Do not weaken or remove the existing CMS, SHA-256, static signature, all-architecture, nested-code, file-identity, timeout, response-bound, or environment-allowlist checks.
- PR publication is authorized; merge, deployment, production signing, notarization, and public release are not.

---

## File Structure

- Create `apps/mac/IndexApp/Sources/ConnectorLaunchAttestation.swift`: one focused Security.framework boundary for extracting the verified static launch identity and attesting a suspended dynamic child.
- Create `apps/mac/IndexApp/Tests/ConnectorLaunchAttestationFixture.swift`: native positive, replacement, CLOEXEC, and kill/reap fixtures against the shared production attestor.
- Modify `apps/mac/IndexApp/Sources/HermesRuntime.swift`: return static launch identity from existing bundle verification and replace descriptor execution with suspended pathname spawn plus attestation-before-I/O.
- Modify `apps/mac/IndexApp/Tests/HermesPersistenceCompatibility.swift`: remove the unsupported reimplementation of `/dev/fd/N` execution; retain historical persistence coverage only.
- Modify `apps/mac/IndexApp/hermes-runtime.spec.mjs`: reject descriptor-exec regressions and require the suspended-attestation production sequence.
- Modify `apps/mac/IndexApp/build.sh`: compile the new source into the app and expose a dedicated native fixture entry point.
- Modify `.github/workflows/mac-app-build.yml`: run the dedicated native launch-attestation fixture before historical persistence compatibility.

---

### Task 1: Security.framework launch identity and native fixture

**Files:**
- Create: `apps/mac/IndexApp/Sources/ConnectorLaunchAttestation.swift`
- Create: `apps/mac/IndexApp/Tests/ConnectorLaunchAttestationFixture.swift`
- Modify: `apps/mac/IndexApp/build.sh`
- Modify: `.github/workflows/mac-app-build.yml`

**Interfaces:**
- Consumes: a `SecStaticCode` that has already passed the existing exact designated-requirement and all-architecture static validity checks.
- Produces: `HermesConnectorLaunchIdentity`, `HermesConnectorCodeAttestor.captureExpectedIdentity(staticCode:expectedTeamID:expectedBundleID:)`, and `HermesConnectorCodeAttestor.attestSuspendedChild(pid:expected:requirement:)`.
- `HermesConnectorLaunchIdentity` fields are `teamIdentifier: String`, `bundleIdentifier: String`, and `allowedCDHashes: Set<Data>`.
- Both attestor methods throw `HermesConnectorAttestationError.invalidIdentity`; callers map it to an existing sanitized runtime failure.

- [ ] **Step 1: Add the dedicated fixture command and write the failing native fixture**

Add this branch near the other `--fixture` branches in `apps/mac/IndexApp/build.sh`:

```bash
if [ "${1:-}" = "--fixture" ] && [ "${2:-}" = "ConnectorLaunchAttestationFixture" ] && [ "$#" -eq 2 ]; then
    OUT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/connector-launch-attestation-fixture"
    swiftc -parse-as-library -framework Foundation -framework Security \
        Sources/ConnectorLaunchAttestation.swift \
        Tests/ConnectorLaunchAttestationFixture.swift \
        -o "$OUT"
    "$OUT"
    exit 0
fi
```

Update the usage string to include `ConnectorLaunchAttestationFixture`. Create a native fixture with these exact cases:

```swift
@main
struct ConnectorLaunchAttestationFixture {
    static func main() throws {
        try positiveSuspendedAttestation()
        try replacementIsKilledBeforeResume()
        try closeOnExecDefaultRejectsUnrelatedDescriptor()
        print("macOS suspended connector launch attestation passed")
    }
}
```

The fixture must use a local `signingLabels(at:)` helper built directly on `SecStaticCodeCreateWithPath` plus `SecCodeCopySigningInformation` to obtain each Apple fixture binary's actual Team ID and signing identifier, then pass those exact labels into `captureExpectedIdentity`. Production never uses this discovery helper; it passes the immutable `LMQ3XNXLAD` and `network.index.connector` pins.

The fixture must:

1. copy `/bin/echo` to a private `0700` candidate, capture its static identity, spawn that path suspended, dynamically attest it, `SIGCONT`, and assert the child writes exactly `"\n"`;
2. capture the static identity of a copied `/usr/bin/false`, atomically replace its candidate path with copied `/bin/echo`, spawn suspended, assert attestation throws, kill/reap without `SIGCONT`, and assert the output pipe remains empty;
3. open an unrelated parent descriptor, spawn copied `/bin/sh` suspended with `POSIX_SPAWN_CLOEXEC_DEFAULT`, attest/resume it with `-c "test ! -e /dev/fd/\(unrelatedFD)"`, and require exit status zero;
4. use a helper that loops around `waitpid` only for `EINTR`, and fails if kill/reap does not converge.

- [ ] **Step 2: Run the new fixture to prove it fails before the attestor exists**

Run on macOS:

```bash
cd apps/mac/IndexApp
./build.sh --fixture ConnectorLaunchAttestationFixture
```

Expected: compile failure because `HermesConnectorCodeAttestor` and `HermesConnectorLaunchIdentity` do not exist.

On Linux, run the available shell check instead and record the native gate as macOS-only:

```bash
bash -n apps/mac/IndexApp/build.sh
```

Expected: PASS.

- [ ] **Step 3: Implement the minimal shared static/dynamic attestor**

Create `apps/mac/IndexApp/Sources/ConnectorLaunchAttestation.swift` with these exact public-in-module shapes:

```swift
import Foundation
import Security

struct HermesConnectorLaunchIdentity: Equatable {
    let teamIdentifier: String
    let bundleIdentifier: String
    let allowedCDHashes: Set<Data>
}

enum HermesConnectorAttestationError: Error {
    case invalidIdentity
}

enum HermesConnectorCodeAttestor {
    static func captureExpectedIdentity(
        staticCode: SecStaticCode,
        expectedTeamID: String,
        expectedBundleID: String
    ) throws -> HermesConnectorLaunchIdentity

    static func attestSuspendedChild(
        pid: pid_t,
        expected: HermesConnectorLaunchIdentity,
        requirement: SecRequirement
    ) throws
}
```

`captureExpectedIdentity` must call `SecCodeCopySigningInformation` with `kSecCSSigningInformation`, require exact Team ID and bundle ID, require `kSecCodeInfoCdHashes` to be a non-empty array of non-empty `Data`, and return a deduplicated `Set<Data>`.

`attestSuspendedChild` must:

```swift
let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
var dynamicCode: SecCode?
guard SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &dynamicCode) == errSecSuccess,
      let dynamicCode,
      SecCodeCheckValidity(
          dynamicCode,
          SecCSFlags(rawValue: kSecCSStrictValidate),
          requirement
      ) == errSecSuccess else {
    throw HermesConnectorAttestationError.invalidIdentity
}
```

Then copy dynamic signing information, require exact Team ID and bundle ID, require non-empty `kSecCodeInfoUnique as? Data`, and require `expected.allowedCDHashes.contains(loadedCDHash)`. Do not accept CMS values, requirement text, or hashes from the child.

- [ ] **Step 4: Run the dedicated macOS fixture and source checks**

Run on macOS:

```bash
cd apps/mac/IndexApp
./build.sh --fixture ConnectorLaunchAttestationFixture
```

Expected: `macOS suspended connector launch attestation passed`.

Run everywhere:

```bash
bash -n apps/mac/IndexApp/build.sh
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Add the fixture to macOS CI and dispatch it**

Add this step before historical persistence compatibility in `.github/workflows/mac-app-build.yml`:

```yaml
      - name: Native suspended connector launch attestation
        working-directory: apps/mac/IndexApp
        run: ./build.sh --fixture ConnectorLaunchAttestationFixture
```

Dispatch the branch workflow:

```bash
run_url="$(gh workflow run "Build macOS app" --ref feat/hermes-secure-standalone-connect)"
run_id="${run_url##*/}"
gh run watch "$run_id" --exit-status
```

Expected: the new fixture passes. Existing historical compatibility may still fail until Task 2 removes the unsupported fixture; record that as the expected remaining red gate rather than weakening it in this task.

- [ ] **Step 6: Commit the focused attestor and native fixture**

```bash
git add \
  apps/mac/IndexApp/Sources/ConnectorLaunchAttestation.swift \
  apps/mac/IndexApp/Tests/ConnectorLaunchAttestationFixture.swift \
  apps/mac/IndexApp/build.sh \
  .github/workflows/mac-app-build.yml
git commit -m "test(mac): prove suspended connector attestation"
```

---

### Task 2: Wire suspended attestation into the production connector launch

**Files:**
- Modify: `apps/mac/IndexApp/Sources/HermesRuntime.swift`
- Modify: `apps/mac/IndexApp/Tests/HermesPersistenceCompatibility.swift`
- Modify: `apps/mac/IndexApp/hermes-runtime.spec.mjs`
- Modify: `apps/mac/IndexApp/build.sh`
- Modify: `.github/workflows/mac-app-build.yml`

**Interfaces:**
- Consumes: Task 1's `HermesConnectorLaunchIdentity` and `HermesConnectorCodeAttestor`.
- Produces: production `launch(executable:expectedIdentity:requirement:requests:)` that spawns by ordinary staged pathname, starts suspended, attests, resumes, and only then starts the existing bounded stdin/stdout work.
- `verifyStagedBundle` returns `(identity: HermesConnectorLaunchIdentity, requirement: SecRequirement)` after all existing CMS, SHA-256, requirement, all-architecture, nested-code, and file-identity checks pass.

- [ ] **Step 1: Change the Linux source contract first and verify red**

In `apps/mac/IndexApp/hermes-runtime.spec.mjs`, replace the descriptor-launch expectations with:

```javascript
for (const token of [
  'POSIX_SPAWN_START_SUSPENDED',
  'HermesConnectorCodeAttestor.attestSuspendedChild',
  'SecCodeCopyGuestWithAttributes',
  'kSecCodeInfoUnique',
  'Darwin.kill(child, SIGCONT)',
]) expect(runtime + launchAttestation).toContain(token);

for (const forbidden of [
  'posix_spawn_file_actions_addinherit_np',
  'O_EXEC | O_NOFOLLOW',
  'let descriptorPath = "/dev/fd/',
]) expect(runtime).not.toContain(forbidden);
```

Read `ConnectorLaunchAttestation.swift` into a `launchAttestation` test constant. Rename the historical fixture expectation from `descriptorBoundExecutionFixture` to the dedicated fixture filename and require the persistence fixture not to contain `/dev/fd/` or `posix_spawn`.

Run:

```bash
bun test apps/mac/IndexApp/hermes-runtime.spec.mjs --test-name-pattern "verified credential-free connector"
```

Expected: FAIL because production still uses descriptor execution and does not use suspended attestation.

- [ ] **Step 2: Restore the regular-file capability to readable verification only**

In `HermesRuntime.swift`, remove the `O_EXEC` descriptor and dual-descriptor state introduced by the failed `/dev/fd` experiment. `HermesRegularFileDescriptor` must retain one `O_RDONLY | O_NOFOLLOW` descriptor for exact snapshot/hash/identity checks only:

```swift
private final class HermesRegularFileDescriptor {
    let rawValue: Int32
    init(rawValue: Int32) { self.rawValue = rawValue }
    deinit { _ = Darwin.close(rawValue) }
}
```

Keep the existing before/opened/after `fstatat` and `fstat` identity equality. Do not use `rawValue` as an executable path.

- [ ] **Step 3: Return the exact static launch identity from bundle verification**

Change `verifyStagedBundle` to return:

```swift
private func verifyStagedBundle(
    _ bundle: URL,
    executable: URL,
    cms: URL,
    executableSnapshot: HermesFileSnapshot
) throws -> (identity: HermesConnectorLaunchIdentity, requirement: SecRequirement)
```

After the existing `SecStaticCodeCheckValidity` succeeds, call:

```swift
let launchIdentity = try HermesConnectorCodeAttestor.captureExpectedIdentity(
    staticCode: staticCode,
    expectedTeamID: Self.expectedTeamID,
    expectedBundleID: Self.expectedBundleID
)
```

Keep the existing independent Team ID/bundle ID signing-info guard, SHA-256 comparison, CMS schema and local-pin checks, and final file identity/data comparison. Return `(launchIdentity, requirement)` only after all checks pass.

Change `withVerifiedConnector` to pass the staged executable URL, expected file identity, static launch identity, and requirement to its body. Keep readable descriptor snapshots before and after execution so mutation remains a fail-closed denial even though trust in the loaded child comes from dynamic code attestation.

- [ ] **Step 4: Replace descriptor execution with suspended pathname spawn**

Change the launch signature to:

```swift
private func launch(
    executable: URL,
    executableDescriptor: HermesRegularFileDescriptor,
    expectedFileIdentity: HermesFileIdentity,
    expectedLaunchIdentity: HermesConnectorLaunchIdentity,
    requirement: SecRequirement,
    requests: [[String: Any]]
) throws -> [[String: Any]]
```

Use `executable.path` as both `argv[0]` and the `posix_spawn` path. Remove `posix_spawn_file_actions_addinherit_np`; keep only exact stdin/stdout/stderr actions. Set both flags:

```swift
let flags = POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_START_SUSPENDED
guard posix_spawnattr_setflags(&attributes, Int16(flags)) == 0 else {
    throw HermesRuntimeFailure.connectorStatusFailed
}
```

Immediately after successful spawn, close the parent copies of the child-side pipe ends, but do not start the asynchronous writer. Add one idempotent cleanup helper scoped to `launch`:

```swift
func killAndReapSuspendedChild() {
    _ = Darwin.kill(child, SIGKILL)
    var status: Int32 = 0
    while Darwin.waitpid(child, &status, 0) < 0 && errno == EINTR {}
}
```

Then enforce this order:

```swift
do {
    try HermesConnectorCodeAttestor.attestSuspendedChild(
        pid: child,
        expected: expectedLaunchIdentity,
        requirement: requirement
    )
} catch {
    killAndReapSuspendedChild()
    throw HermesRuntimeFailure.connectorUnverified
}

guard Darwin.kill(child, SIGCONT) == 0 else {
    killAndReapSuspendedChild()
    throw HermesRuntimeFailure.connectorUnverified
}
// Only here may the existing bounded stdin writer start.
```

Preserve the existing single 40-second write/response deadline, response byte cap, sanitized parse errors, `SIGTERM`/`SIGKILL` timeout escalation, `waitpid`, and post-execution file snapshot. Ensure no error path waits twice for an already reaped child.

- [ ] **Step 5: Remove the unsupported historical fixture without reducing coverage**

In `HermesPersistenceCompatibility.swift`:

- remove the call to `descriptorBoundExecutionFixture()`;
- remove the complete `/dev/fd` fixture implementation;
- retain every historical persistence, journal, owner attribution, cron tamper, and newer-record rejection assertion.

This is not a test deletion without replacement: Task 1's dedicated fixture now validates the production-supported launch primitive against the shared production attestor.

Update `.github/workflows/mac-app-build.yml` historical compile command to include `Sources/ConnectorLaunchAttestation.swift` because `HermesRuntime.swift` now consumes its types:

```bash
swiftc -parse-as-library -framework Security \
  Sources/ConnectorLaunchAttestation.swift \
  Sources/HermesRuntime.swift \
  Tests/HermesPersistenceCompatibility.swift \
  -o "$RUNNER_TEMP/hermes-persistence-compatibility"
```

Add `Sources/ConnectorLaunchAttestation.swift` to the main app `swiftc` source list in `build.sh`.

- [ ] **Step 6: Run provider-free source contracts**

```bash
bun test apps/mac/IndexApp/hermes-runtime.spec.mjs
bash -n apps/mac/IndexApp/build.sh
git diff --check
```

Expected: all 38 Hermes runtime source-contract tests pass, shell syntax passes, and no whitespace errors remain.

- [ ] **Step 7: Run both native fixtures and the full macOS workflow**

On macOS or through the manually dispatched workflow, run:

```bash
cd apps/mac/IndexApp
./build.sh --fixture ConnectorLaunchAttestationFixture
swiftc -parse-as-library -framework Security \
  Sources/ConnectorLaunchAttestation.swift \
  Sources/HermesRuntime.swift \
  Tests/HermesPersistenceCompatibility.swift \
  -o "$RUNNER_TEMP/hermes-persistence-compatibility"
"$RUNNER_TEMP/hermes-persistence-compatibility"
```

Then dispatch and watch:

```bash
run_url="$(gh workflow run "Build macOS app" --ref feat/hermes-secure-standalone-connect)"
run_id="${run_url##*/}"
gh run watch "$run_id" --exit-status
```

Expected: dedicated suspended-attestation fixture, historical persistence fixture, assembled web parity, app compile/sign, bundle checks, and all preceding macOS fixtures pass.

- [ ] **Step 8: Commit the production wiring**

```bash
git add \
  apps/mac/IndexApp/Sources/HermesRuntime.swift \
  apps/mac/IndexApp/Tests/HermesPersistenceCompatibility.swift \
  apps/mac/IndexApp/hermes-runtime.spec.mjs \
  apps/mac/IndexApp/build.sh \
  .github/workflows/mac-app-build.yml
git commit -m "fix(mac): attest suspended connector before requests"
```

---

### Task 3: Scoped review, final verification, and PR refresh

**Files:**
- Modify only if review finds a concrete issue: files changed in Tasks 1-2
- Update: `.superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/progress.md`
- Update: `.superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/whole-branch-fix-report.md`

**Interfaces:**
- Consumes: reviewed Task 1 and Task 2 commits plus the approved amended design at `docs/superpowers/specs/2026-08-09-hermes-production-readiness-design.md`.
- Produces: a clean pushed PR #1357 head with independent deep review, provider-free Linux verification, and passing manually dispatched macOS and Hermes security workflows.

- [ ] **Step 1: Generate the exact review range and request a fresh deep review**

```bash
git diff --binary 47841b11a..HEAD -- \
  apps/mac/IndexApp \
  .github/workflows/mac-app-build.yml \
  docs/superpowers/specs/2026-08-09-hermes-production-readiness-design.md \
  docs/superpowers/plans/2026-08-10-hermes-suspended-connector-attestation.md \
  > .superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/suspended-attestation-review.diff
```

The reviewer must verify:

- Darwin `/dev/fd` execution is fully removed;
- the actual loaded child is attested while suspended;
- exact local Team ID, bundle ID, designated requirement, and static allowed CDHashes remain authoritative;
- no request bytes are written before `SIGCONT` after successful attestation;
- mismatch and all failure paths kill/reap and close pipes exactly once;
- CLOEXEC, bounded I/O, timeout escalation, environment allowlist, static signature/CMS/SHA checks, and post-execution snapshots remain intact;
- native fixtures exercise match, replacement mismatch-before-user-code, unrelated descriptor closure, and process cleanup.

Expected reviewer verdict: PASS with no High/Medium correctness or security findings. Use a bounded fix/re-review loop for findings; do not silently reopen the already exhausted five-round whole-branch loop beyond this scoped CI-discovered architecture correction.

- [ ] **Step 2: Run the provider-free Linux verification matrix**

Run the exact affected suites from the repository root:

```bash
bun install --frozen-lockfile
bun test apps/mac/IndexApp/hermes-runtime.spec.mjs
bun test apps/mac/IndexConnector/connector-contract.spec.mjs
bun test apps/mac/api/native-api-bridge.spec.mjs
python3 packages/hermes-plugin/tests/connector_protocol.py
python3 packages/hermes-plugin/tests/migration.py
python3 packages/hermes-plugin/tests/smoke.py
python3 packages/hermes-plugin/tests/gateway.py
node packages/hermes-plugin/tests/dashboard-registration.test.cjs
bun run --cwd packages/protocol build
bunx tsc --noEmit -p packages/protocol/tsconfig.json
bun run --cwd services/api build
bun run --cwd apps/web build
bun run skills:validate
bun run test:scripts
bun run build:skills
git diff --exit-code
git diff --check
git status --short --branch
```

Expected: every available provider-free check passes. Guarded PostgreSQL tests remain fail-closed unless a proven disposable `DATABASE_URL` and `TEST_DATABASE_SAFE=1` are available.

- [ ] **Step 3: Push the reviewed head and run both required manual workflows**

```bash
git push origin feat/hermes-secure-standalone-connect
mac_url="$(gh workflow run "Build macOS app" --ref feat/hermes-secure-standalone-connect)"
security_url="$(gh workflow run "Hermes runtime security" --ref feat/hermes-secure-standalone-connect)"
mac_id="${mac_url##*/}"
security_id="${security_url##*/}"
gh run watch "$mac_id" --exit-status
gh run watch "$security_id" --exit-status
```

Expected: both workflows conclude `success` at the exact pushed head.

- [ ] **Step 4: Refresh PR #1357 evidence without merging**

```bash
gh pr view 1357 --json url,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup
```

Record exact run URLs, head SHA, review verdict, skipped protected signing fixture status, guarded PostgreSQL status, and the future signed CMS/digest handoff in the SDD ledger and PR evidence. Do not merge, deploy, sign production artifacts, notarize, issue credentials, or release publicly.

- [ ] **Step 5: Commit only durable ledger changes, if tracked, and prove clean parity**

```bash
git add -f \
  .superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/progress.md \
  .superpowers/sdd/2026-08-09-hermes-secure-standalone-connection/whole-branch-fix-report.md
git diff --cached --check
git commit -m "docs: record suspended attestation verification"
git push origin feat/hermes-secure-standalone-connect
git fetch origin feat/hermes-secure-standalone-connect
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/hermes-secure-standalone-connect)"
test -z "$(git status --porcelain)"
```

If those ignored SDD files are intentionally not tracked by this branch, update them locally but do not force-add them solely for publication. Expected final state: local HEAD equals remote branch head and the worktree is clean.
