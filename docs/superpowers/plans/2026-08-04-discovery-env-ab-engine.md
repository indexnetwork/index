# Discovery env A/B engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the real discovery graph twice — once per operator-chosen environment configuration — over a shared case selection, and emit one artifact holding both sides.

**Architecture:** Generalize the existing `discovery-env-matrix` machinery from five hard-coded rows to two operator-chosen env configs. A dependency-free bootstrap attests the Neon targets *before* any runtime import, resets both side branches from the protected base, then spawns one child process per side (the API composes its database singleton once per process, so a side's `DATABASE_URL` must be fixed for that process's lifetime). Each child runs its slots under its own env config; the parent aggregates both sides into one artifact with no baseline comparison.

**Tech Stack:** Bun, TypeScript, Drizzle, Neon control plane (REST), `@indexnetwork/protocol` graph + eval policy modules.

**Spec:** `docs/superpowers/specs/2026-08-04-discovery-env-ab-engine-design.md`
**Linear:** IND-627 (engine), IND-626 (base fixture, Task 1), IND-630 (the seven unreachable flags)

## Global Constraints

- **Only nine flags may be offered:** `DISCOVERY_ALLOWED_TYPES`, `DISCOVERY_PROFILE_SOURCE`, `DISCOVERY_CONTEXT_TO_INTENT`, `DISCOVERY_SOURCE_PREMISE_LIMIT`, `DISCOVERY_REJECTION_COOLDOWN_DAYS`, `RUN_OPPORTUNITY_EVAL_IN_PARALLEL`, `NEGOTIATION_MAX_TURNS_CHAT`, `NEGOTIATION_MAX_TURNS_AMBIENT`, `NEGOTIATION_INCLUDE_OTHER_INTENTS`. Derived by test, never hand-copied (Task 2).
- **No baseline.** This harness never reads, writes or compares a baseline file. The pair is the result.
- **Errors are sanitized** before reaching logs or artifacts — provider and database errors can carry credentials and response bodies. Reuse `sanitizeMatrixError` / `MatrixExecutionError` classification.
- **Selection is shared, configuration is per side.** Cases and repetitions are one control for both sides.
- **Identical configs are refused** before any spend.
- **Never target `production` (`br-fragrant-brook-ahexgsek`) or `dev`.** Attestation must make them unreachable by construction.
- **Test command:** `cd services/api && bun test src/cli/tests/<file>.spec.ts` for a single file. Full suite: `bun run test` (runs `NODE_ENV=test API_TEST_REQUIRE_DATABASE=1 bun test`).
- **Lint:** `cd services/api && bun run lint`.
- All new files live in `services/api/src/cli/`, tests in `services/api/src/cli/tests/`, following the existing `discovery-env-matrix.*` naming.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/cli/discovery-ab.flags.ts` | The nine offerable flags + value-kind validation. Pure. |
| `src/cli/tests/discovery-ab.flags.spec.ts` | Derives the reachable flag set from the graph source and asserts it equals the offered set. |
| `src/cli/discovery-env-matrix.runtime.ts` *(modify)* | `withMatrixEnvironment` generalized to an arbitrary allowlisted env map. |
| `src/cli/discovery-ab.plan.ts` | `(cases, reps, configA, configB) → slots`; refuses identical configs; shares selection. Pure. |
| `src/cli/tests/discovery-ab.plan.spec.ts` | Plan-builder tests. |
| `src/cli/discovery-ab.neon.ts` | A/B target attestation + the single mutating reset call. |
| `src/cli/tests/discovery-ab.neon.spec.ts` | Attestation and reset tests against a fake control plane. |
| `src/cli/discovery-ab.main.ts` | Parent: gate → reset → spawn two children → aggregate → artifact. Child: run assigned slots. |
| `src/cli/discovery-ab.ts` | Dependency-free attesting bootstrap (mirrors `discovery-env-matrix.ts`). |
| `src/cli/tests/discovery-ab.artifact.spec.ts` | Artifact shape: two rules, per-side configs, diff, no baseline. |
| `services/api/package.json` *(modify)* | `eval:discovery-ab` script. |

---

### Task 1: Recreate and seed the protected base fixture (IND-626)

This is operational, not code: `eval-discovery-base` does not exist in Neon project `shiny-cloud-34341469`, so every later task has nothing to branch from. Seeding embeds every fixture intent and builds HyDE documents with vectors — this is why the design clones a pre-embedded base instead of re-seeding per run.

**Files:**
- No source changes. Uses existing `src/cli/discovery-env-matrix-base.main.ts`.

**Interfaces:**
- Consumes: nothing.
- Produces: a Neon branch named exactly `eval-discovery-base` on project `shiny-cloud-34341469`, database `protocol_eval`, holding the `historical-matrix-v1` corpus; its `branchId`, `endpointId` and `databaseUrl` for later tasks.

- [ ] **Step 1: Confirm the base is really absent**

```bash
# Expect: no branch named eval-discovery-base
curl -s -H "Authorization: Bearer $NEON_API_KEY" \
  https://console.neon.tech/api/v2/projects/shiny-cloud-34341469/branches \
  | grep -o '"name":"[^"]*"' | sort -u
