# IND-638B PR Readiness Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair PR #1365’s verified safety and current-dev integration defects, refresh exact-head evidence, and return the open PR to hosted-green reviewed state without merging or performing rollout operations.

**Architecture:** Rebase the existing semantic branch onto current `origin/dev`, then fix each operational defect with a red-green cycle at its narrow boundary. Historical-quality embedding callers receive explicit OpenAI SDK runtime options; strict quality URLs require real credentials; writable protected-base refresh checks an exact code-owned confirmation before any external construction. Validate one immutable implementation head, commit a separate receipt addendum, push, and request GitHub review.

**Tech Stack:** Bun, TypeScript, OpenAI SDK, Neon control-plane contracts, postgres.js/Drizzle, GitHub Actions.

## Global Constraints

- Work only in `/home/yanek/Projects/index/.worktrees/feat-historical-quality-runtime` on `feat/historical-quality-runtime`; one writer.
- Never run live smoke, pilot, provider inference, Redis operations, protected-base refresh, or unguarded Neon/database operations.
- Guarded DB tests require exact side-A `/protocol_eval` proof, `TEST_DATABASE_SAFE=1`, and an empty mode-0700 temporary cwd.
- Writable refresh requires exact `IND_638_CONFIRM='refresh IND-638 historical quality protected base'` plus `TEST_DATABASE_SAFE=1` in production code.
- Historical-quality embedding HTTP policy is `maxRetries: 0`, `timeout: 60000`.
- Strict quality database URLs require non-empty, decodable username and password; rejected values are never echoed.
- Preserve current-dev changes and versions while rebasing. Final versions: Protocol `11.0.3`, API `0.80.1`, Eval Ops `0.6.0`.
- Validation receipts are non-self-referential: validate immutable implementation head, then commit the receipt separately.
- Push/review/check completion does not authorize merge.

---

### Task 1: Rebase and preserve current-dev contracts

**Files:**
- Reconcile: `packages/protocol/CHANGELOG.md`
- Reconcile: `services/api/package.json`
- Reconcile: `services/api/.test-isolated`
- Reconcile as needed: `bun.lock`

**Interfaces:**
- Consumes: current `origin/dev` and clean PR worktree.
- Produces: rebased branch containing all current-dev and PR changes, with no semantic inventory loss.

- [ ] **Step 1: Verify identity and clean state**

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
test "$(git branch --show-current)" = feat/historical-quality-runtime
test -z "$(git status --porcelain=v1)"
```

Expected: exact worktree/branch and clean status.

- [ ] **Step 2: Fetch and rebase**

```bash
git fetch --prune origin dev feat/historical-quality-runtime
git rebase origin/dev
```

Expected: rebase completes; resolve overlaps by preserving both current-dev and quality entries.

- [ ] **Step 3: Verify preserved state**

```bash
rg -n 'embedder.provider-free.isolated.ts' services/api/.test-isolated
node -e "for(const f of ['packages/protocol/package.json','services/api/package.json','apps/eval-ops/package.json']) console.log(f,require('./'+f).version)"
git diff --check origin/dev..HEAD || true
git status --short --branch
```

Expected before version task: Protocol `11.0.2`, API `0.80.0`, Eval Ops `0.6.0`; embedder isolation entry present; only known receipt whitespace may fail diff-check.

- [ ] **Step 4: Commit only if conflict resolution created an explicit rebase-fix commit**

Normally rebase rewrites existing commits and no extra commit is needed. If semantic conflict repair is required after rebase:

```bash
git add <resolved-files>
git commit -m "chore: reconcile historical quality runtime with dev"
```

### Task 2: Freeze historical-quality embedding SDK behavior

**Files:**
- Modify: `services/api/src/adapters/embedder.adapter.ts`
- Modify: `services/api/src/adapters/tests/embedder.provider-free.isolated.ts`
- Modify: `services/api/src/cli/discovery-quality.child.ts`
- Modify: `services/api/src/cli/discovery-quality-base.main.ts`
- Modify: `services/api/src/cli/discovery-quality.environment.ts` only if exporting shared constants is needed.

**Interfaces:**
- Consumes: `EmbedderAdapter` and code-owned quality runtime constants.
- Produces: optional constructor fields `maxRetries?: number`, `timeout?: number`; quality callers pass `0` and `60000` explicitly.

- [ ] **Step 1: Write failing isolated tests**

Add assertions that a quality-configured adapter passes these exact options to the mocked OpenAI constructor:

```ts
expect(openAiOptions).toMatchObject({
  maxRetries: 0,
  timeout: 60_000,
});
```

Also assert a default adapter does not inject those fields, preserving ordinary production behavior. Add static/behavioral assertions that both `discovery-quality.child.ts` and `discovery-quality-base.main.ts` construct the adapter with the fixed options.

- [ ] **Step 2: Run RED**

```bash
cd services/api
bun test src/adapters/tests/embedder.provider-free.isolated.ts src/cli/tests/discovery-quality.child.spec.ts src/cli/tests/discovery-quality-base.spec.ts
```

Expected: FAIL because quality callers/client options do not yet carry retry/timeout.

- [ ] **Step 3: Implement minimal policy wiring**

Extend constructor options and OpenAI options:

```ts
constructor(options?: {
  apiKey?: string;
  baseURL?: string;
  dimensions?: number;
  maxRetries?: number;
  timeout?: number;
})
```

Copy defined `maxRetries`/`timeout` into `openaiOptions`. In both historical-quality callers instantiate:

```ts
new EmbedderAdapter({ maxRetries: 0, timeout: 60_000 })
```

Do not change ordinary adapter call sites.

- [ ] **Step 4: Run GREEN**

```bash
cd services/api
bun test src/adapters/tests/embedder.provider-free.isolated.ts src/cli/tests/discovery-quality.child.spec.ts src/cli/tests/discovery-quality-base.spec.ts
```

Expected: PASS and zero provider requests.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/adapters/embedder.adapter.ts services/api/src/adapters/tests/embedder.provider-free.isolated.ts services/api/src/cli/discovery-quality.child.ts services/api/src/cli/discovery-quality-base.main.ts services/api/src/cli/discovery-quality.environment.ts
git commit -m "fix(eval): freeze quality embedding requests"
```

