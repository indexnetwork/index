# Eval Ops Reset Environment File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the deployed eval-ops reset use its validated injected `DATABASE_URL` when `.env.test` is absent, without weakening local env-file mismatch protections.

**Architecture:** Keep `assessFixtureTarget` as the first, credential-free database safety guard. Change the env-file read to distinguish an absent file from a present file with no `DATABASE_URL`, then make `resolveResetTarget` accept only the absent-file case. When `.env.test` exists, its non-empty URL must still exactly match the injected URL before the flush/migrate/seed pipeline is launched. Update the startup warning to use the same distinction.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.file`, provider-free eval-ops tests.

## Global Constraints

- Never allow production database names (`*_prod` / `*_production`) or redirect-capable connection-string query parameters.
- Keep the reset target derived from server environment, never from request payloads.
- Preserve exact URL equality when `.env.test` exists.
- Preserve `NODE_ENV=test`, `TEST_DATABASE_SAFE=1`, and injected `DATABASE_URL` for reset subprocesses.
- Do not add a Railway pre-deploy migration or provision a secret `.env.test` file.
- Keep credential redaction in all operator-facing messages.
- Work only in `/home/yanek/Projects/index/.worktrees/fix-eval-ops-env-file-reset`; leave canonical `dev` untouched.

---

### Task 1: Add an env-file presence regression test

**Files:**
- Modify: `packages/protocol/eval/ops/tests/server.spec.ts` in the existing `POST /api/fixture/reset` test section
- Test: `packages/protocol/eval/ops/tests/server.spec.ts`

**Interfaces:**
- Consumes: the current reset preflight behavior in `packages/protocol/eval/ops/ops.server.ts`.
- Produces: failing examples that define the required absent/present `.env.test` contract for the implementation.

- [ ] **Step 1: Locate the existing server reset tests and add four focused cases**

Use the existing test helper/style rather than constructing unrelated infrastructure. Export one pure test seam from `ops.server.ts` with this exact shape:

```ts
export interface ResetEnvFileState {
  exists: boolean;
  databaseUrl: string | null;
}

export function validateResetEnvFile(
  injectedDatabaseUrl: string,
  envFile: ResetEnvFileState,
): { ok: true; databaseUrl: string } | { ok: false; reason: string };
```

The cases must assert:

```ts
expect(validateResetEnvFile("postgres://u:p@host/neondb", {
  exists: false,
  databaseUrl: null,
})).toEqual({ ok: true, databaseUrl: "postgres://u:p@host/neondb" });

expect(validateResetEnvFile("postgres://u:p@host/neondb", {
  exists: true,
  databaseUrl: null,
})).toMatchObject({ ok: false });

expect(validateResetEnvFile("postgres://u:p@host/neondb", {
  exists: true,
  databaseUrl: "postgres://u:p@host/otherdb",
})).toMatchObject({ ok: false });

expect(validateResetEnvFile("postgres://u:p@host/neondb", {
  exists: true,
  databaseUrl: "postgres://u:p@host/neondb",
})).toEqual({ ok: true, databaseUrl: "postgres://u:p@host/neondb" });
```

Also assert refusal messages remain credential-free for the mismatch case.

- [ ] **Step 2: Run the focused test to verify it fails for the missing behavior**

Run from the worktree:

```bash
bun test packages/protocol/eval/ops/tests/server.spec.ts
```

Expected: FAIL because the exported seam does not yet exist, or because the absent-file case is currently rejected. Do not proceed until the failure demonstrates the intended behavior gap rather than a path/import typo.

- [ ] **Step 3: Commit the red test**

```bash
git add packages/protocol/eval/ops/tests/server.spec.ts
git commit -m "test(eval-ops): cover deployed reset env file absence"
```

---

### Task 2: Implement the minimal absent-file-safe preflight

**Files:**
- Modify: `packages/protocol/eval/ops/ops.server.ts:1270-1315,1600-1613`
- Test: `packages/protocol/eval/ops/tests/server.spec.ts`

**Interfaces:**
- Consumes: `validateResetEnvFile` tests from Task 1 and the existing `assessFixtureTarget`/`redactDatabaseUrl` guards.
- Produces: `validateResetEnvFile`, the presence-aware `readEnvValue`, and reset behavior that accepts an absent `.env.test` only.

- [ ] **Step 1: Make the env-file reader distinguish absence from a missing key**

Replace the current `readEnvValue(file, key): Promise<string | null>` contract with:

```ts
interface EnvFileValue {
  exists: boolean;
  value: string | null;
}