```

- [ ] **Step 2: Read the base lifecycle command's contract before running it**

Read `src/cli/discovery-env-matrix-base.main.ts` — specifically `runBaseCommand`, `seedProtectedBase`, `verifyProtectedBase`, `verifyBaseFixtureIntegrity`. Note the required env: `NEON_API_KEY`, a confirm variable, and a `DATABASE_URL` pointing at the new branch. Do not guess the flags; `main(args)` parses them.

- [ ] **Step 3: Create the branch and seed it**

Create branch `eval-discovery-base` from `production` (schema source), then run the seed. The seed embeds intents and builds HyDE documents, so it needs provider credentials and takes several minutes.

```bash
cd services/api
bun run eval:discovery-env-matrix-base   # exact flags per Step 2
```

- [ ] **Step 4: Verify integrity**

```bash
cd services/api
bun run eval:discovery-env-matrix-base:verify
```

Expected: passes, reporting a `fixtureFingerprint` and `fixtureCorpusVersion` of `historical-matrix-v1`. It must refuse if any fixture intent is unembedded — if it does, the seed did not complete; do not proceed.

- [ ] **Step 5: Mark the branch protected in Neon and record its identifiers**

Set branch protection so no run can write to it. Record `branchId`, `endpointId` and the `protocol_eval` `databaseUrl` in the Linear issue IND-626, and note them for Task 6.

- [ ] **Step 6: Commit**

No code changed. Post the fingerprints and branch identifiers as a comment on IND-626 and close it.

---

### Task 2: The nine offerable flags, derived rather than copied

The entire project exists because sixteen flags were editable while zero harnesses read them. A hand-maintained list would reintroduce exactly that drift, so the test recomputes the reachable set from the graph source.

**Files:**
- Create: `services/api/src/cli/discovery-ab.flags.ts`
- Test: `services/api/src/cli/tests/discovery-ab.flags.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `AB_FLAGS: readonly string[]` — the nine keys, sorted.
  - `type AbEnvConfig = Readonly<Record<string, string>>`
  - `assertAbEnvConfig(config: AbEnvConfig): void` — throws when a key is outside `AB_FLAGS` or a value is empty/whitespace.
  - `reachableEnvKeys(entryFile: string, candidateKeys: readonly string[]): Set<string>` — transitive-import-closure scan, used by the test.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/cli/tests/discovery-ab.flags.spec.ts
import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { AB_FLAGS, assertAbEnvConfig, reachableEnvKeys } from '../discovery-ab.flags';

const PROFILE_ENV_ALLOWLIST = [
  'DISCOVERY_ALLOWED_TYPES', 'DISCOVERY_CONTEXT_TO_INTENT', 'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS', 'DISCOVERY_SOURCE_PREMISE_LIMIT', 'INTRODUCER_DISCOVERY_ENABLED',
  'NEGOTIATION_EVIDENCE_QUESTIONS_MODE', 'NEGOTIATION_INCLUDE_OTHER_INTENTS', 'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT', 'OUTCOME_QUESTIONS_MODE', 'POOL_QUESTIONS_MINING', 'POOL_QUESTIONS_MODE',
  'POOL_QUESTIONS_PUSH', 'POOL_QUESTIONS_RANKING', 'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
];

const GRAPH_ENTRY = path.resolve(
  import.meta.dir, '../../../../../packages/protocol/src/opportunity/application/opportunity.graph.ts',
);

describe('AB_FLAGS', () => {
  it('is exactly the set of allowlisted keys the discovery graph can reach', () => {
    const reachable = reachableEnvKeys(GRAPH_ENTRY, PROFILE_ENV_ALLOWLIST);
    expect([...reachable].sort()).toEqual([...AB_FLAGS].sort());
  });

  it('offers nine flags and excludes every queue-only key', () => {
    expect(AB_FLAGS).toHaveLength(9);
    for (const key of ['POOL_QUESTIONS_MODE', 'POOL_QUESTIONS_PUSH', 'POOL_QUESTIONS_RANKING',
      'POOL_QUESTIONS_MINING', 'OUTCOME_QUESTIONS_MODE', 'NEGOTIATION_EVIDENCE_QUESTIONS_MODE',
      'INTRODUCER_DISCOVERY_ENABLED']) {
      expect(AB_FLAGS).not.toContain(key);
    }
  });
});

