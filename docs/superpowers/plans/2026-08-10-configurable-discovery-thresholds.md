# Configurable Discovery Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make semantic retrieval similarity and evaluator admission thresholds deployment-configurable while preserving current defaults and restricting explicit overrides to eval/test graph composition.

**Architecture:** Centralized protocol accessors strictly parse both environment variables, while API startup mirrors the same range contract to fail invalid deployments before serving. `OpportunityGraphFactory` resolves validated construction-time thresholds once, uses them across semantic retrieval/evaluation and tracing, and keeps non-semantic direct-target and human-curated introduction scoring unchanged. The public per-run `minScore` option is removed as an intentional protocol v11 breaking change.

**Tech Stack:** TypeScript, Bun test runner, LangGraph, Zod, protocol capability facades, API startup environment validation.

## Global Constraints

- `DISCOVERY_MIN_SIMILARITY` is a finite decimal in inclusive range `0..1`; absent/blank defaults to `0.30`.
- `DISCOVERY_EVALUATOR_MIN_SCORE` is a finite decimal in inclusive range `0..100`; absent/blank defaults to `50`.
- Invalid values fail API startup and protocol graph construction; never clamp or silently fall back.
- Constructor overrides take precedence over environment values and are permitted only in eval/test composition.
- Production queue, MCP, tool-service, foreground, and negotiation-worker composition must omit overrides.
- Remove `OpportunityGraphOptions.minScore`; production requests cannot override deployment policy.
- Semantic thresholds do not bypass `accepted: false`, claim safety, actor validation, persistence admission, or negotiation guards.
- Direct-target discovery retains score floor `50`; human-curated `create_introduction` retains `minScore: 0` and fallback behavior.
- Do not mutate Railway variables, `.env.development`, or deployed state. Do not add default values to `.env.test`.
- Release the breaking protocol contract as `@indexnetwork/protocol` `11.0.0`; bump `services/api` to `0.79.0`; regenerate root `bun.lock`.
- Follow targeted validation; do not run database-backed tests because this change has no database-specific behavior.

---

## File map

- `packages/protocol/src/opportunity/discovery.env.ts`: canonical defaults, decimal parsing, range validation, and environment accessors.
- `packages/protocol/src/opportunity/tests/discovery.env.spec.ts`: accessor and validation contract tests.
- `packages/protocol/src/opportunity/application/opportunity.graph.ts`: constructor-time resolution, semantic threshold use, direct-path preservation, and trace output.
- `packages/protocol/src/opportunity/domain/opportunity.state.ts`: remove the public per-run evaluator threshold.
- `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`: graph configuration, strategy propagation, evaluator filtering, direct-path, and trace tests.
- `packages/protocol/src/opportunity/public/index.ts`: curated exports for threshold accessors and graph override type.
- `packages/protocol/src/capabilities/opportunities.facade.ts`: capability-level threshold exports.
- `packages/protocol/src/index.ts`: package-root threshold exports.
- `packages/protocol/architecture/exports.snapshot.json`: generated root-export inventory.
- `packages/protocol/architecture/consumer/public-api.ts`: generated consumer type-check fixture.
- `services/api/src/startup.env.ts`: fail-fast startup validation.
- `services/api/tests/startup.env.discovery-thresholds.spec.ts`: subprocess validation of valid and invalid startup values.
- `.env.example`: optional variable documentation.
- `services/api/src/cli/discovery.main.ts`: stop passing per-run evaluator score.
- `services/api/src/cli/discovery-env-matrix.main.ts`: inject fixed evaluator score at eval composition and remove per-run score.
- `services/api/src/cli/discovery-retrieval-smoke.main.ts`: inject fixed evaluator score at smoke composition.
- `services/api/src/cli/tests/discovery.child.spec.ts`: update A/B invocation expectation.
- `services/api/src/cli/tests/discovery-env-matrix.spec.ts`: update matrix invocation expectation.
- `services/api/tests/opportunity-threshold-composition.spec.ts`: static production-composition guard.
- `packages/protocol/package.json`, `services/api/package.json`, `bun.lock`: required version release changes.

---

### Task 1: Define and validate the environment contract

