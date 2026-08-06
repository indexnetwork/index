# PR #1340 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #1340 merge-ready by reconciling current `dev`, hardening automatic enrichment boundaries, removing retired permission fields from API responses, aligning release metadata, and posting verified evidence.

**Architecture:** Keep automatic enrichment, but introduce a worker-time admission contract that requires a live user and, for scoped jobs, a live network plus active membership. Enforce network isolation when selecting onboarding seeds, exclude email from premise fallback text, and project stored network permissions through one whitelist before returning them publicly.

**Tech Stack:** TypeScript, Bun test runner, Drizzle ORM, BullMQ, Python Hermes smoke tests, Git/GitHub CLI.

## Global Constraints

- Work only in `/home/yanek/Projects/index/.worktrees/refactor-remove-network-enrichment-consent` on `refactor/remove-network-enrichment-consent`.
- Preserve immediate signup/import identity application and automatic enrichment.
- Do not restore network-level or onboarding consent gates.
- Do not implement the future per-application enrichment preference service.
- Do not remove retired JSON keys from stored rows.
- Do not change the legacy `create_user_context` compatibility surface.
- Never set `TEST_DATABASE_SAFE=1` unless the target database is independently proven dedicated and disposable.
- Merge `origin/dev`; do not rebase or force-push the published branch.
- Preserve unrelated `dev` universal-link work and the canonical root's untracked `services/api/eval/discovery-ab/` directory.
- Use test-first red-green-refactor for every production behavior change.

---

## File Structure

**Create**

- `services/api/src/lib/network-permissions.ts` — pure whitelist projection from stored permission JSON to the public permission contract.
- `services/api/src/lib/network-permissions.spec.ts` — hermetic projection tests.

**Modify**

- `services/api/src/adapters/enrichment.database.adapter.ts` — worker-time user/network/membership/premise admission reads.
- `services/api/src/adapters/tests/enrichment.database.adapter.privacy.spec.ts` — rename and test the admission adapter, including membership and unscoped behavior.
- `services/api/src/queues/enrichment.queue.ts` — replace privacy naming with admission naming and deny stale scoped jobs.
- `services/api/src/queues/tests/enrichment-privacy-gate.spec.ts` — rename behavior descriptions and test live membership plus unscoped user checks.
- `services/api/src/queues/tests/enrichment.queue.spec.ts` — update injected dependency names and expected decisions.
- `packages/protocol/src/enrichment/enrichment.tools.ts` — exact scoped seed selection.
- `packages/protocol/src/enrichment/tests/enrichment.privacy-tools.spec.ts` — preview and confirmation isolation tests.
- `packages/protocol/src/enrichment/enrichment.graph.ts` — omit email from basic-info premise input.
- `packages/protocol/src/enrichment/tests/enrichment.graph.spec.ts` — premise fallback regression test.
- `services/api/src/adapters/chat.database.adapter.ts` — apply the public permission projection at every network response boundary.
- `packages/hermes-plugin/package.json` and `packages/hermes-plugin/dashboard/manifest.json` — align with `plugin.yaml` at `0.16.0`.
- `apps/web/package.json`, `packages/protocol/package.json`, `services/api/package.json`, and `bun.lock` — preserve final workspace versions and current `dev` lock data.
- `apps/web/CHANGELOG.md`, `docs/design/protocol-deep-dive.md`, `docs/domain/identity-and-context.md`, and `docs/specs/api-reference.md` — describe automatic enrichment and immediate profile application accurately while preserving universal-link documentation from `dev`.

**Delete before final push**

- `docs/superpowers/specs/2026-08-06-pr-1340-review-fixes-design.md`
- `docs/superpowers/plans/2026-08-06-pr-1340-review-fixes.md`

---

### Task 1: Reconcile the Published Branch with Current `dev`

**Files:**
- Modify: `apps/web/package.json:1-6`
- Modify: `bun.lock:35-55`
- Modify: `docs/specs/api-reference.md:190-220`
- Preserve: all files introduced on `origin/dev`