### Task 3: Reject credential-less strict quality URLs

**Files:**
- Modify: `services/api/src/cli/discovery.neon.ts`
- Modify: `services/api/src/cli/tests/discovery.neon.spec.ts`
- Modify: `services/api/src/cli/tests/discovery-quality-refresh-target.spec.ts`

**Interfaces:**
- Consumes: strict quality v2 manifest and refresh target URL parsing.
- Produces: sanitized rejection when username/password is missing, empty after decoding, or malformed percent encoding.

- [ ] **Step 1: Write failing URL tests**

For strict v2 manifests and refresh targets, add table cases:

```ts
[
  'postgresql://ep-a.neon.tech/protocol_eval',
  'postgresql://user@ep-a.neon.tech/protocol_eval',
  'postgresql://:secret@ep-a.neon.tech/protocol_eval',
  'postgresql://user:@ep-a.neon.tech/protocol_eval',
  'postgresql://%20:secret@ep-a.neon.tech/protocol_eval',
  'postgresql://user:%20@ep-a.neon.tech/protocol_eval',
]
```

Assert rejection and assert the error does not contain the supplied URL or secret. Preserve a passing percent-encoded non-empty credential case.

- [ ] **Step 2: Run RED**

```bash
cd services/api
bun test src/cli/tests/discovery.neon.spec.ts src/cli/tests/discovery-quality-refresh-target.spec.ts
```

Expected: credential-less strict URL cases FAIL because parsing currently accepts them.

- [ ] **Step 3: Implement sanitized credential validation**

Inside strict URL validation, decode username/password in a guarded helper and require `decoded.trim().length > 0`. Throw only:

```ts
throw new Error(`Discovery manifest ${field} must contain database credentials`);
```

Do not apply new credential requirements to legacy unversioned/v1 parsing.

- [ ] **Step 4: Run GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery.neon.spec.ts src/cli/tests/discovery-quality-refresh-target.spec.ts src/cli/tests/discovery-quality-tls.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/cli/discovery.neon.ts services/api/src/cli/tests/discovery.neon.spec.ts services/api/src/cli/tests/discovery-quality-refresh-target.spec.ts
git commit -m "fix(eval): require attested database credentials"
```

### Task 4: Enforce writable base-refresh authorization in code

**Files:**
- Modify: `services/api/src/cli/discovery-quality-base.ts`
- Modify: `services/api/src/cli/tests/discovery-quality-base.spec.ts`
- Modify: `docs/guides/ind-638-historical-quality-pilot.md`
- Modify: `services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts`

**Interfaces:**
- Produces: `HISTORICAL_QUALITY_BASE_REFRESH_CONFIRMATION = 'refresh IND-638 historical quality protected base'` and a fail-closed authorization function used before control-plane creation in writable mode.
- Preserves: `--verify` read-only path without writable confirmation.

- [ ] **Step 1: Write failing ordering tests**

Add tests proving missing/wrong phrase and missing/wrong `TEST_DATABASE_SAFE` reject with zero calls to control-plane creation, attestation, handoff, DB, or provider seams. Add a test proving `--verify` does not require the writable phrase. Add a test proving unsupported args reject before control-plane construction.

- [ ] **Step 2: Run RED**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts
```