async function readEnvValue(file: string, key: string): Promise<EnvFileValue>;
```

Return `{ exists: false, value: null }` when `Bun.file(file).exists()` is false. For an existing file, preserve the current dotenv parsing rules and return `{ exists: true, value }`, where `value` remains `null` when the key is absent or blank. Do not log or include raw values in errors.

- [ ] **Step 2: Add the pure reset env-file validator**

Implement the exact interface from Task 1:

```ts
export function validateResetEnvFile(
  injectedDatabaseUrl: string,
  envFile: ResetEnvFileState,
): { ok: true; databaseUrl: string } | { ok: false; reason: string } {
  const databaseUrl = injectedDatabaseUrl.trim();
  if (!envFile.exists) return { ok: true, databaseUrl };
  if (envFile.databaseUrl === null) {
    return { ok: false, reason: "DATABASE_URL is not set in .env.test; fixture control is unavailable." };
  }
  if (envFile.databaseUrl !== databaseUrl) {
    return {
      ok: false,
      reason:
        `this server's DATABASE_URL is ${redactDatabaseUrl(databaseUrl)}, but .env.test names `
        + `${redactDatabaseUrl(envFile.databaseUrl)}. The migrate step reads that file directly, so the two must agree.`,
    };
  }
  return { ok: true, databaseUrl };
}
```

Keep `resolveResetTarget` responsible for the existing `assessFixtureTarget` status/error response. It should call `readEnvValue`, pass `{ exists, databaseUrl: value }` to the pure validator, return status `409` with the existing user-facing wording for failures, and return the injected validated URL when the file is absent. Continue returning `target` from `assessFixtureTarget`; do not move production-name or query-parameter checks into the new helper.

- [ ] **Step 3: Update startup mismatch warning to check only existing files**

At `createDefaultOpsContext`, change the warning condition from `declared !== null` to `declared.exists && declared.value !== null`, then redact `declared.value`. A missing deployment `.env.test` must not produce a false mismatch warning, while an existing divergent file must still warn.

- [ ] **Step 4: Run the focused tests and typecheck**

Run:

```bash
bun test packages/protocol/eval/ops/tests/server.spec.ts
bun run --cwd apps/eval-ops typecheck
```

Expected: all server tests pass, including the four env-file cases, and TypeScript reports no errors.

- [ ] **Step 5: Commit the implementation**

```bash
git add packages/protocol/eval/ops/ops.server.ts packages/protocol/eval/ops/tests/server.spec.ts
git commit -m "fix(eval-ops): allow reset with deployed database env"
```

---

### Task 3: Run the affected validation and inspect the final diff

**Files:**
- Modify: none beyond Tasks 1–2.

**Interfaces:**
- Consumes: the committed implementation and its regression tests.
- Produces: verified evidence that deployed reset behavior is fixed without changing Railway service configuration.

- [ ] **Step 1: Run the complete provider-free eval-ops test suite**

```bash
bun test packages/protocol/eval/ops/tests
```

Expected: PASS with no failures.

- [ ] **Step 2: Run repository-targeted static checks**

```bash
bun run --cwd apps/eval-ops lint
bun run --cwd apps/eval-ops typecheck
bun run test:scripts
```

Expected: all commands exit successfully. If a check fails, keep the task open and fix only regressions caused by this change.

- [ ] **Step 3: Verify source and worktree invariants**

```bash
git diff origin/dev...HEAD --check
git diff origin/dev...HEAD --stat
git status --short --branch
cd /home/yanek/Projects/index && git status --short --branch && git branch --show-current
```

Expected: the fix worktree contains only the approved spec, plan, implementation, and tests; the canonical root remains clean on `dev`.