**Interfaces:**
- Consumes: published PR head and `origin/dev`.
- Produces: one ordinary merge commit with no unresolved conflicts and web version `0.49.0`.

- [ ] **Step 1: Verify identity and fetch current refs**

```bash
cd /home/yanek/Projects/index/.worktrees/refactor-remove-network-enrichment-consent
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
git fetch origin dev refactor/remove-network-enrichment-consent
```

Expected: correct worktree and branch; status is clean; local branch is ahead only by planning commits.

- [ ] **Step 2: Start a non-rewriting merge**

```bash
git merge --no-commit --no-ff origin/dev
```

Expected: conflicts only on overlapping PR/dev surfaces such as `apps/web/package.json` and `docs/specs/api-reference.md`.

- [ ] **Step 3: Resolve the overlap**

Keep this web version:

```json
{
  "name": "@indexnetwork/web",
  "version": "0.49.0"
}
```

In `docs/specs/api-reference.md`, keep both the ordered `/u/*/?*` universal-link exclusion from `dev` and the PR's enrichment contract. In `bun.lock`, retain the merged dependency graph; final workspace version correction happens in Task 6.

- [ ] **Step 4: Verify and commit the merge**

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)' apps/web/package.json docs/specs/api-reference.md bun.lock && exit 1 || true
git diff --check
git status --short
git add apps/web/package.json docs/specs/api-reference.md bun.lock
git add -u
git commit -m "merge: reconcile dev into enrichment consent removal"
```

Expected: merge commit succeeds; branch is no longer behind `origin/dev`.

---

### Task 2: Require Live Admission for Enrichment Jobs

**Files:**
- Modify: `services/api/src/adapters/enrichment.database.adapter.ts:34-75`
- Modify: `services/api/src/adapters/tests/enrichment.database.adapter.privacy.spec.ts`
- Modify: `services/api/src/queues/enrichment.queue.ts:30-52,195-290`
- Modify: `services/api/src/queues/tests/enrichment-privacy-gate.spec.ts`
- Modify: `services/api/src/queues/tests/enrichment.queue.spec.ts`

**Interfaces:**
- Consumes: `schema.users`, `schema.networks`, `schema.networkMembers`, and `schema.premises`.
- Produces: `getEnrichmentAdmissionContext(userId: string, networkId?: string): Promise<EnrichmentAdmissionContext>` where `EnrichmentAdmissionContext` contains `userExists`, `networkExists`, `membershipExists`, and `hasActivePremise` booleans.
- Produces: `EnrichmentAdmissionDecision` and injectable `checkAdmission` / `admissionDatabase` dependencies.

- [ ] **Step 1: Make adapter tests hermetic and write failing membership tests**

Before dynamic runtime imports in `enrichment.database.adapter.privacy.spec.ts`, set and later restore the same isolated-child markers used by `chat.database.adapter.delegation.spec.ts`:

```ts
const savedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  API_TEST_ISOLATED_CHILD: process.env.API_TEST_ISOLATED_CHILD,
  API_TEST_DATABASE_READY: process.env.API_TEST_DATABASE_READY,
  API_TEST_PARENT_PID: process.env.API_TEST_PARENT_PID,
};
process.env.DATABASE_URL ||= "postgres://stub:stub@localhost:5432/stub";
process.env.API_TEST_ISOLATED_CHILD = "1";
process.env.API_TEST_DATABASE_READY = "1";
process.env.API_TEST_PARENT_PID = String(process.ppid);

const { networks, networkMembers, premises, users } = await import("../../schemas/database.schema.js");
const { EnrichmentDatabaseAdapter } = await import("../enrichment.database.adapter.js");
```

Extend the fake query router with `membershipRows` and add assertions equivalent to:

```ts
membershipRows = [];
const ctx = await new EnrichmentDatabaseAdapter(fakeDb)
  .getEnrichmentAdmissionContext("u1", "n1");