**Files:**
- Modify: `packages/protocol/src/opportunity/discovery.env.ts`
- Modify: `packages/protocol/src/opportunity/tests/discovery.env.spec.ts`
- Modify: `packages/protocol/src/opportunity/public/index.ts`
- Modify: `packages/protocol/src/capabilities/opportunities.facade.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `services/api/src/startup.env.ts`
- Create: `services/api/tests/startup.env.discovery-thresholds.spec.ts`
- Modify: `.env.example`
- Test: `services/api/tests/env-example-drift.spec.ts`

**Interfaces:**
- Produces: `DISCOVERY_MIN_SIMILARITY_DEFAULT: 0.3`.
- Produces: `DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT: 50`.
- Produces: `discoveryMinSimilarity(): number`.
- Produces: `discoveryEvaluatorMinScore(): number`.
- Produces: `validateDiscoveryMinSimilarity(value: number): number`.
- Produces: `validateDiscoveryEvaluatorMinScore(value: number): number`.
- Consumes: raw `process.env.DISCOVERY_MIN_SIMILARITY` and `process.env.DISCOVERY_EVALUATOR_MIN_SCORE` strings.

- [ ] **Step 1: Extend accessor tests with defaults, valid decimals, boundaries, and invalid input**

Add both variable names to the saved/restored `VARS` list, import the six produced symbols, and add focused cases equivalent to:

```ts
describe('discovery thresholds', () => {
  it('uses existing defaults for absent and blank values', () => {
    delete process.env.DISCOVERY_MIN_SIMILARITY;
    process.env.DISCOVERY_EVALUATOR_MIN_SCORE = '   ';
    expect(discoveryMinSimilarity()).toBe(DISCOVERY_MIN_SIMILARITY_DEFAULT);
    expect(discoveryEvaluatorMinScore()).toBe(DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT);
  });

  it('parses finite decimal values and inclusive boundaries', () => {
    for (const [raw, expected] of [['0', 0], ['.35', 0.35], ['1.0', 1]] as const) {
      process.env.DISCOVERY_MIN_SIMILARITY = raw;
      expect(discoveryMinSimilarity()).toBe(expected);
    }
    for (const [raw, expected] of [['0', 0], ['62.5', 62.5], ['100', 100]] as const) {
      process.env.DISCOVERY_EVALUATOR_MIN_SCORE = raw;
      expect(discoveryEvaluatorMinScore()).toBe(expected);
    }
  });

  it.each(['nope', 'NaN', 'Infinity', '0x1', '-0.01', '1.01'])(
    'rejects invalid similarity %s',
    (raw) => {
      process.env.DISCOVERY_MIN_SIMILARITY = raw;
      expect(() => discoveryMinSimilarity()).toThrow('DISCOVERY_MIN_SIMILARITY');
    },
  );

  it.each(['nope', 'NaN', 'Infinity', '0x32', '-1', '100.01'])(
    'rejects invalid evaluator score %s',
    (raw) => {
      process.env.DISCOVERY_EVALUATOR_MIN_SCORE = raw;
      expect(() => discoveryEvaluatorMinScore()).toThrow('DISCOVERY_EVALUATOR_MIN_SCORE');
    },
  );
});
```

Also test `validateDiscoveryMinSimilarity(0.42)`, `validateDiscoveryEvaluatorMinScore(63)`, and rejection of non-finite/out-of-range numeric constructor values.

- [ ] **Step 2: Run the accessor test and verify RED**

Run:

```bash
cd packages/protocol
bun test src/opportunity/tests/discovery.env.spec.ts
```

Expected: FAIL because the constants/accessors/validators are not exported.

- [ ] **Step 3: Implement strict shared parsing in `discovery.env.ts`**

Add strict decimal syntax and named range validation without changing the existing allowed-type/profile-source fallback behavior:

```ts
export const DISCOVERY_MIN_SIMILARITY_DEFAULT = 0.30;
export const DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT = 50;