Expected: FAIL because writable bootstrap currently attests and hands off without authorization.

- [ ] **Step 3: Implement authorization-first bootstrap**

Parse allowed args before creating the control plane. For non-verify mode require:

```ts
env.IND_638_CONFIRM === HISTORICAL_QUALITY_BASE_REFRESH_CONFIRMATION
env.TEST_DATABASE_SAFE === '1'
```

Reject with variable names and expected phrase only; never include values. Then create/attest control plane and hand off. Keep verify behavior unchanged.

- [ ] **Step 4: Align runbook and audit**

Use the exact phrase everywhere:

```text
refresh IND-638 historical quality protected base
```

Keep shell checks as operator defense-in-depth and state that production code repeats them.

- [ ] **Step 5: Run GREEN**

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts src/cli/tests/discovery-quality.contract-audit.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/cli/discovery-quality-base.ts services/api/src/cli/tests/discovery-quality-base.spec.ts docs/guides/ind-638-historical-quality-pilot.md services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts
git commit -m "fix(eval): gate protected base refresh"
```

### Task 5: Version, lock, and clean final branch metadata

**Files:**
- Modify: `packages/protocol/package.json`
- Modify: `services/api/package.json`
- Modify: `packages/protocol/CHANGELOG.md`
- Modify: `bun.lock`
- Modify: `services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts`
- Modify: `docs/research/2026-08-11-ind-638b-validation-receipt.md`
- Modify: `docs/research/2026-08-11-ind-638b-validation-receipt-addendum.md`

**Interfaces:**
- Produces: Protocol `11.0.3`, API `0.80.1`, Eval Ops `0.6.0`, matching lockfile and audit.

- [ ] **Step 1: Update versions and changelog**

Set exact versions and add concise historical-quality runtime/fix notes under Protocol `11.0.3`. Do not bump Eval Ops.

- [ ] **Step 2: Update version audit**

Change exact expected package and lockfile versions to `11.0.3`, `0.80.1`, `0.6.0`.

- [ ] **Step 3: Regenerate lockfile**

```bash
bun install
bun install --frozen-lockfile
```

Expected: both succeed and lockfile records exact versions.

- [ ] **Step 4: Remove only trailing spaces from prior receipts**

Do not alter their validated heads, counts, or claims. Verify:

```bash
git diff --check origin/dev..HEAD
git diff --word-diff -- docs/research/2026-08-11-ind-638b-validation-receipt.md docs/research/2026-08-11-ind-638b-validation-receipt-addendum.md
```

- [ ] **Step 5: Run version and inventory checks**

```bash
cd services/api
bun test src/cli/tests/discovery-quality.contract-audit.spec.ts
cd ../..
bun run check:subtree-parity
bun run skills:validate
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/package.json services/api/package.json packages/protocol/CHANGELOG.md bun.lock services/api/src/cli/tests/discovery-quality.contract-audit.spec.ts docs/research/2026-08-11-ind-638b-validation-receipt.md docs/research/2026-08-11-ind-638b-validation-receipt-addendum.md
git commit -m "chore: version historical quality readiness fixes"
```

### Task 6: Provider-free exact-head validation and review

**Files:**
- No source changes unless a concrete defect is found.
- Scratch evidence only under `/tmp` or ignored `.pi-subagents/`.

**Interfaces:**
- Consumes: immutable implementation head after Task 5.
- Produces: exact commands/counts, diff SHA/stat, independent no-finding verdict or a fix loop.

- [ ] **Step 1: Capture immutable head and diff identity**

```bash
IMPLEMENTATION_HEAD=$(git rev-parse HEAD)
BASE=$(git merge-base origin/dev HEAD)
git diff --binary "$BASE".."$IMPLEMENTATION_HEAD" | sha256sum
git diff --shortstat "$BASE".."$IMPLEMENTATION_HEAD"
test -z "$(git status --porcelain=v1)"
```

- [ ] **Step 2: Run targeted provider-free validation**

```bash
bun install --frozen-lockfile
bun run check:subtree-parity
bun run skills:validate
bun run --cwd packages/protocol build
bun run --cwd packages/protocol eval:verify
bun run --cwd packages/protocol architecture:exports
bun run --cwd packages/protocol architecture:consumer
bun run --cwd packages/protocol architecture:host-isolation
bun run --cwd services/api build
bun run --cwd services/api typecheck:cli-specs
bun run --cwd services/api lint
bun run build:eval-ops
```

Run the exact all-CLI suite from a fresh mode-0700 temporary cwd with provider keys unset and an absolute test path. Run migration generation/no-drift and isolated inventory checks required by the Development Reference. Never run the complete live-containing `opportunity.graph.spec.ts`.

- [ ] **Step 3: Run independent whole-branch review**

Dispatch a fresh `pi-bridge.final-reviewer` against `origin/dev..$IMPLEMENTATION_HEAD`, explicitly checking the three repaired findings, current-dev integration, versions, secrets, destructive ordering, migration, and receipt boundaries. Any Critical/Important/Minor finding returns to a TDD fix round and repeats affected checks.

- [ ] **Step 4: Freeze implementation head**

After a no-finding review, do not modify implementation files before guarded DB validation and receipt authoring.

### Task 7: Exact-head guarded DB proof

**Files:**
- No repository source changes.
- Secure temporary harness outside the repository; remove it after success.

**Interfaces:**
- Consumes: exact disposable side-A and read-only replica attestations from secure operator environment.
- Produces: sanitized exact-head target proof and full guarded integration count.

- [ ] **Step 1: Confirm safety preconditions without printing secrets**

Require exact implementation head, clean worktree, attested side A `/protocol_eval`, read-only base replica, writable refresh topology, `TEST_DATABASE_SAFE=1`, and no provider/Redis keys in the guarded child environment.

- [ ] **Step 2: Run guarded proof from mode-0700 temporary cwd**

Invoke `discovery-quality-db-test.guard.ts --side a`, then the absolute `discovery-quality-base.integration.spec.ts` path. Use existing sanitized tooling; never print URLs/manifests/keys/vectors.

Expected: exact target proof plus all guarded integration tests pass (currently 17/17).

- [ ] **Step 3: Verify side A and base invariants**

Require read-only base session `on`, exact restored-child equality, and mocked provider seams. Stop on any ambiguity; do not retry without diagnosis.

### Task 8: Receipt addendum, push, hosted checks, and GitHub review

**Files:**
- Create: `docs/research/2026-08-11-ind-638b-readiness-repair-validation-receipt.md`

**Interfaces:**
- Consumes: immutable implementation head, exact validation evidence, independent review, guarded DB result.
- Produces: separate non-self-referential receipt commit and updated open PR.

- [ ] **Step 1: Write receipt**

Record implementation head/base, binary diff SHA/stat, exact provider-free commands/counts, guarded DB count, independent review verdict, repaired findings, operational disclosure, residual risks, and explicit no-merge/no-rollout boundary. Include no credentials, URLs, manifests, recovery records, or vectors.

- [ ] **Step 2: Independently review receipt**

Use a fresh read-only reviewer to verify claims, non-self-reference, hashes/counts, disclosures, secret absence, and authorization boundary. Fix only receipt defects and obtain approval.

- [ ] **Step 3: Commit receipt separately**

```bash
git add docs/research/2026-08-11-ind-638b-readiness-repair-validation-receipt.md
git commit -m "docs(eval): receipt historical quality readiness repair"
```

Verify the receipt commit changes only that receipt.

- [ ] **Step 4: Push and reconcile**

```bash
git push --force-with-lease origin feat/historical-quality-runtime
git fetch origin feat/historical-quality-runtime dev
git status --short --branch
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/historical-quality-runtime)"
```

Force-with-lease is required because the existing PR branch was rebased; never force without lease.

- [ ] **Step 5: Wait for all hosted checks**

Use read-only GitHub status inspection. Require every check-run on the exact pushed receipt head to complete successfully.

- [ ] **Step 6: Request GitHub Copilot review**

Use the available authenticated GitHub tooling to request `@copilot`. If authentication tooling is unavailable, report that external blocker rather than fabricating approval. After review arrives, inspect and resolve every conversation through the project workflow.

- [ ] **Step 7: Report readiness without merging**

Report PR head, base, checks, review state, residual rollout boundary, and any remaining approval requirement. Do not merge or begin rollout.