expect(ctx.membershipExists).toBe(false);
expect(fromTables).toContain(networkMembers);
```

Also add an unscoped case asserting `networkExists` and `membershipExists` are `true` without reading `networks` or `networkMembers`.

- [ ] **Step 2: Write failing queue admission tests**

Update the queue test fixture to expose `membershipExists`. Add these cases:

```ts
it("denies a scoped job when membership was removed", async () => {
  admissionContext = {
    userExists: true,
    networkExists: true,
    membershipExists: false,
    hasActivePremise: false,
  };
  expect(await callGate({ userId: "u1", networkId: "n1" })).toEqual({
    allowed: false,
    reason: "network_membership_not_found",
    hasExistingProfile: false,
  });
});

it("checks that an unscoped job still has a live user", async () => {
  admissionContext = {
    userExists: false,
    networkExists: true,
    membershipExists: true,
    hasActivePremise: false,
  };
  const decision = await callGate({ userId: "u3" });
  expect(decision.reason).toBe("user_not_found");
  expect(admissionContextCalls).toContainEqual(["u3", undefined]);
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
cd services/api
bun test src/adapters/tests/enrichment.database.adapter.privacy.spec.ts src/queues/tests/enrichment-privacy-gate.spec.ts
```

Expected: FAIL because `getEnrichmentAdmissionContext`, membership admission, and unscoped user admission do not exist yet; no database readiness error.

- [ ] **Step 4: Implement the admission adapter**

Define and return:

```ts
export interface EnrichmentAdmissionContext {
  userExists: boolean;
  networkExists: boolean;
  membershipExists: boolean;
  hasActivePremise: boolean;
}
```

For scoped jobs, query a non-deleted `networkMembers` row matching both `userId` and `networkId`. For unscoped jobs, skip network and membership queries and report those two fields as `true`. Keep the active-premise query unchanged.

- [ ] **Step 5: Implement queue admission and remove privacy naming**

Rename `EnrichmentPrivacyDecision` to `EnrichmentAdmissionDecision`, `checkPrivacy` to `checkAdmission`, `privacyDatabase` to `admissionDatabase`, and `resolvePrivacyDecision` to `resolveAdmissionDecision`. Always call the adapter, including for unscoped jobs, and evaluate in this order:

```ts
if (!userExists) return { allowed: false, reason: "user_not_found", hasExistingProfile };
if (!networkExists) return { allowed: false, reason: "network_not_found", hasExistingProfile };
if (!membershipExists) return { allowed: false, reason: "network_membership_not_found", hasExistingProfile };
if (jobName === "ensure_profile_hyde" && hasExistingProfile) {
  return { allowed: true, reason: "existing_profile_no_public_enrichment_needed", hasExistingProfile };
}
return { allowed: true, reason: "enrichment_allowed", hasExistingProfile };
```

Update all injected test dependencies and comments in the three affected queue specs.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
cd services/api
bun test src/adapters/tests/enrichment.database.adapter.privacy.spec.ts src/queues/tests/enrichment-privacy-gate.spec.ts src/queues/tests/enrichment.queue.spec.ts
```

Expected: PASS with no database access.

- [ ] **Step 7: Commit admission hardening**

```bash
git add services/api/src/adapters/enrichment.database.adapter.ts \
  services/api/src/adapters/tests/enrichment.database.adapter.privacy.spec.ts \
  services/api/src/queues/enrichment.queue.ts \
  services/api/src/queues/tests/enrichment-privacy-gate.spec.ts \
  services/api/src/queues/tests/enrichment.queue.spec.ts
git commit -m "fix(api): require live enrichment membership"
```

---

### Task 3: Isolate Network-Scoped Onboarding Seeds

**Files:**
- Modify: `packages/protocol/src/enrichment/enrichment.tools.ts:65-69`
- Modify: `packages/protocol/src/enrichment/tests/enrichment.privacy-tools.spec.ts`

**Interfaces:**
- Consumes: `OnboardingState.profileSeeds` and optional focused `networkId`.
- Produces: exact-scope seed selection; no cross-network fallback when scoped.

- [ ] **Step 1: Write failing preview and confirmation tests**

Add a preview case with only an `n1` seed but context `networkId: "n2"`; assert generated input contains authenticated account data and excludes `Seed Alice`, `Seed City`, and `seedalice`.

Add a confirmation case with only an `n1` seed but context `networkId: "n2"`; confirm a draft and assert `setUserSocials` is not called with the `n1` seed social.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd packages/protocol
bun test src/enrichment/tests/enrichment.privacy-tools.spec.ts
```

Expected: FAIL because scoped selection currently falls back to the latest seed from another network.

- [ ] **Step 3: Implement exact scoped selection**

Change the return to:

```ts
const scoped = networkId ? seeds.filter((seed) => seed.networkId === networkId) : seeds;
return scoped[scoped.length - 1];
```

- [ ] **Step 4: Run the tests and verify GREEN**

```bash
cd packages/protocol
bun test src/enrichment/tests/enrichment.privacy-tools.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit seed isolation**

```bash
git add packages/protocol/src/enrichment/enrichment.tools.ts \
  packages/protocol/src/enrichment/tests/enrichment.privacy-tools.spec.ts
git commit -m "fix(protocol): isolate scoped profile seeds"
```

---

### Task 4: Exclude Email from Premise Fallback Text

**Files:**
- Modify: `packages/protocol/src/enrichment/enrichment.graph.ts:386-396`
- Modify: `packages/protocol/src/enrichment/tests/enrichment.graph.spec.ts:640-705`

**Interfaces:**
- Consumes: automatic enrichment user records.
- Produces: premise fallback text containing name, location, and bio only; external enricher input remains unchanged.

- [ ] **Step 1: Write the failing premise regression test**

In `ProfileGraph - Enrichment with Premise Decomposition`, return `null` from `mockEnrichUserProfile`, invoke generate mode, and assert:

```ts
const assertionTexts = (mockPremiseGraph.invoke as any).mock.calls
  .map((call: any[]) => call[0].assertionText as string);
expect(assertionTexts.join("\n")).toContain("Jane Doe");
expect(assertionTexts.join("\n")).not.toContain("jane@example.com");
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cd packages/protocol
bun test src/enrichment/tests/enrichment.graph.spec.ts
```

Expected: FAIL because `buildBasicInfo()` includes `Email: jane@example.com`.

- [ ] **Step 3: Remove email from basic-info construction**

Keep the external `enrichUserProfile` request unchanged. Remove only this fallback line from `buildBasicInfo()`:

```ts
user.email ? `Email: ${user.email}` : null,
```

- [ ] **Step 4: Run the test and verify GREEN**

```bash
cd packages/protocol
bun test src/enrichment/tests/enrichment.graph.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit contact safety**

```bash
git add packages/protocol/src/enrichment/enrichment.graph.ts \
  packages/protocol/src/enrichment/tests/enrichment.graph.spec.ts
git commit -m "fix(protocol): omit email from premise fallback"
```

---

### Task 5: Whitelist Public Network Permission Responses

**Files:**
- Create: `services/api/src/lib/network-permissions.ts`
- Create: `services/api/src/lib/network-permissions.spec.ts`
- Modify: `services/api/src/adapters/chat.database.adapter.ts`

**Interfaces:**
- Consumes: `unknown` stored permissions JSON.
- Produces: `toPublicNetworkPermissions(value: unknown): schema.NetworkPermissionsState`.

- [ ] **Step 1: Write the failing pure projection tests**

Create `network-permissions.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { toPublicNetworkPermissions } from "./network-permissions";

describe("toPublicNetworkPermissions", () => {
  it("omits retired and unknown stored keys", () => {
    expect(toPublicNetworkPermissions({
      joinPolicy: "anyone",
      invitationLink: { code: "invite" },
      allowGuestVibeCheck: true,
      contextInjection: { discovery: true },
      profileEnrichment: "consent_required",
      futureKey: "stored-only",
    })).toEqual({
      joinPolicy: "anyone",
      invitationLink: { code: "invite" },
      allowGuestVibeCheck: true,
      contextInjection: { discovery: true },
    });
  });

  it("uses safe defaults for missing permissions", () => {
    expect(toPublicNetworkPermissions(null)).toEqual({
      joinPolicy: "invite_only",
      invitationLink: null,
      allowGuestVibeCheck: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd services/api
bun test src/lib/network-permissions.spec.ts
```

Expected: FAIL because the projection module does not exist.

- [ ] **Step 3: Implement the whitelist projection**

Create a pure module with no database import:

```ts
import type { NetworkPermissionsState } from "../schemas/database.schema";

export function toPublicNetworkPermissions(value: unknown): NetworkPermissionsState {
  const stored = value && typeof value === "object"
    ? value as Partial<NetworkPermissionsState>
    : {};
  return {
    joinPolicy: stored.joinPolicy === "anyone" ? "anyone" : "invite_only",
    invitationLink: stored.invitationLink ?? null,
    allowGuestVibeCheck: stored.allowGuestVibeCheck === true,
    ...(stored.contextInjection !== undefined
      ? { contextInjection: stored.contextInjection }
      : {}),
  };
}
```

- [ ] **Step 4: Apply the projection to response boundaries**

Import `toPublicNetworkPermissions` in `chat.database.adapter.ts`. Replace raw network permission returns in:

- `getNetwork`;
- `getNetworksForUser`;
- `getPublicIndexesNotJoined`;
- `getPublicIndexDetail`;
- `getNetworkDetail`.

Use the helper in `loadNetworkSettingsDTO` and `createNetwork` to remove duplicate manual mappings. Do not project before writes; update and invitation rotation must continue spreading stored JSON to preserve unknown keys.

- [ ] **Step 5: Run tests and API build**

```bash
cd services/api
bun test src/lib/network-permissions.spec.ts
bun run build
```

Expected: PASS.

- [ ] **Step 6: Commit API projection**

```bash
git add services/api/src/lib/network-permissions.ts \
  services/api/src/lib/network-permissions.spec.ts \
  services/api/src/adapters/chat.database.adapter.ts
git commit -m "fix(api): project public network permissions"
```

---

### Task 6: Align Versions, Lock Metadata, and Documentation

**Files:**
- Modify: `packages/hermes-plugin/package.json:1-5`
- Modify: `packages/hermes-plugin/dashboard/manifest.json:1-10`
- Verify: `packages/hermes-plugin/plugin.yaml:1-5`
- Modify: `apps/web/package.json:1-5`
- Modify: `packages/protocol/package.json:1-5`
- Modify: `services/api/package.json:1-5`
- Modify: `bun.lock` workspace entries
- Modify: `apps/web/CHANGELOG.md`
- Modify: `docs/design/protocol-deep-dive.md`
- Modify: `docs/domain/identity-and-context.md`
- Modify: `docs/specs/api-reference.md`

**Interfaces:**
- Produces: Hermes `0.16.0`, web `0.49.0`, protocol `10.0.0`, and API `0.77.0` consistently in manifests and lock metadata.
- Produces: documentation that states imported profile fields are applied immediately and retained as provenance seeds.

- [ ] **Step 1: Record existing failing consistency checks**

```bash
python3 packages/hermes-plugin/tests/smoke.py
python3 - <<'PY'
import json
from pathlib import Path
lock = Path("bun.lock").read_text()
expected = {
    'apps/web': '0.49.0',
    'packages/hermes-plugin': '0.16.0',
    'packages/protocol': '10.0.0',
    'services/api': '0.77.0',
}
for workspace, version in expected.items():
    marker = f'"{workspace}": {{'
    start = lock.index(marker)
    block = lock[start:start + 180]
    assert f'"version": "{version}"' in block, (workspace, block)
PY
```

Expected: Hermes smoke and lock assertions fail on stale versions.

- [ ] **Step 2: Align Hermes and workspace metadata**

Set:

```text
packages/hermes-plugin/plugin.yaml                 0.16.0
packages/hermes-plugin/package.json                0.16.0
packages/hermes-plugin/dashboard/manifest.json     0.16.0
apps/web/package.json                              0.49.0
packages/protocol/package.json                     10.0.0
services/api/package.json                          0.77.0
```

Update only the corresponding workspace `version` fields in `bun.lock`; preserve all merged `dev` package and dependency changes.

- [ ] **Step 3: Correct stale behavior documentation**

Use these contract statements consistently:

```text
Signup/import profile fields are applied to the account immediately and automatic enrichment may run for current network members. The same imported fields are retained as provenance seeds so onboarding preview and confirmation can explain and refine the active profile. Network-scoped seed reads never fall back across networks.
```

Remove promises of a public-lookup consent step and remove any statement that imported fields are staged without activation. Preserve the `dev` universal-link section in `docs/specs/api-reference.md`.

- [ ] **Step 4: Verify consistency GREEN**

```bash
python3 packages/hermes-plugin/tests/smoke.py
python3 - <<'PY'
import json
from pathlib import Path
lock = Path("bun.lock").read_text()
expected = {
    'apps/web': '0.49.0',
    'packages/hermes-plugin': '0.16.0',
    'packages/protocol': '10.0.0',
    'services/api': '0.77.0',
}
for workspace, version in expected.items():
    marker = f'"{workspace}": {{'
    start = lock.index(marker)
    block = lock[start:start + 180]
    assert f'"version": "{version}"' in block, (workspace, block)
PY
rg -n "consent|staged|profileSeeds|automatic enrichment" \
  apps/web/CHANGELOG.md docs/design/protocol-deep-dive.md \
  docs/domain/identity-and-context.md docs/specs/api-reference.md
```

Expected: smoke and version assertions pass; remaining consent references are historical removal statements, not promises of an active gate.

- [ ] **Step 5: Commit release consistency**

```bash
git add packages/hermes-plugin/package.json \
  packages/hermes-plugin/dashboard/manifest.json \
  apps/web/package.json packages/protocol/package.json services/api/package.json \
  bun.lock apps/web/CHANGELOG.md docs/design/protocol-deep-dive.md \
  docs/domain/identity-and-context.md docs/specs/api-reference.md
git commit -m "chore: align enrichment removal release metadata"
```

---

### Task 7: Run Targeted Repository Verification

**Files:**
- Verify only; do not alter production behavior to silence failures.

**Interfaces:**
- Consumes: completed diff.
- Produces: exact command/result evidence for the PR comment.

- [ ] **Step 1: Run protocol validation**

```bash
cd packages/protocol
bun run build
bun test src/enrichment/tests/enrichment.privacy-tools.spec.ts \
  src/enrichment/tests/enrichment.graph.spec.ts \
  src/enrichment/tests/enrichment.public-lookup.spec.ts \
  src/enrichment/tests/enrichment.tools.social-merge.spec.ts \
  src/chat/tests/onboarding.persona.spec.ts \
  src/mcp/tests/mcp.authorization-policy.spec.ts \
  src/mcp/tests/mcp.server.spec.ts
bun run test:architecture
```

Expected: all pass.

- [ ] **Step 2: Run API validation**

```bash
cd services/api
bun run build
bun test src/lib/network-permissions.spec.ts \
  src/adapters/tests/enrichment.database.adapter.privacy.spec.ts \
  src/queues/tests/enrichment-privacy-gate.spec.ts \
  src/queues/tests/enrichment.queue.spec.ts \
  src/controllers/tests/network.controller.isolated.ts \
  tests/mcp.spec.ts
```

Expected: all hermetic tests pass. If any test requests a database, stop and report it rather than setting `TEST_DATABASE_SAFE=1`.

- [ ] **Step 3: Run web and Hermes validation**

```bash
cd apps/web
bun run build
bun run lint
bun run test -- tests/network-overview-panel.test.tsx tests/onboarding-first-signal.test.tsx
cd ../../packages/hermes-plugin
python3 tests/smoke.py
```

Expected: build/tests/smoke pass; lint has no errors. Record pre-existing warnings separately.

- [ ] **Step 4: Run repository checks**

```bash
cd /home/yanek/Projects/index/.worktrees/refactor-remove-network-enrichment-consent
bun run check:subtree-parity
bun run build:skills
git diff --check origin/dev...HEAD
bun install --frozen-lockfile
git status --short --branch
```

Expected: all pass and the worktree is clean.

- [ ] **Step 5: Inspect the complete change**

```bash
git diff --stat origin/dev...HEAD
git diff --name-status origin/dev...HEAD
git log --oneline --decorate origin/dev..HEAD
```

Expected: only PR scope, review fixes, version/docs changes, and temporary plan/spec files.

---

### Task 8: Remove Temporary Planning Files, Push, and Comment

**Files:**
- Delete: `docs/superpowers/specs/2026-08-06-pr-1340-review-fixes-design.md`
- Delete: `docs/superpowers/plans/2026-08-06-pr-1340-review-fixes.md`

**Interfaces:**
- Produces: clean pushed branch, no upstream drift, refreshed GitHub checks, and one top-level PR evidence comment.

- [ ] **Step 1: Remove temporary planning artifacts and commit**

```bash
git rm docs/superpowers/specs/2026-08-06-pr-1340-review-fixes-design.md \
  docs/superpowers/plans/2026-08-06-pr-1340-review-fixes.md
git commit -m "chore: remove completed implementation plans"
```

- [ ] **Step 2: Re-run final lightweight gates**

```bash
git diff --check origin/dev...HEAD
bun run check:subtree-parity
python3 packages/hermes-plugin/tests/smoke.py
git status --short --branch
```

Expected: all pass and the worktree is clean.

- [ ] **Step 3: Push normally and prove upstream parity**

```bash
git push origin refactor/remove-network-enrichment-consent
git fetch origin refactor/remove-network-enrichment-consent
git status --short --branch
git rev-list --left-right --count HEAD...origin/refactor/remove-network-enrichment-consent
```

Expected: `0 0`; no force push.

- [ ] **Step 4: Verify PR state and fresh checks**

```bash
gh pr view 1340 --json url,state,headRefOid,baseRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision
```

Expected: head OID matches local HEAD; mergeability is recomputed away from the old conflicting head. Do not merge.

- [ ] **Step 5: Post the PR comment**

Create `/tmp/pr1340-review-fixes-comment.md` containing:

```markdown
Implemented the merge-readiness fixes:

- merged current `dev` without rewriting the PR branch;
- require a live user and active network membership when scoped enrichment jobs execute;
- prevent network-scoped onboarding seed fallback across networks;
- exclude email from fallback premise decomposition while preserving automatic external enrichment;
- omit retired `profileEnrichment` and unknown stored keys from public network permission responses;
- aligned Hermes/workspace versions, `bun.lock`, and behavior documentation.

Verification:

- protocol build, targeted enrichment/onboarding/MCP tests, and architecture tests — passed
- API build and targeted admission/queue/network/MCP tests — passed
- web build, lint, and targeted onboarding/network tests — passed
- `python3 packages/hermes-plugin/tests/smoke.py` — passed
- `bun run check:subtree-parity` — passed
- `bun run build:skills` — passed
- `bun install --frozen-lockfile` — passed
- `git diff --check origin/dev...HEAD` — passed

Database-backed tests were not run unless a dedicated disposable database was independently verified; the fail-closed guard was not bypassed.
```

Replace angle-bracket evidence with actual counts/results, then post:

```bash
gh pr comment 1340 --body-file /tmp/pr1340-review-fixes-comment.md
```

- [ ] **Step 6: Report without merging**

Report pushed commit SHA, PR URL, comment URL, current mergeability/check state, exact validation evidence, and any remaining caveats. Leave the worktree for independent review and do not merge PR #1340.