const DECIMAL_VALUE = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function validateThreshold(name: string, value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${name} must be a finite decimal between 0 and ${max} (inclusive)`);
  }
  return value;
}

function readThreshold(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim();
  if (!DECIMAL_VALUE.test(normalized)) {
    throw new Error(`${name} must be a finite decimal between 0 and ${max} (inclusive)`);
  }
  return validateThreshold(name, Number(normalized), max);
}

export function validateDiscoveryMinSimilarity(value: number): number {
  return validateThreshold('DISCOVERY_MIN_SIMILARITY', value, 1);
}

export function validateDiscoveryEvaluatorMinScore(value: number): number {
  return validateThreshold('DISCOVERY_EVALUATOR_MIN_SCORE', value, 100);
}

export function discoveryMinSimilarity(): number {
  return readThreshold('DISCOVERY_MIN_SIMILARITY', DISCOVERY_MIN_SIMILARITY_DEFAULT, 1);
}

export function discoveryEvaluatorMinScore(): number {
  return readThreshold('DISCOVERY_EVALUATOR_MIN_SCORE', DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT, 100);
}
```

Export the constants, accessors, and validators through the opportunity public index, capability facade, and package root alongside the existing discovery env exports.

- [ ] **Step 4: Run accessor tests and verify GREEN**

Run:

```bash
cd packages/protocol
bun test src/opportunity/tests/discovery.env.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write API startup subprocess tests**

Create `services/api/tests/startup.env.discovery-thresholds.spec.ts`. Spawn a fresh Bun process per case so `startup.env.ts` can call `process.exit(1)` safely:

```ts
import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const apiRoot = path.resolve(import.meta.dir, '..');

async function validateStartup(overrides: Record<string, string>) {
  const env = { ...process.env };
  delete env.DISCOVERY_MIN_SIMILARITY;
  delete env.DISCOVERY_EVALUATOR_MIN_SCORE;
  Object.assign(env, { NODE_ENV: 'test' }, overrides);
  const child = Bun.spawn({
    cmd: [process.execPath, '-e', "await import('./src/startup.env.ts')"],
    cwd: apiRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe('discovery threshold startup validation', () => {
  it.each([
    ['DISCOVERY_MIN_SIMILARITY', ''],
    ['DISCOVERY_MIN_SIMILARITY', '0.42'],
    ['DISCOVERY_EVALUATOR_MIN_SCORE', '63.5'],
  ])('accepts %s=%s', async (name, value) => {
    expect((await validateStartup({ [name]: value })).exitCode).toBe(0);
  });

  it.each([
    ['DISCOVERY_MIN_SIMILARITY', '1.01'],
    ['DISCOVERY_MIN_SIMILARITY', '0x1'],
    ['DISCOVERY_EVALUATOR_MIN_SCORE', '101'],
    ['DISCOVERY_EVALUATOR_MIN_SCORE', 'NaN'],
  ])('rejects %s=%s', async (name, value) => {
    const result = await validateStartup({ [name]: value });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(name);
  });
});
```

The explicit deletes ensure a developer's shell cannot contaminate another case.

- [ ] **Step 6: Run startup tests and verify RED**

Run:

```bash
cd services/api
NODE_ENV=test bun test tests/startup.env.discovery-thresholds.spec.ts
```

Expected: FAIL because startup validation does not yet constrain either variable.

- [ ] **Step 7: Register strict API startup schemas and document the variables**

Add a local reusable Zod helper near the other optional helpers:

```ts
const decimalValue = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const optionalDecimalInRange = (max: number) => z.string().refine((raw) => {
  const normalized = raw.trim();
  if (normalized === '') return true;
  if (!decimalValue.test(normalized)) return false;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && value <= max;
}, `expected a finite decimal between 0 and ${max} (inclusive)`).optional();
```

Register:

```ts
DISCOVERY_MIN_SIMILARITY: optionalDecimalInRange(1),
DISCOVERY_EVALUATOR_MIN_SCORE: optionalDecimalInRange(100),
```

Document commented optional defaults in `.env.example` beside the existing discovery variables:

```dotenv
# DISCOVERY_MIN_SIMILARITY=0.30             # Semantic retrieval cutoff, 0..1 (default: 0.30)
# DISCOVERY_EVALUATOR_MIN_SCORE=50          # Accepted evaluator score floor, 0..100 (default: 50)
```

Do not edit active environment files.

- [ ] **Step 8: Run focused environment verification**

Run:

```bash
cd services/api
NODE_ENV=test bun test tests/startup.env.discovery-thresholds.spec.ts tests/env-example-drift.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the environment contract**

```bash
git add .env.example \
  packages/protocol/src/opportunity/discovery.env.ts \
  packages/protocol/src/opportunity/tests/discovery.env.spec.ts \
  packages/protocol/src/opportunity/public/index.ts \
  packages/protocol/src/capabilities/opportunities.facade.ts \
  packages/protocol/src/index.ts \
  services/api/src/startup.env.ts \
  services/api/tests/startup.env.discovery-thresholds.spec.ts
git commit -m "feat(protocol): configure discovery thresholds"
```

---

### Task 2: Apply thresholds in the opportunity graph

**Files:**
- Modify: `packages/protocol/src/opportunity/application/opportunity.graph.ts`
- Modify: `packages/protocol/src/opportunity/domain/opportunity.state.ts`
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`
- Modify: `packages/protocol/src/opportunity/public/index.ts`
- Modify: `packages/protocol/src/capabilities/opportunities.facade.ts`
- Modify: `packages/protocol/src/index.ts`
- Generate when exports change: `packages/protocol/architecture/exports.snapshot.json`
- Generate when exports change: `packages/protocol/architecture/consumer/public-api.ts`
- Test: `packages/protocol/src/opportunity/tests/opportunity.evaluator.spec.ts`

**Interfaces:**
- Consumes: all six threshold exports from Task 1.
- Produces: `OpportunityGraphThresholdOverrides` with optional `retrievalMinSimilarity` and `evaluatorMinScore` numbers.
- Produces: an optional final `OpportunityGraphFactory` constructor argument for eval/test composition.
- Removes: `OpportunityGraphOptions.minScore`.

- [ ] **Step 1: Add failing graph tests for retrieval, evaluation, tracing, and override precedence**

Extend the shared graph fixture so tests can inject `thresholdOverrides` at factory construction and capture evaluator options. Add focused assertions equivalent to:

```ts
const thresholds = {
  retrievalMinSimilarity: 0.42,
  evaluatorMinScore: 63,
};
const { compiledGraph, mockEmbedder, evaluatorCalls } = createMockGraph({
  thresholdOverrides: thresholds,
  evaluatorResult: [{ ...defaultMockEvaluatorResult[0], score: 62 }],
});
const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');
const result = await compiledGraph.invoke({
  userId: SOURCE_ID,
  searchQuery: 'co-founder',
  options: {},
});
expect(searchSpy.mock.calls[0]?.[1]?.minScore).toBe(0.42);
expect(evaluatorCalls[0]?.minScore).toBe(63);
expect(result.opportunities).toEqual([]);
expect(result.trace).toContainEqual(expect.objectContaining({
  node: 'threshold_filter',
  data: expect.objectContaining({
    retrievalMinSimilarity: 0.42,
    evaluatorMinScore: 63,
  }),
}));
```

Add strategy-specific spies proving the same retrieval value reaches `searchPremisesBySimilarity`, `searchIntentsByContextEmbedding`, and `searchUserContextsBySimilarity`, in addition to `searchWithHydeEmbeddings`.

Add environment-precedence coverage by setting both env variables to one pair, constructing once without overrides and once with overrides, and proving constructor values win only in the second graph.

Add direct-path coverage proving a graph constructed with evaluator override `80` still invokes direct-target evaluation with `50`; retain the existing human-curated introduction assertion that invokes its evaluator with `0`.

Add invalid override tests expecting `createGraph()` to throw for `NaN`, negative, or above-range values.

- [ ] **Step 2: Run focused graph tests and verify RED**

Run:

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts
```

Expected: FAIL because graph constructor overrides and trace fields do not exist and retrieval remains hardcoded.

- [ ] **Step 3: Add constructor-time threshold resolution**

Export the configuration type from `opportunity.graph.ts`:

```ts
export interface OpportunityGraphThresholdOverrides {
  retrievalMinSimilarity?: number;
  evaluatorMinScore?: number;
}
```

Append it as the final optional constructor dependency so existing production construction remains source-compatible:

```ts
constructor(
  // existing dependencies unchanged
  private stampNewbornOpportunities?: StampNewbornOpportunitiesFn,
  private thresholdOverrides?: OpportunityGraphThresholdOverrides,
) {}
```

At the start of `createGraph()`, resolve and validate once:

```ts
const retrievalMinSimilarity = this.thresholdOverrides?.retrievalMinSimilarity === undefined
  ? discoveryMinSimilarity()
  : validateDiscoveryMinSimilarity(this.thresholdOverrides.retrievalMinSimilarity);
const evaluatorMinScore = this.thresholdOverrides?.evaluatorMinScore === undefined
  ? discoveryEvaluatorMinScore()
  : validateDiscoveryEvaluatorMinScore(this.thresholdOverrides.evaluatorMinScore);
```

Export the override type through the opportunity public index, capability facade, and package root with `export type`.

- [ ] **Step 4: Replace every semantic retrieval literal**

Remove the local `const minScore = 0.3`. Pass `retrievalMinSimilarity` explicitly to every semantic search call in query, premise, context-to-intent fallback, and context-to-context paths. Do not alter generic adapter defaults in `services/api/src/adapters/embedder.adapter.ts` or unrelated database interfaces.

Use the descriptive property directly:

```ts
minScore: retrievalMinSimilarity,
```

Do not pass it to direct-target discovery, which bypasses vector search.

- [ ] **Step 5: Apply evaluator threshold without changing direct modes**

Replace the evaluation-node default with path-aware resolution:

```ts
const minScore = state.targetUserId
  ? DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT
  : evaluatorMinScore;
```

Continue supplying that value to `invokeEntityBundle` and the graph's deterministic score filters. Do not change evaluator reconciliation: only categorically accepted verdicts may reach score filtering. Leave `introEvaluationNode` at explicit `minScore: 0`.

Remove the `minScore?: number` field and default comment from `OpportunityGraphOptions` in `opportunity.state.ts`.

- [ ] **Step 6: Correct threshold trace data**

Replace the hardcoded `0.40` comparisons/detail/data with the effective retrieval value and add both effective fields:

```ts
const aboveThreshold = batchToEvaluate.filter(
  (candidate) => candidate.similarity >= retrievalMinSimilarity,
).length;

traceEntries.push({
  node: 'threshold_filter',
  detail: `${aboveThreshold} above ${retrievalMinSimilarity}, ${belowThreshold} below (batch of ${batchToEvaluate.length})`,
  data: {
    aboveThreshold,
    belowThreshold,
    minScore: retrievalMinSimilarity,
    retrievalMinSimilarity,
    evaluatorMinScore: minScore,
  },
});
```

Keep `data.minScore` as a compatibility alias for existing trace consumers while adding the unambiguous fields.

- [ ] **Step 7: Migrate protocol graph tests off per-run `options.minScore`**

For every `opportunity.graph.spec.ts` invocation that currently uses `options: { minScore: N }`, move `N` into the test graph factory's `thresholdOverrides.evaluatorMinScore` and leave only unrelated runtime options in `options`. Do not change isolated `OpportunityEvaluator.invokeEntityBundle(..., { minScore })` tests because that component-level API remains supported.

Where many tests share `70`, update the test helper once rather than mutating process environment:

```ts
function createMockGraph(deps?: {
  // existing fields
  thresholdOverrides?: OpportunityGraphThresholdOverrides;
}) {
  // existing fixture
  const factory = new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHydeGenerator,
    evaluator,
    queueNotification,
    undefined,
    undefined,
    undefined,
    undefined,
    deps?.thresholdOverrides,
  );
  // ...
}
```

Use explicit constructor overrides only in this test helper and dedicated eval composition.

- [ ] **Step 8: Run protocol tests and build**

Run:

```bash
cd packages/protocol
bun test src/opportunity/tests/discovery.env.spec.ts \
  src/opportunity/tests/opportunity.graph.spec.ts \
  src/opportunity/tests/opportunity.evaluator.spec.ts
bun run build
bun run architecture:exports
bun run architecture:consumer
```

Expected: all commands PASS; export inventory reports no uncommitted generated changes unless the curated public exports legitimately require an inventory update. If `architecture:exports` reports a generated inventory change, regenerate with `bun run architecture:exports:update`, inspect it, and include only the threshold exports.

- [ ] **Step 9: Commit graph behavior**

```bash
git add packages/protocol/src/opportunity/application/opportunity.graph.ts \
  packages/protocol/src/opportunity/domain/opportunity.state.ts \
  packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts \
  packages/protocol/src/opportunity/public/index.ts \
  packages/protocol/src/capabilities/opportunities.facade.ts \
  packages/protocol/src/index.ts
git add packages/protocol/architecture/exports.snapshot.json \
  packages/protocol/architecture/consumer/public-api.ts
git commit -m "feat(protocol): apply configurable discovery thresholds"
```

Omit the second `git add` command when `architecture:exports` reports no generated inventory change.

---

### Task 3: Migrate eval tooling and enforce the production boundary

**Files:**
- Modify: `services/api/src/cli/discovery.main.ts`
- Modify: `services/api/src/cli/discovery-env-matrix.main.ts`
- Modify: `services/api/src/cli/discovery-retrieval-smoke.main.ts`
- Modify: `services/api/src/cli/tests/discovery.child.spec.ts`
- Modify: `services/api/src/cli/tests/discovery-env-matrix.spec.ts`
- Create: `services/api/tests/opportunity-threshold-composition.spec.ts`
- Inspect without override changes: `services/api/src/queues/opportunity/discovery.shared.ts`
- Inspect without override changes: `services/api/src/queues/negotiations/run-existing.queue.ts`
- Inspect without override changes: `services/api/src/controllers/mcp.controller.ts`
- Inspect without override changes: `services/api/src/services/tool.service.ts`
- Inspect without override changes: `packages/protocol/src/runtime/foreground/composition/tool.factory.ts`

**Interfaces:**
- Consumes: `OpportunityGraphThresholdOverrides` and the final constructor argument from Task 2.
- Removes: all graph invocation payloads containing `options.minScore`.
- Preserves: deterministic evaluator score `50` for discovery A/B, matrix, and smoke tooling through composition-time override.

- [ ] **Step 1: Update eval invocation tests to expect no per-run threshold**

Change provider-free expectations in `discovery.child.spec.ts` and `discovery-env-matrix.spec.ts` from:

```ts
options: { minScore: 50 }
```

to:

```ts
options: {}
```

Retain every user/network/intent assertion.

- [ ] **Step 2: Add a static production-composition guard test**

Create `services/api/tests/opportunity-threshold-composition.spec.ts` that reads every production composition file listed above and rejects constructor override property names:

```ts
import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../../..');
const productionCompositions = [
  'services/api/src/queues/opportunity/discovery.shared.ts',
  'services/api/src/queues/negotiations/run-existing.queue.ts',
  'services/api/src/controllers/mcp.controller.ts',
  'services/api/src/services/tool.service.ts',
  'packages/protocol/src/runtime/foreground/composition/tool.factory.ts',
] as const;

describe('production opportunity threshold composition', () => {
  for (const relativePath of productionCompositions) {
    it(`${relativePath} does not inject eval/test thresholds`, async () => {
      const source = await Bun.file(path.join(root, relativePath)).text();
      expect(source).not.toContain('retrievalMinSimilarity:');
      expect(source).not.toContain('evaluatorMinScore:');
    });
  }
});
```

This guards the exact constructor object keys while allowing the production graph to read deployment env through the protocol accessors.

- [ ] **Step 3: Run CLI and boundary tests and verify RED**

Run:

```bash
cd services/api
NODE_ENV=test bun test \
  src/cli/tests/discovery.child.spec.ts \
  src/cli/tests/discovery-env-matrix.spec.ts \
  tests/opportunity-threshold-composition.spec.ts
```

Expected: CLI expectation tests FAIL while production composition guard passes.

- [ ] **Step 4: Move fixed eval scores to graph construction**

In `createChildDependencies()` in `discovery-env-matrix.main.ts`, construct the graph with a final override:

```ts
const opportunityGraph = new OpportunityGraphFactory(
  graphDb,
  embedder,
  hydeGraph,
  new OpportunityEvaluator(),
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  { evaluatorMinScore: 50 },
).createGraph();
```

In `discovery-retrieval-smoke.main.ts`, use the same final constructor position with `{ evaluatorMinScore: 50 }` after the existing deterministic evaluator and optional dependencies.

Remove `AB_MIN_SCORE` from graph invocation payloads in `discovery.main.ts`, and change the `invokeAbDiscoveryGraph` input type and body to `options: {}`. Keep the separate `AB_MIN_SCORE = 50` used by `projectFinalCandidates`; it is eval projection policy, not graph runtime input.

Change `invokeMatrixDiscoveryGraph` in `discovery-env-matrix.main.ts` to use `options: {}` and update its structural graph input type accordingly.

- [ ] **Step 5: Prove no per-run graph threshold remains**

Run:

```bash
rg -nU "options:\s*\{[^}]*minScore|minScore:\s*(AB_MIN_SCORE|50)" \
  services/api/src/cli \
  packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
```

Expected: no graph invocation payload matches. Matches in direct evaluator calls, score projection helpers, or unrelated search adapters are acceptable only after inspecting each result.

- [ ] **Step 6: Run API CLI tests, static guard, typecheck, lint, and build**

Run:

```bash
cd services/api
NODE_ENV=test bun test \
  tests/startup.env.discovery-thresholds.spec.ts \
  tests/env-example-drift.spec.ts \
  tests/opportunity-threshold-composition.spec.ts \
  src/cli/tests/discovery.child.spec.ts \
  src/cli/tests/discovery-env-matrix.spec.ts
bun run typecheck:cli-specs
bun run lint
bun run build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit eval migration and production guard**

```bash
git add services/api/src/cli/discovery.main.ts \
  services/api/src/cli/discovery-env-matrix.main.ts \
  services/api/src/cli/discovery-retrieval-smoke.main.ts \
  services/api/src/cli/tests/discovery.child.spec.ts \
  services/api/src/cli/tests/discovery-env-matrix.spec.ts \
  services/api/tests/opportunity-threshold-composition.spec.ts
git commit -m "refactor(api): restrict discovery threshold overrides"
```

---

### Task 4: Version, clean planning artifacts, and verify the branch

**Files:**
- Modify: `packages/protocol/package.json`
- Modify: `services/api/package.json`
- Modify: `bun.lock`
- Delete before PR: `docs/superpowers/specs/2026-08-10-configurable-discovery-thresholds-design.md`
- Delete before PR: `docs/superpowers/plans/2026-08-10-configurable-discovery-thresholds.md`

**Interfaces:**
- Produces: published protocol version `11.0.0` for removal of `OpportunityGraphOptions.minScore`.
- Produces: API version `0.79.0` for startup/environment functionality.
- Produces: a lockfile consistent with both manifests.

- [ ] **Step 1: Bump package versions and regenerate the lockfile**

Update only the package version fields:

```json
// packages/protocol/package.json
"version": "11.0.0"

// services/api/package.json
"version": "0.79.0"
```

Then run from repository root:

```bash
bun install --lockfile-only
```

Inspect `git diff -- bun.lock` and confirm it reflects only the two workspace version changes and required lock metadata.

- [ ] **Step 2: Remove temporary superpowers artifacts per repository policy**

```bash
git rm \
  docs/superpowers/specs/2026-08-10-configurable-discovery-thresholds-design.md \
  docs/superpowers/plans/2026-08-10-configurable-discovery-thresholds.md
```

Do not remove permanent `.env.example` documentation.

- [ ] **Step 3: Run final targeted protocol verification**

```bash
cd packages/protocol
bun test src/opportunity/tests/discovery.env.spec.ts \
  src/opportunity/tests/opportunity.graph.spec.ts \
  src/opportunity/tests/opportunity.evaluator.spec.ts
bun run build
bun run architecture:exports
bun run architecture:consumer
```

Expected: all commands PASS with no generated inventory drift.

- [ ] **Step 4: Run final targeted API verification**

```bash
cd services/api
NODE_ENV=test bun test \
  tests/startup.env.discovery-thresholds.spec.ts \
  tests/env-example-drift.spec.ts \
  tests/opportunity-threshold-composition.spec.ts \
  src/cli/tests/discovery.child.spec.ts \
  src/cli/tests/discovery-env-matrix.spec.ts
bun run typecheck:cli-specs
bun run lint
bun run build
```

Expected: all commands PASS. No database URL safety override or database-backed test is needed.

- [ ] **Step 5: Audit environment and diff scope**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/dev...HEAD
rg -n "^DISCOVERY_(MIN_SIMILARITY|EVALUATOR_MIN_SCORE)=" \
  .env.development .env.test 2>/dev/null || true
```

Expected:

- `git diff --check` is clean;
- active env files contain no newly committed threshold activation;
- no Railway mutation has occurred;
- only protocol, API, `.env.example`, versions, lockfile, tests, and intentional generated inventory are changed;
- temporary superpowers spec/plan are absent from the final diff.

- [ ] **Step 6: Commit versioning and cleanup**

```bash
git add packages/protocol/package.json services/api/package.json bun.lock
git add -u docs/superpowers
git commit -m "chore: version configurable discovery thresholds"
```

- [ ] **Step 7: Request code review before push/PR closeout**

Invoke `superpowers:requesting-code-review`, resolve all findings, rerun the affected command for every fix, and only then continue with the repository `run-worktree-session` verify/commit/push/PR workflow. Report exact commands, pass counts, changed files, and the residual fact that changing deployment values later is a separate approved operational action.