describe('assertAbEnvConfig', () => {
  it('accepts a config drawn from the offered flags', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: 'intent' })).not.toThrow();
  });

  it('refuses a key the graph cannot reach, naming it', () => {
    expect(() => assertAbEnvConfig({ POOL_QUESTIONS_MODE: 'on' })).toThrow(/POOL_QUESTIONS_MODE/);
  });

  it('refuses an empty value, because unset and empty are not the same thing', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: '   ' })).toThrow(/DISCOVERY_ALLOWED_TYPES/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.flags.spec.ts`
Expected: FAIL — cannot resolve `../discovery-ab.flags`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/cli/discovery-ab.flags.ts
/**
 * The only environment flags this harness may offer: those the discovery graph
 * actually reads. The list is asserted against a fresh scan of the graph's
 * import closure (discovery-ab.flags.spec.ts) rather than trusted, because a
 * hand-maintained copy is exactly how sixteen editable flags came to move
 * nothing at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const AB_FLAGS: readonly string[] = [
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_CONTEXT_TO_INTENT',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS',
  'DISCOVERY_SOURCE_PREMISE_LIMIT',
  'NEGOTIATION_INCLUDE_OTHER_INTENTS',
  'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT',
  'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
];

export type AbEnvConfig = Readonly<Record<string, string>>;

/** Resolves a relative TypeScript import specifier the way Bun does for these modules. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier).replace(/\.js$/, '.ts');
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every candidate key mentioned anywhere in the entry file's transitive import closure. */
export function reachableEnvKeys(entryFile: string, candidateKeys: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [path.resolve(entryFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const key of candidateKeys) if (source.includes(key)) found.add(key);
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const resolved = resolveSpecifier(file, match[1]!);
      if (resolved !== null) stack.push(resolved);
    }
  }
  return found;
}

/** Throws when a config names a flag this harness cannot honestly exercise. */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!AB_FLAGS.includes(key)) {
      throw new Error(`${key} is not readable by the discovery graph; this harness cannot test it`);
    }
    if (value.trim() === '') {
      throw new Error(`${key} has an empty value; unset it instead of blanking it`);
    }
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.flags.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the derivation test is not tautological**

Temporarily add `'POOL_QUESTIONS_MODE',` to `AB_FLAGS`, re-run, and confirm the first test FAILS. Remove it and confirm PASS again. A test that cannot fail is not evidence.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/cli/discovery-ab.flags.ts services/api/src/cli/tests/discovery-ab.flags.spec.ts
git commit -m "feat(eval): derive the env flags a discovery A/B run may offer

The nine keys are asserted against a fresh scan of opportunity.graph.ts's
import closure rather than trusted as a list, because a hand-maintained copy
is exactly how sixteen editable flags came to move nothing at all."
```

---

### Task 3: Generalize environment application to an arbitrary config

`withMatrixEnvironment` hard-codes two keys. A/B needs any of the nine, and must restore precisely — including deleting keys that were previously unset, or a run leaks configuration into the process that outlives it.

**Files:**
- Modify: `services/api/src/cli/discovery-env-matrix.runtime.ts:67-80`
- Test: `services/api/src/cli/tests/discovery-ab.env.spec.ts` (create)

**Interfaces:**
- Consumes: `AbEnvConfig`, `assertAbEnvConfig` (Task 2).
- Produces: `withDiscoveryEnvironment<T>(config: AbEnvConfig, run: () => Promise<T>): Promise<T>` exported from `discovery-env-matrix.runtime.ts`. The existing `withMatrixEnvironment(row, run)` keeps its signature and delegates, so the matrix harness is untouched.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/cli/tests/discovery-ab.env.spec.ts
import { describe, expect, it } from 'bun:test';

import { withDiscoveryEnvironment, withMatrixEnvironment } from '../discovery-env-matrix.runtime';

describe('withDiscoveryEnvironment', () => {
  it('applies every configured key for the duration of the run', async () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    process.env.DISCOVERY_SOURCE_PREMISE_LIMIT = '40';
    const seen = await withDiscoveryEnvironment(
      { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
      async () => ({
        allowed: process.env.DISCOVERY_ALLOWED_TYPES,
        limit: process.env.DISCOVERY_SOURCE_PREMISE_LIMIT,
      }),
    );
    expect(seen).toEqual({ allowed: 'intent', limit: '5' });
  });

  it('deletes keys that were unset before, rather than leaving them behind', async () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    await withDiscoveryEnvironment({ DISCOVERY_ALLOWED_TYPES: 'intent' }, async () => undefined);
    expect('DISCOVERY_ALLOWED_TYPES' in process.env).toBe(false);
  });

  it('restores the previous value of keys that were set before', async () => {
    process.env.DISCOVERY_SOURCE_PREMISE_LIMIT = '40';
    await withDiscoveryEnvironment({ DISCOVERY_SOURCE_PREMISE_LIMIT: '5' }, async () => undefined);
    expect(process.env.DISCOVERY_SOURCE_PREMISE_LIMIT).toBe('40');
    delete process.env.DISCOVERY_SOURCE_PREMISE_LIMIT;
  });

  it('restores even when the run throws', async () => {
    process.env.DISCOVERY_SOURCE_PREMISE_LIMIT = '40';
    await expect(withDiscoveryEnvironment(
      { DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
      async () => { throw new Error('graph failed'); },
    )).rejects.toThrow('graph failed');
    expect(process.env.DISCOVERY_SOURCE_PREMISE_LIMIT).toBe('40');
    delete process.env.DISCOVERY_SOURCE_PREMISE_LIMIT;
  });

  it('refuses a key the graph cannot reach', async () => {
    await expect(withDiscoveryEnvironment(
      { POOL_QUESTIONS_MODE: 'on' }, async () => undefined,
    )).rejects.toThrow(/POOL_QUESTIONS_MODE/);
  });
});

describe('withMatrixEnvironment', () => {
  it('still applies the two matrix keys unchanged', async () => {
    const seen = await withMatrixEnvironment(
      { id: 'intent-only', allowedTypes: 'intent', profileSource: 'premise' },
      async () => ({
        allowed: process.env.DISCOVERY_ALLOWED_TYPES,
        source: process.env.DISCOVERY_PROFILE_SOURCE,
      }),
    );
    expect(seen).toEqual({ allowed: 'intent', source: 'premise' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.env.spec.ts`
Expected: FAIL — `withDiscoveryEnvironment` is not exported.

- [ ] **Step 3: Implement**

Replace the body of `withMatrixEnvironment` in `discovery-env-matrix.runtime.ts` with a delegation, and add the general function:

```ts
/**
 * Applies an environment configuration for exactly one run and restores the
 * previous state, including deleting keys that were previously unset. Values
 * are applied to `process.env` because the graph reads them there at call
 * time; the child process running this is single-purpose, so no other work is
 * observing these keys.
 */
export async function withDiscoveryEnvironment<T>(config: AbEnvConfig, run: () => Promise<T>): Promise<T> {
  assertAbEnvConfig(config);
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(config)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function withMatrixEnvironment<T>(row: MatrixRowEnvironment, run: () => Promise<T>): Promise<T> {
  return withDiscoveryEnvironment(
    { DISCOVERY_ALLOWED_TYPES: row.allowedTypes, DISCOVERY_PROFILE_SOURCE: row.profileSource },
    run,
  );
}
```

Add the import: `import { assertAbEnvConfig, type AbEnvConfig } from './discovery-ab.flags';`

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.env.spec.ts src/cli/tests/discovery-env-matrix.spec.ts`
Expected: PASS. The existing matrix spec must stay green — that is the proof the delegation preserved behavior.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/cli/discovery-env-matrix.runtime.ts services/api/src/cli/tests/discovery-ab.env.spec.ts
git commit -m "feat(eval): apply an arbitrary discovery env config for one run

withMatrixEnvironment hard-coded two keys. A/B needs any of the nine, and
must restore precisely - including deleting keys that were unset before, or
a run leaks configuration into the process that outlives it. The matrix
entry point keeps its signature and delegates."
```

---

### Task 4: Plan builder — shared selection, per-side configuration

**Files:**
- Create: `services/api/src/cli/discovery-ab.plan.ts`
- Test: `services/api/src/cli/tests/discovery-ab.plan.spec.ts`

**Interfaces:**
- Consumes: `AbEnvConfig`, `assertAbEnvConfig` (Task 2); `HistoricalMatrixFixture` from `./discovery-env-matrix.shared`.
- Produces:
  - `type AbSideId = 'a' | 'b'`
  - `interface AbSide { id: AbSideId; config: AbEnvConfig }`
  - `interface AbSlot { matrixCase: HistoricalMatrixFixture; side: AbSide; repetition: number }`
  - `buildAbPlan(cases: readonly HistoricalMatrixFixture[], sides: readonly [AbSide, AbSide], repetitions: number): AbSlot[]`
  - `configDiff(a: AbEnvConfig, b: AbEnvConfig): Array<{ key: string; a: string | null; b: string | null }>`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/cli/tests/discovery-ab.plan.spec.ts
import { describe, expect, it } from 'bun:test';

import { buildAbPlan, configDiff, type AbSide } from '../discovery-ab.plan';
import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const testCase = (id: string): HistoricalMatrixFixture => ({
  id, description: id, networkContext: 'ctx', sourceUserId: 'u1', expectedUserId: 'u2',
  excludedUserIds: [], participants: [],
});

const sideA: AbSide = { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } };
const sideB: AbSide = { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' } };

describe('buildAbPlan', () => {
  it('produces cases x repetitions x two sides', () => {
    const plan = buildAbPlan([testCase('c1'), testCase('c2')], [sideA, sideB], 3);
    expect(plan).toHaveLength(12);
    expect(plan.filter((slot) => slot.side.id === 'a')).toHaveLength(6);
    expect(plan.filter((slot) => slot.side.id === 'b')).toHaveLength(6);
  });

  it('gives both sides identical case and repetition coverage', () => {
    const plan = buildAbPlan([testCase('c1'), testCase('c2')], [sideA, sideB], 2);
    const coverage = (side: string) => plan
      .filter((slot) => slot.side.id === side)
      .map((slot) => `${slot.matrixCase.id}/r${slot.repetition}`)
      .sort();
    expect(coverage('a')).toEqual(coverage('b'));
  });

  it('refuses identical configurations, which would spend a run measuring noise', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, { id: 'b', config: sideA.config }], 1))
      .toThrow(/identical/i);
  });

  it('refuses a flag the graph cannot reach', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, { id: 'b', config: { POOL_QUESTIONS_MODE: 'on' } }], 1))
      .toThrow(/POOL_QUESTIONS_MODE/);
  });

  it('refuses a non-positive repetition count', () => {
    expect(() => buildAbPlan([testCase('c1')], [sideA, sideB], 0)).toThrow(/repetition/i);
  });

  it('refuses an empty case selection', () => {
    expect(() => buildAbPlan([], [sideA, sideB], 1)).toThrow(/case/i);
  });
});

describe('configDiff', () => {
  it('reports differing, added and removed keys with null for absent', () => {
    expect(configDiff(
      { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '40' },
      { DISCOVERY_ALLOWED_TYPES: 'profile', NEGOTIATION_MAX_TURNS_CHAT: '6' },
    )).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', a: 'intent', b: 'profile' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', a: '40', b: null },
      { key: 'NEGOTIATION_MAX_TURNS_CHAT', a: null, b: '6' },
    ]);
  });

  it('omits keys the two sides agree on, because they explain no difference', () => {
    expect(configDiff(
      { DISCOVERY_ALLOWED_TYPES: 'intent' },
      { DISCOVERY_ALLOWED_TYPES: 'intent', NEGOTIATION_MAX_TURNS_CHAT: '6' },
    )).toEqual([{ key: 'NEGOTIATION_MAX_TURNS_CHAT', a: null, b: '6' }]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.plan.spec.ts`
Expected: FAIL — cannot resolve `../discovery-ab.plan`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/cli/discovery-ab.plan.ts
/**
 * Turns a selection and two configurations into slots.
 *
 * Selection is shared: two sides that ran different cases or different
 * repetition counts are not comparable, so it is one input, not two.
 */
import { assertAbEnvConfig, type AbEnvConfig } from './discovery-ab.flags';
import type { HistoricalMatrixFixture } from './discovery-env-matrix.shared';

export type AbSideId = 'a' | 'b';
export interface AbSide { id: AbSideId; config: AbEnvConfig }
export interface AbSlot { matrixCase: HistoricalMatrixFixture; side: AbSide; repetition: number }

/** Keys where the two sides disagree. Agreed keys explain no difference and are omitted. */
export function configDiff(a: AbEnvConfig, b: AbEnvConfig): Array<{ key: string; a: string | null; b: string | null }> {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((key) => a[key] !== b[key])
    .map((key) => ({ key, a: a[key] ?? null, b: b[key] ?? null }));
}

export function buildAbPlan(
  cases: readonly HistoricalMatrixFixture[],
  sides: readonly [AbSide, AbSide],
  repetitions: number,
): AbSlot[] {
  if (cases.length === 0) throw new Error('A discovery A/B run requires at least one case');
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error(`A discovery A/B run requires a positive repetition count (received ${repetitions})`);
  }
  for (const side of sides) assertAbEnvConfig(side.config);
  const differences = configDiff(sides[0].config, sides[1].config);
  if (differences.length === 0) {
    throw new Error('Both sides have identical configurations; the run would measure noise, not a difference');
  }
  const slots: AbSlot[] = [];
  for (const matrixCase of cases) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (const side of sides) slots.push({ matrixCase, side, repetition });
    }
  }
  return slots;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.plan.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/cli/discovery-ab.plan.ts services/api/src/cli/tests/discovery-ab.plan.spec.ts
git commit -m "feat(eval): plan discovery A/B slots with shared selection

Selection is one input rather than two: sides that ran different cases are
not comparable. Identical configurations are refused outright - that run
would spend ninety graph invocations to measure noise."
```

---

### Task 5: A/B target attestation and the one mutating Neon call

`discovery-env-matrix.neon.ts` exposes a deliberately read-only control plane. Reset needs one write. It is added narrowly — refusing any branch that is not a designated A/B branch — rather than by opening the client to general writes.

**Files:**
- Create: `services/api/src/cli/discovery-ab.neon.ts`
- Test: `services/api/src/cli/tests/discovery-ab.neon.spec.ts`

**Interfaces:**
- Consumes: `NeonControlPlane`, `NeonBranch`, `NeonEndpoint` from `./discovery-env-matrix.neon`.
- Produces:
  - `AB_BRANCH_NAMES: { a: 'eval-ab-a'; b: 'eval-ab-b' }`
  - `interface AbTarget { sideId: 'a' | 'b'; branchId: string; endpointId: string; databaseUrl: string }`
  - `interface AbManifest { projectId: string; baseBranchId: string; targets: readonly [AbTarget, AbTarget] }`
  - `parseAbManifest(raw: string | undefined): AbManifest`
  - `attestAbTargets(input: { manifest: AbManifest; controlPlane: NeonControlPlane }): Promise<AbManifest>`
  - `resetAbBranch(input: { manifest: AbManifest; branchId: string; apiKey: string; fetchImpl?: typeof fetch }): Promise<void>`

**Deliberate deviation from `attestMatrixTargets`:** matrix children must carry a future `expiresAt`, because they are ephemeral. The A/B branches are durable by design, so expiry is not required; the safety property is preserved differently — they are reset from base before every run, so they never accumulate state worth protecting. Every other check (non-primary, parent is the attested base, endpoint host matches the URL) is kept, and the name check is *stricter*: an exact match rather than a prefix.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/cli/tests/discovery-ab.neon.spec.ts
import { describe, expect, it } from 'bun:test';

import { attestAbTargets, parseAbManifest, resetAbBranch, type AbManifest } from '../discovery-ab.neon';
import type { NeonControlPlane } from '../discovery-env-matrix.neon';

const manifest: AbManifest = {
  projectId: 'proj-1',
  baseBranchId: 'br-base',
  targets: [
    { sideId: 'a', branchId: 'br-a', endpointId: 'ep-a', databaseUrl: 'postgresql://u:p@ep-a.neon.tech/protocol_eval' },
    { sideId: 'b', branchId: 'br-b', endpointId: 'ep-b', databaseUrl: 'postgresql://u:p@ep-b.neon.tech/protocol_eval' },
  ],
};

const controlPlane = (overrides: Record<string, Partial<{ name: string; parentId: string | null; primary: boolean }>> = {}): NeonControlPlane => ({
  getBranch: async (_projectId, branchId) => ({
    id: branchId,
    name: { 'br-base': 'eval-discovery-base', 'br-a': 'eval-ab-a', 'br-b': 'eval-ab-b' }[branchId] ?? 'unknown',
    parentId: branchId === 'br-base' ? null : 'br-base',
    expiresAt: null,
    primary: false,
    ...overrides[branchId],
  }),
  listEndpoints: async (_projectId, branchId) => [
    { id: `ep-${branchId.slice(3)}`, branchId, host: `ep-${branchId.slice(3)}.neon.tech` },
  ],
});

describe('attestAbTargets', () => {
  it('accepts two A/B branches parented on the attested base', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane() })).resolves.toBeDefined();
  });

  it('refuses a branch whose name is not a designated A/B branch', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-a': { name: 'dev' } }) }))
      .rejects.toThrow(/identity is invalid/);
  });

  it('refuses a branch that is not parented on the base', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-b': { parentId: 'br-production' } }) }))
      .rejects.toThrow(/identity is invalid/);
  });

  it('refuses the primary branch outright', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-a': { primary: true } }) }))
      .rejects.toThrow(/identity is invalid/);
  });

  it('refuses a base branch that is not the protected fixture base', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-base': { name: 'production' } }) }))
      .rejects.toThrow(/base branch identity is invalid/);
  });
});

describe('resetAbBranch', () => {
  it('refuses to reset a branch that is not in the attested manifest', async () => {
    await expect(resetAbBranch({ manifest, branchId: 'br-production', apiKey: 'k' }))
      .rejects.toThrow(/not a designated/i);
  });

  it('posts a reset for an attested A/B branch', async () => {
    const calls: string[] = [];
    await resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(calls).toEqual(['POST https://console.neon.tech/api/v2/projects/proj-1/branches/br-a/reset_to_parent']);
  });

  it('raises a sanitized error when the control plane refuses', async () => {
    await expect(resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async () => new Response('{"message":"token sk-secret invalid"}', { status: 401 })) as unknown as typeof fetch,
    })).rejects.toThrow(/Neon control-plane reset failed/);
  });

  it('never puts the response body in the error, because it can carry credentials', async () => {
    const error = await resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async () => new Response('{"message":"token sk-secret invalid"}', { status: 401 })) as unknown as typeof fetch,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('sk-secret');
  });
});

describe('parseAbManifest', () => {
  it('refuses a manifest that does not name exactly two sides', () => {
    expect(() => parseAbManifest(JSON.stringify({ projectId: 'p', baseBranchId: 'b', targets: [] })))
      .toThrow(/exactly two/i);
  });

  it('refuses a missing manifest', () => {
    expect(() => parseAbManifest(undefined)).toThrow(/manifest/i);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.neon.spec.ts`
Expected: FAIL — cannot resolve `../discovery-ab.neon`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/cli/discovery-ab.neon.ts
/**
 * Attestation and reset for the two durable A/B branches.
 *
 * discovery-env-matrix.neon.ts is deliberately read-only. Reset is the one
 * write this harness needs, so it lives here, refuses any branch outside the
 * attested manifest, and never surfaces a response body: control-plane
 * responses can carry credentials.
 */
import type { NeonControlPlane } from './discovery-env-matrix.neon';

const BASE_NAME = 'eval-discovery-base';
export const AB_BRANCH_NAMES = { a: 'eval-ab-a', b: 'eval-ab-b' } as const;

export interface AbTarget { sideId: 'a' | 'b'; branchId: string; endpointId: string; databaseUrl: string }
export interface AbManifest { projectId: string; baseBranchId: string; targets: readonly [AbTarget, AbTarget] }

function isEndpointHost(urlHost: string, endpointHost: string): boolean {
  return urlHost === endpointHost || urlHost === endpointHost.replace(/^ep-/, '');
}

export function parseAbManifest(raw: string | undefined): AbManifest {
  if (raw === undefined || raw.trim() === '') throw new Error('Discovery A/B manifest is required');
  const parsed = JSON.parse(raw) as AbManifest;
  if (!Array.isArray(parsed.targets) || parsed.targets.length !== 2) {
    throw new Error('Discovery A/B manifest must name exactly two sides');
  }
  if (typeof parsed.projectId !== 'string' || typeof parsed.baseBranchId !== 'string') {
    throw new Error('Discovery A/B manifest is missing projectId or baseBranchId');
  }
  return parsed;
}

/**
 * Verifies both sides are the designated A/B branches, parented on the
 * protected base. Unlike matrix children these are durable, so no expiry is
 * required; they are reset from base before every run and never accumulate
 * state. The name check is exact rather than a prefix.
 */
export async function attestAbTargets(input: { manifest: AbManifest; controlPlane: NeonControlPlane }): Promise<AbManifest> {
  const { manifest, controlPlane } = input;
  const base = await controlPlane.getBranch(manifest.projectId, manifest.baseBranchId);
  if (base.id !== manifest.baseBranchId || base.name !== BASE_NAME || base.primary) {
    throw new Error('Neon control-plane base branch identity is invalid');
  }
  for (const target of manifest.targets) {
    const branch = await controlPlane.getBranch(manifest.projectId, target.branchId);
    if (branch.id !== target.branchId || branch.name !== AB_BRANCH_NAMES[target.sideId]
      || branch.parentId !== base.id || branch.primary) {
      throw new Error(`Neon control-plane side ${target.sideId} identity is invalid`);
    }
    const endpoints = await controlPlane.listEndpoints(manifest.projectId, target.branchId);
    const endpoint = endpoints.find((candidate) => candidate.id === target.endpointId);
    if (!endpoint || endpoint.branchId !== target.branchId
      || !isEndpointHost(new URL(target.databaseUrl).hostname, endpoint.host)) {
      throw new Error(`Neon control-plane side ${target.sideId} endpoint host does not match DATABASE_URL`);
    }
  }
  return manifest;
}

/** Resets one attested A/B branch from its parent. The only mutating call this harness makes. */
export async function resetAbBranch(input: {
  manifest: AbManifest; branchId: string; apiKey: string; fetchImpl?: typeof fetch;
}): Promise<void> {
  const { manifest, branchId, apiKey } = input;
  if (!manifest.targets.some((target) => target.branchId === branchId)) {
    throw new Error(`${branchId} is not a designated A/B branch; refusing to reset it`);
  }
  const send = input.fetchImpl ?? fetch;
  const response = await send(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(manifest.projectId)}/branches/${encodeURIComponent(branchId)}/reset_to_parent`,
    { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } },
  );
  // The body may echo credentials; only the status is safe to report.
  if (!response.ok) throw new Error(`Neon control-plane reset failed with status ${response.status}`);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.neon.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Verify the reset endpoint against Neon's current API**

Confirm `POST /projects/{project_id}/branches/{branch_id}/reset_to_parent` is the current reset operation (Neon has renamed restore/reset operations before). If it differs, update the path and the test together; do not leave the test asserting a path the API no longer has.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/cli/discovery-ab.neon.ts services/api/src/cli/tests/discovery-ab.neon.spec.ts
git commit -m "feat(eval): attest and reset the two durable A/B branches

The matrix control plane is deliberately read-only. Reset is the single
write this harness needs, so it refuses any branch outside the attested
manifest and reports only a status - control-plane bodies can carry
credentials. Matrix children must expire because they are ephemeral; these
are durable and reset before every run instead, so the name check is exact
rather than a prefix."
```

---

### Task 6: Child runner — one side, one branch, one configuration

**Files:**
- Create: `services/api/src/cli/discovery-ab.main.ts` (child half; the parent half is Task 7)
- Test: covered by Task 7's artifact spec plus the live smoke in Task 8. The graph invocation itself is not unit-testable without a database, which is why the seam below is the tested part.

**Interfaces:**
- Consumes: `buildAbPlan`, `AbSlot` (Task 4); `withDiscoveryEnvironment` (Task 3); from `./discovery-env-matrix.main`: `composeCaseRuntime`, `collectCandidates`, `projectFinalCandidates`, `collectEvaluatorTraces`, `runMatrixBoundary`, `sanitizeMatrixError`, `resolveFixtureTriggerIntent`, `databaseCase`; from the protocol eval bundle: `HISTORICAL_MATRIX_CASES`, `scoreMatrixSlot`, `buildExecutionEvidence`, `executeRuns`.
- Produces: `runAbChild(sideId: 'a' | 'b', slots: readonly AbSlot[], outputPath: string): Promise<void>` — writes `{ slots, execution }` JSON, the same shape the matrix child writes.

- [ ] **Step 1: Read the matrix child implementation end to end**

Read `runChild` in `src/cli/discovery-env-matrix.main.ts` (roughly lines 770–870). The A/B child differs in exactly two ways: `invokeMatrixDiscoveryGraph(..., slot.row, ...)` becomes a `withDiscoveryEnvironment(side.config, ...)` wrapper, and `rowId` becomes the side id. Everything else — boundary classification, candidate collection, evaluator projection, judge wiring, the failed-slot fallback — is reused unchanged.

- [ ] **Step 2: Implement the child**

```ts
/** Invokes the graph for one slot under that side's configuration. */
async function invokeAbDiscoveryGraph<T>(
  graph: { invoke(input: { userId: string; networkId: string; triggerIntentId: string; options: { minScore: number } }, config?: { signal?: AbortSignal }): Promise<T> },
  runtime: { sourceUserId: string; networkId: string; triggerIntentId: string },
  config: AbEnvConfig,
  signal?: AbortSignal,
): Promise<T> {
  return withDiscoveryEnvironment(config, () => graph.invoke({
    userId: runtime.sourceUserId,
    networkId: runtime.networkId,
    triggerIntentId: runtime.triggerIntentId,
    options: { minScore: 50 },
  }, signal ? { signal } : undefined));
}
```

Then mirror `runChild`, passing to `scoreMatrixSlot`:
- `rowId: slot.side.id`
- `configDeltas: Object.entries(slot.side.config).map(([key, after]) => ({ key, before: null, after }))` — `scoreMatrixSlot` already accepts `configDeltas`, so each side's exact configuration is recorded per slot with no schema change.
- `caseId: `${slot.matrixCase.id}/${slot.side.id}/r${slot.repetition + 1}``

Keep `ATTEMPT_TIMEOUT_MS`, the `executeRuns` retry wrapper and the failed-slot fallback identical to the matrix child; a slot that exhausts attempts must still produce a scored, failed slot so completeness accounting stays honest.

- [ ] **Step 3: Typecheck**

Run: `cd services/api && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/cli/discovery-ab.main.ts
git commit -m "feat(eval): run one A/B side against one branch under one config

Mirrors the matrix child: same boundary classification, candidate collection,
evaluator projection, judge wiring and failed-slot fallback. Only two things
differ - the graph runs inside that side's env config, and the slot's rowId
is the side. Each slot records its side's exact configuration through the
configDeltas field scoreMatrixSlot already accepts."
```

---

### Task 7: Parent — gate, reset, spawn, aggregate, artifact

**Files:**
- Modify: `services/api/src/cli/discovery-ab.main.ts` (add the parent half)
- Create: `services/api/src/cli/discovery-ab.ts` (dependency-free attesting bootstrap)
- Test: `services/api/src/cli/tests/discovery-ab.artifact.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces:
  - `buildAbArtifactMeta(input: { sides: readonly [AbSide, AbSide]; cases: readonly HistoricalMatrixFixture[]; repetitions: number; startedAt: string; git: unknown }): Record<string, unknown>` — exported for the test.
  - `main(args?: readonly string[]): Promise<void>`
  - Artifact written to `services/api/eval/discovery-ab/runs/<timestamp>.json`.

- [ ] **Step 1: Write the failing artifact test**

```ts
// services/api/src/cli/tests/discovery-ab.artifact.spec.ts
import { describe, expect, it } from 'bun:test';

import { buildAbArtifactMeta } from '../discovery-ab.main';
import type { AbSide } from '../discovery-ab.plan';
import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const cases: HistoricalMatrixFixture[] = [{
  id: 'c1', description: 'c1', networkContext: 'ctx', sourceUserId: 'u1',
  expectedUserId: 'u2', excludedUserIds: [], participants: [],
}];
const sides: [AbSide, AbSide] = [
  { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } },
  { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' } },
];

describe('buildAbArtifactMeta', () => {
  const meta = buildAbArtifactMeta({
    sides, cases, repetitions: 3, startedAt: '2026-08-04T00:00:00.000Z',
    git: { revision: 'abc123', dirty: false },
  });

  it('names the harness and does not claim a baseline', () => {
    expect(meta.harness).toBe('discovery-ab');
    expect(meta).not.toHaveProperty('baselinePath');
    expect(meta.selection).toMatchObject({ fullCorpus: true });
  });

  it('records each side\'s exact configuration', () => {
    expect(meta.configs).toMatchObject({
      a: { DISCOVERY_ALLOWED_TYPES: 'intent' },
      b: { DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
    });
  });

  it('records the diff, so the artifact says what produced any difference', () => {
    expect(meta.configDiff).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', a: 'intent', b: 'intent,profile' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', a: null, b: '5' },
    ]);
  });

  it('fingerprints the corpus and the scoring configuration', () => {
    expect(typeof meta.corpusFingerprint).toBe('string');
    expect(typeof meta.configFingerprint).toBe('string');
  });

  it('gives different configurations different scoring fingerprints', () => {
    const other = buildAbArtifactMeta({
      sides: [sides[0], { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'profile' } }],
      cases, repetitions: 3, startedAt: '2026-08-04T00:00:00.000Z',
      git: { revision: 'abc123', dirty: false },
    });
    expect(other.configFingerprint).not.toBe(meta.configFingerprint);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.artifact.spec.ts`
Expected: FAIL — `buildAbArtifactMeta` is not exported.

- [ ] **Step 3: Implement the parent**

Mirror `runParent` in `discovery-env-matrix.main.ts` with these differences:

1. **Gate first.** Refuse unless `DISCOVERY_AB_CONFIRM === '1'`. Then `parseAbManifest(process.env.DISCOVERY_AB_TARGETS)` and `attestAbTargets` — before any runtime import, exactly as the matrix bootstrap does.
2. **Reset both branches** via `resetAbBranch` for each target. If either reset fails, abort before spawning anything: a half-isolated comparison is not a comparison.
3. **Spawn two children**, one per side, each with `DATABASE_URL` set to that side's attested URL and `--side a|b --child-output <path>`. Reuse `runBoundedChildTasks` with concurrency 2 and the existing SIGTERM/SIGKILL escalation.
4. **Aggregate** both children's slots with `buildScorecard(slots, { model: process.env.CHAT_MODEL ?? 'configured runtime models', runs: 1 })`; `payload.rules` will hold the two side ids because `rowId` is the side.
5. **Meta** via `buildAbArtifactMeta`, including `configs`, `configDiff`, `corpusFingerprint: fingerprintEvalCorpus(cases)` and `configFingerprint: buildEvalScoringConfigFingerprint({ sides: sides.map((side) => side.config), repetitions, judge: true })`.
6. **No baseline.** Do not call `compareAgainstGovernedBaseline`, `performGovernedBaselineUpdate` or `writeBaseline`. Write the run artifact to `RUNS_DIR` after `assertEvalWritePlan({ inputs: [], outputs: [runPath], force })`.
7. **Incomplete runs report no verdict.** If either side has any failed slot, set `completeness.complete = false` and exit non-zero with a message naming the failed side.

Then create the bootstrap `src/cli/discovery-ab.ts` mirroring `discovery-env-matrix.ts`: parse args, attest via `attestAbTargets` + `createNeonControlPlane(process.env.NEON_API_KEY ?? '')`, set `DATABASE_URL` for a child invocation, and only then `await (await import('./discovery-ab.main')).main()`. Nothing that touches the database may be imported before attestation succeeds.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd services/api && bun test src/cli/tests/discovery-ab.artifact.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the no-baseline claim holds**

Run: `cd services/api && grep -n "Baseline\|baseline" src/cli/discovery-ab.main.ts`
Expected: no call to `compareAgainstGovernedBaseline`, `performGovernedBaselineUpdate`, `writeBaseline`, or any `BASELINE_PATH` constant. If any appears, remove it — the spec forbids a baseline for this harness.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
cd services/api && bunx tsc --noEmit && bun run lint
git add services/api/src/cli/discovery-ab.main.ts services/api/src/cli/discovery-ab.ts services/api/src/cli/tests/discovery-ab.artifact.spec.ts
git commit -m "feat(eval): compare two discovery configurations in one artifact

Gate, attest, reset both branches, run one child per side, aggregate into a
single artifact whose two rules are the two sides. No baseline: arbitrary
configurations have none, so the pair is the result. A failed side reports
no verdict rather than half a comparison."
```

---

### Task 8: Wire the command, document it, and smoke it live

**Files:**
- Modify: `services/api/package.json` (scripts)
- Create: `services/api/eval/discovery-ab/runs/.gitkeep`
- Modify: `docs/guides/development-reference.md` (command reference)

**Interfaces:**
- Consumes: everything above.
- Produces: `bun run eval:discovery-ab` in `services/api`.

- [ ] **Step 1: Add the script**

```json
"eval:discovery-ab": "bun --env-file=../../.env.test ./src/cli/discovery-ab.ts"
```

Match the existing `eval:discovery-env-matrix` entry's env-file convention exactly.

- [ ] **Step 2: Verify the command refuses without its gate**

```bash
cd services/api && bun run eval:discovery-ab
```
Expected: refuses, naming the missing confirm variable. It must not reach a database.

- [ ] **Step 3: Verify it refuses a non-A/B target**

Set `DISCOVERY_AB_CONFIRM=1` and a manifest whose side `a` points at the `dev` branch id.
Expected: `Neon control-plane side a identity is invalid`. Nothing is reset, nothing spawns.

- [ ] **Step 4: Create the two A/B branches**

Branch `eval-ab-a` and `eval-ab-b` from `eval-discovery-base` (Task 1), each with an endpoint on database `protocol_eval`. Record branch and endpoint ids in the manifest.

- [ ] **Step 5: Live smoke — one case, one repetition**

```bash
cd services/api
DISCOVERY_AB_CONFIRM=1 DISCOVERY_AB_TARGETS='<manifest>' \
  bun run eval:discovery-ab -- --case <first case id> --runs 1 \
  --a DISCOVERY_ALLOWED_TYPES=intent \
  --b DISCOVERY_ALLOWED_TYPES=intent,profile
```

Expected: 4 graph invocations (1 case × 1 rep × 2 sides, plus judge), ~2 minutes, one artifact under `eval/discovery-ab/runs/`. Inspect it: two rules, both configs recorded, diff present, `completeness.complete === true`.

- [ ] **Step 6: Document the command**

Add to `docs/guides/development-reference.md` beside the existing matrix entry: what it compares, the required gate and manifest, the nine offerable flags, and the cost of a default run (15 cases × 3 reps × 2 sides ≈ 90 invocations, ~40 min). State plainly that the other seven allowlisted flags are not readable by this harness and link IND-630.

- [ ] **Step 7: Full suite, then commit**

```bash
cd services/api && bun run test && bun run lint && bunx tsc --noEmit
git add services/api/package.json services/api/eval/discovery-ab docs/guides/development-reference.md
git commit -m "feat(eval): ship the discovery A/B command with a live smoke

Documents what it compares, what it costs, and - as plainly - the seven
allowlisted flags it cannot read, so the next reader does not assume the
editor covers all sixteen."
```

---

## Self-Review

**Spec coverage.** §4 nine flags → Task 2. §5 architecture (bootstrap, reset, per-side process, aggregate) → Tasks 5–7. §5 clone-not-reseed → Task 1. §6 shared selection and identical-config refusal → Task 4. §7 scoring and artifact (`rules` = sides, `configs` block) → Tasks 6–7. §8 three safety gates → Task 7 step 3 (confirm), Task 5 (branch allowlist), Task 7 step 3 (reset before). §9 failure modes → Task 7 steps 3 and 5, Task 6 step 2 (failed-slot fallback). §10 testing → Tasks 2–5, 7, and the live smoke in Task 8. §11 sequencing → Task 1 first, branches created in Task 8 step 4. Appendix A → Task 8 step 6.

**Placeholder scan.** `<manifest>` and `<first case id>` in Task 8 are operator inputs that only exist after Task 8 step 4; every code step contains real code. Task 1 step 3 defers exact flags to the command's own parser rather than guessing them — deliberate, and the step says how to find them.

**Type consistency.** `AbEnvConfig`, `AbSide`, `AbSideId`, `AbSlot`, `AbTarget`, `AbManifest` are defined once (Tasks 2, 4, 5) and used with those names throughout. `withDiscoveryEnvironment` keeps one signature across Tasks 3 and 6. `rowId` carries the side id into `scoreMatrixSlot` in Task 6, which is what makes `payload.rules` the two sides in Task 7.
