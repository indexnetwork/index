# Protocol Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free, graphical Guided Atlas that explains only `packages/protocol`, with curated protocol narratives, a deterministic protocol-source inventory, and a source-evidenced simulator for protocol behavior gates.

**Architecture:** A classic-script static microsite under `docs/protocol-atlas/` reads one hand-authored content global and one generated inventory global. A protocol-only Bun generator validates selected package exports, source paths, capability ownership, typed relationships, curated references, and the evidence join for 20 hand-reviewed configuration experiments; a pure browser/Bun core owns routing, search, filters, selection, and configuration-comparison state; a thin DOM layer renders the Technical Blueprint experience.

**Tech Stack:** Bun 1.3, TypeScript 5.9 compiler API, vanilla HTML/CSS/JavaScript, SVG, `bun:test`, existing protocol architecture scripts.

## Global Constraints

- Explain only `packages/protocol`; do not inspect, generate, or display API controllers, services, adapters, queues, routes, persistence, or deployment architecture.
- External hosts may appear only as requirements derived from protocol-owned ports or callbacks; stop at the injected boundary.
- Generated evidence paths must be repository-relative and begin with `packages/protocol/`.
- Keep the site dependency-free and functional from both `file://` and an ordinary static HTTP server.
- Make no external network requests at runtime.
- Preserve explicit Protocol and Implementation layers and the normative/product/internal vocabulary legend.
- Never depict an internal candidate as surfaced, or agent negotiation acceptance as participant consent.
- Use stable IDs, deterministic sorting, atomic generated writes, and no timestamps or line numbers.
- Keep the first release to exactly seven chapters, five guided flows, 20 approved configuration experiments, and a selected core inventory—not a full package catalog.
- The Configuration Lab compares named, non-secret assignments with source-defined package fallbacks; never read `.env`, `process.env` values, deployed configuration, Railway state, or runtime telemetry.
- A configuration comparison is explanatory only and must never imply that disabled, bypassed, omitted, or unresolved behavior is deprecated or removable.
- Meet WCAG 2.2 AA contrast for text and controls; support keyboard use, visible focus, SVG descriptions, reduced motion, and narrow layouts.
- Follow the repository's targeted-validation policy; do not run database-backed tests.

---

## File Structure

### Protocol architecture metadata

- Create `packages/protocol/scripts/architecture/capability-model.ts` — reusable capability names, canonical/legacy directory normalization, allowed directions, and source-path classification.
- Modify `packages/protocol/scripts/architecture/capability-boundaries.ts` — consume the shared model without changing the architecture gate's behavior.
- Create `packages/protocol/scripts/architecture/tests/capability-model.spec.ts` — lock canonical, compatibility, runtime-shell, and neutral shared classifications.

### Generator and tests

- Create `scripts/build-protocol-atlas.ts` — pure data contracts, selected core manifest, protocol-only source loading, curated configuration-evidence join, validation, deterministic JavaScript serialization, write/check/stdout CLI.
- Create `scripts/tests/build-protocol-atlas.spec.ts` — generator, boundary, determinism, cross-reference, configuration evidence, environment-independence, and stale-artifact tests.
- Modify `package.json` — add `build:protocol-atlas` and `check:protocol-atlas` scripts.

### Static atlas

- Create `docs/protocol-atlas/index.html` — semantic shell, landmarks, fallback, and classic asset ordering.
- Create `docs/protocol-atlas/atlas.css` — Technical Blueprint visual system and responsive/accessibility states.
- Create `docs/protocol-atlas/atlas-core.js` — environment-neutral global with data validation, routing, transition, search, graph filtering, and pure configuration comparison.
- Create `docs/protocol-atlas/atlas.js` — DOM bootstrap, chapter/step rendering, SVG diagrams, inspector, Configuration Lab, controls, history, and graceful degradation.
- Create `docs/protocol-atlas/atlas-content.js` — seven chapters, five flows, concepts, invariants, vocabulary, conceptual relationships, and the authoritative 20-experiment configuration manifest.
- Create `docs/protocol-atlas/protocol.generated.js` — committed schema-2 output with the source-validated configuration evidence join; never hand-edit.
- Create `scripts/tests/protocol-atlas-core.spec.ts` — pure behavior tests for the classic-script core.

### Release/documentation

- Modify `packages/protocol/package.json` — patch version bump because protocol architecture tooling changes.
- Modify `packages/protocol/CHANGELOG.md` — record the architecture metadata extraction and atlas.
- Modify `bun.lock` — regenerate after the package version changes.
- Keep the related spec and plan through every task review and the whole-branch review. After review is clean, the coordinator deletes both immediately before branch closeout, as required by repository policy.

---

### Task 1: Extract reusable protocol capability metadata

**Files:**
- Create: `packages/protocol/scripts/architecture/capability-model.ts`
- Modify: `packages/protocol/scripts/architecture/capability-boundaries.ts`
- Create: `packages/protocol/scripts/architecture/tests/capability-model.spec.ts`

**Interfaces:**
- Produces:
  - `Capability` union type.
  - `CAPABILITY_DIRECTORIES: Readonly<Record<string, Capability>>`.
  - `ALLOWED_CAPABILITY_DIRECTIONS: Readonly<Record<Capability, readonly Capability[]>>`.
  - `DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES: ReadonlySet<Capability>`.
  - `capabilityForSourcePath(pathFromSource: string): Capability | undefined`.
  - `implementationCapabilityForSourcePath(pathFromSource: string): Capability | undefined`.
  - `facadeCapabilityForSourcePath(pathFromSource: string): Capability | undefined`.
- Consumed by: `capability-boundaries.ts` and Task 2's atlas generator.

- [ ] **Step 1: Write the failing capability-model tests**

```ts
import { describe, expect, test } from "bun:test";

import {
  capabilityForSourcePath,
  facadeCapabilityForSourcePath,
  implementationCapabilityForSourcePath,
} from "../capability-model.ts";

describe("protocol capability model", () => {
  test("normalizes canonical and compatibility directories", () => {
    expect(capabilityForSourcePath("signals/application/intent.graph.ts")).toBe("signals");
    expect(capabilityForSourcePath("intent/intent.graph.ts")).toBe("signals");
    expect(capabilityForSourcePath("participant-context/domain/index.ts")).toBe("participant-context");
    expect(capabilityForSourcePath("enrichment/enrichment.graph.ts")).toBe("participant-context");
    expect(capabilityForSourcePath("communities/application/network.graph.ts")).toBe("communities");
    expect(capabilityForSourcePath("network/network.graph.ts")).toBe("communities");
    expect(capabilityForSourcePath("participant-agents/application/agent.tools.ts")).toBe("participant-agents");
    expect(capabilityForSourcePath("chat/chat.graph.ts")).toBe("participant-agents");
  });

  test("classifies protocol runtime shells without inventing host components", () => {
    expect(capabilityForSourcePath("runtime/foreground/composition/tool.registry.ts")).toBe("interaction-composition");
    expect(capabilityForSourcePath("runtime/background/index.ts")).toBe("ambient-background");
    expect(capabilityForSourcePath("platform/index.ts")).toBe("neutral-platform");
    expect(capabilityForSourcePath("public/index.ts")).toBe("public-compatibility");
  });

  test("recognizes capability facades and leaves neutral shared code unclassified", () => {
    expect(facadeCapabilityForSourcePath("capabilities/opportunities.facade.ts")).toBe("opportunities");
    expect(facadeCapabilityForSourcePath("capabilities/negotiation.discovery.facade.ts")).toBe("negotiation");
    expect(implementationCapabilityForSourcePath("shared/hyde/hyde.graph.ts")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `cd packages/protocol && bun test scripts/architecture/tests/capability-model.spec.ts`  
Expected: FAIL because `capability-model.ts` does not exist.

- [ ] **Step 3: Create the shared capability model**

Move the existing `Capability`, `capabilityDirectories`, `allowedDirections`, and direct-implementation exemption definitions into the new module. Export uppercase immutable names and use repository-relative source paths rather than absolute paths:

```ts
export type Capability =
  | "signals"
  | "participant-context"
  | "communities"
  | "opportunities"
  | "negotiation"
  | "questions"
  | "participant-agents"
  | "contacts"
  | "integrations"
  | "interaction-composition"
  | "ambient-background"
  | "neutral-platform"
  | "public-compatibility";

export function capabilityForSourcePath(pathFromSource: string): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const [topLevel, second] = normalized.split("/");
  if (topLevel === "runtime") {
    if (second === "foreground") return "interaction-composition";
    if (second === "background") return "ambient-background";
    return undefined;
  }
  if (topLevel === "capabilities") return facadeCapabilityForSourcePath(normalized);
  if (topLevel === "shared" && /^shared\/agent\/tool\.(?:factory|registry|helpers)\.ts$/.test(normalized)) {
    return "interaction-composition";
  }
  return CAPABILITY_DIRECTORIES[topLevel];
}
```

Keep the exact current directory mappings and direction allowlist from `capability-boundaries.ts`; do not add new capability directions.

- [ ] **Step 4: Update the boundary gate to consume the shared model**

Replace local definitions with imports and pass `relative(sourceRoot, path)` into the shared functions. Preserve root-index special handling, import-type collection, facade-only enforcement, error text, and final summary.

- [ ] **Step 5: Run focused architecture validation**

Run:

```bash
cd packages/protocol
bun test scripts/architecture/tests/capability-model.spec.ts scripts/architecture/tests/module-graph.spec.ts
bun run architecture:capabilities
```

Expected: all tests PASS and the capability boundary summary remains unchanged.

- [ ] **Step 6: Commit the shared metadata seam**

```bash
git add packages/protocol/scripts/architecture/capability-model.ts \
  packages/protocol/scripts/architecture/capability-boundaries.ts \
  packages/protocol/scripts/architecture/tests/capability-model.spec.ts
git commit -m "refactor(protocol): share capability architecture metadata"
```

---

### Task 2: Build the protocol-only deterministic inventory generator

**Files:**
- Create: `scripts/build-protocol-atlas.ts`
- Create: `scripts/tests/build-protocol-atlas.spec.ts`
- Modify: `package.json`
- Create: `docs/protocol-atlas/protocol.generated.js`

**Interfaces:**
- Consumes from Task 1: capability classifier exports.
- Produces:

```ts
export type AtlasNodeKind =
  | "facade"
  | "tool-family"
  | "graph-factory"
  | "agent"
  | "port"
  | "runtime-shell"
  | "host-requirement"
  | "public-symbol";
export type AtlasEdgeKind = "static" | "runtime" | "injected" | "conceptual";
export type AtlasNode = {
  id: string;
  label: string;
  kind: AtlasNodeKind;
  layer: "implementation";
  capability: string;
  sourcePath: string;
  symbol?: string;
  stability?: "stable" | "experimental";
  chapterIds: string[];
  flowIds: string[];
  summary: string;
};
export type AtlasEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: AtlasEdgeKind;
  label: string;
  evidencePath: string;
  evidenceSymbol?: string;
};
export type AtlasArtifact = { schemaVersion: 1; nodes: AtlasNode[]; edges: AtlasEdge[] };
export type GeneratorInput = {
  exportInventory: { exports: Array<{ name: string; kind: "type" | "value"; stability: "stable" | "experimental"; source: string }> };
  components: Array<Omit<AtlasNode, "layer" | "stability"> & { rootExport?: string }>;
  edges: AtlasEdge[];
  sourceFiles: Record<string, string>;
};
export function loadProtocolGeneratorInput(repoRoot: string): Promise<GeneratorInput>;
export function buildAtlasArtifact(input: GeneratorInput): AtlasArtifact;
export function validateAtlasArtifact(artifact: AtlasArtifact, repoRoot: string): string[];
export function validateCuratedReferences(content: unknown, artifact: AtlasArtifact): string[];
export function serializeAtlasArtifact(artifact: AtlasArtifact): string;
```

- [ ] **Step 1: Write failing pure generator tests**

Cover deterministic sorting, package-only evidence, type-only/runtime distinction through the existing `runtimeModuleSpecifiers`, duplicate IDs, missing paths, unresolved edges, and JavaScript global serialization:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildAtlasArtifact,
  serializeAtlasArtifact,
  validateAtlasArtifact,
  type AtlasArtifact,
  type GeneratorInput,
} from "../build-protocol-atlas.ts";

const fixtureRoot = mkdtempSync(join(tmpdir(), "protocol-atlas-"));
const protocolSource = "packages/protocol/src/opportunity/application/opportunity.evaluator.ts";
mkdirSync(join(fixtureRoot, "packages/protocol/src/opportunity/application"), { recursive: true });
writeFileSync(join(fixtureRoot, protocolSource), "export class OpportunityEvaluator {}\n");
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function fixtureInput(overrides: { evidencePath?: string } = {}): GeneratorInput {
  return {
    exportInventory: {
      exports: [{
        name: "OpportunityEvaluator",
        kind: "value",
        stability: "stable",
        source: "./capabilities/opportunities.facade.js",
      }],
    },
    components: [
      {
        id: "component.opportunity-evaluator",
        label: "Opportunity Evaluator",
        kind: "agent",
        capability: "opportunities",
        sourcePath: protocolSource,
        symbol: "OpportunityEvaluator",
        rootExport: "OpportunityEvaluator",
        chapterIds: ["discovery"],
        flowIds: ["discover-opportunity"],
        summary: "Evaluates candidate fit before surfacing.",
      },
      {
        id: "host-requirement.opportunity-store",
        label: "Persist opportunities",
        kind: "host-requirement",
        capability: "opportunities",
        sourcePath: "packages/protocol/src/shared/interfaces/database.interface.ts",
        symbol: "OpportunityGraphDatabase",
        chapterIds: ["runtime"],
        flowIds: ["discover-opportunity"],
        summary: "A host must provide the protocol persistence contract.",
      },
    ],
    edges: [{
      id: "runtime.test",
      sourceId: "component.opportunity-evaluator",
      targetId: "host-requirement.opportunity-store",
      kind: "injected",
      label: "requires persistence",
      evidencePath: overrides.evidencePath ?? protocolSource,
      evidenceSymbol: "OpportunityEvaluator",
    }],
    sourceFiles: { [protocolSource]: "export class OpportunityEvaluator {}\n" },
  };
}

function fixtureArtifact(options: { duplicateNode?: boolean; missingTarget?: boolean } = {}): AtlasArtifact {
  const artifact = structuredClone(buildAtlasArtifact(fixtureInput()));
  if (options.duplicateNode) artifact.nodes.push(structuredClone(artifact.nodes[0]));
  if (options.missingTarget) artifact.edges[0].targetId = "missing.target";
  return artifact;
}

describe("protocol atlas generator", () => {
  test("sorts records and emits a classic-script global deterministically", () => {
    const artifact = buildAtlasArtifact(fixtureInput());
    expect(artifact.nodes.map(({ id }) => id)).toEqual([...artifact.nodes.map(({ id }) => id)].sort());
    expect(serializeAtlasArtifact(artifact)).toBe(
      `globalThis.ProtocolAtlasGenerated = Object.freeze(${JSON.stringify(artifact, null, 2)});\n`,
    );
    expect(serializeAtlasArtifact(artifact)).not.toMatch(/generatedAt|timestamp|:\d+:/);
  });

  test("rejects evidence outside packages/protocol", () => {
    const artifact = buildAtlasArtifact(fixtureInput({ evidencePath: "services/api/src/main.ts" }));
    expect(validateAtlasArtifact(artifact, fixtureRoot)).toContain(
      "edge runtime.test evidencePath must begin with packages/protocol/",
    );
  });

  test("rejects duplicate ids and unresolved endpoints", () => {
    const artifact = fixtureArtifact({ duplicateNode: true, missingTarget: true });
    expect(validateAtlasArtifact(artifact, fixtureRoot)).toEqual(
      expect.arrayContaining([expect.stringContaining("duplicate node id"), expect.stringContaining("missing target")]),
    );
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `bun test scripts/tests/build-protocol-atlas.spec.ts`  
Expected: FAIL because the generator module does not exist.

- [ ] **Step 3: Define the selected core manifest**

Use exact selectors, not broad directory scans. The initial generated nodes are:

```ts
const ROOT_EXPORT_COMPONENTS = [
  // Graph factories
  "ChatGraphFactory", "IntentGraphFactory", "OpportunityGraphFactory",
  "EnrichmentGraphFactory", "PremiseGraphFactory", "NegotiationGraphFactory",
  "HydeGraphFactory", "NetworkGraphFactory", "NetworkMembershipGraphFactory",
  "IntentNetworkGraphFactory", "RadarGraphFactory", "MaintenanceGraphFactory",
  // Structured agents and evaluators
  "SemanticVerifier", "IntentIndexer", "UserContextGenerator", "LensInferrer",
  "OpportunityEvaluator", "OpportunityPresenter", "IndexNegotiator", "QuestionerAgent",
  // Tool/runtime surfaces
  "createChatTools", "createIntentTools", "createEnrichmentTools", "createPremiseTools",
  "createNetworkTools", "createOpportunityTools", "createNegotiationTools",
  "createQuestionerTools", "createAgentTools", "createToolRegistry", "invokeToolRuntime",
  "createMcpServer",
  // Host-owned requirements expressed by protocol ports
  "McpAuthResolver", "Embedder", "Cache", "HydeCache", "IntentGraphQueue",
  "AgentDispatcher", "NegotiationTimeoutQueue", "ChatGraphCompositeDatabase",
  "UserDatabase", "SystemDatabase", "OpportunityGraphDatabase",
  "NegotiationGraphDatabase",
] as const;
```

Add the capability facades themselves as nodes from `packages/protocol/src/capabilities/*.facade.ts`, limited to:

```text
signals, participant-context, communities, opportunities, negotiation,
questions, participant-agents, contacts, integrations, interaction-composition
```

Add runtime-shell nodes only for protocol-owned paths:

```text
src/index.ts
src/runtime/foreground/index.ts
src/runtime/background/index.ts
src/public/index.ts
src/platform/index.ts
src/mcp/mcp.server.ts
```

- [ ] **Step 4: Implement protocol-source loading and normalization**

Read `packages/protocol/architecture/exports.snapshot.json` for root symbol kind, stability, and facade source. Validate every selected root export exists. Resolve its facade source to a `packages/protocol/src/...` path. For implementation source paths that need drill-down beyond a facade, use a reviewed map keyed by symbol and validate the path exists under the package root.

Host-requirement nodes must point to the protocol port that declares the requirement, for example:

```ts
{
  id: "host-requirement.mcp-auth-resolver",
  label: "Resolve authenticated principal",
  kind: "host-requirement",
  capability: "participant-agents",
  sourcePath: "packages/protocol/src/shared/interfaces/auth.interface.ts",
  symbol: "McpAuthResolver",
  summary: "A host must resolve protocol identity; host authentication implementation is outside this atlas.",
}
```

No loader may read `services/`, `apps/`, or a concrete host implementation.

- [ ] **Step 5: Implement typed edge generation and validation**

Generate static edges from protocol source imports using `runtimeModuleSpecifiers`; type-only references must never be labeled runtime. Keep runtime and injected edges in an explicit reviewed manifest because TypeScript imports cannot prove invocation semantics. Include these core relationships:

```text
createMcpServer → createToolRegistry (runtime)
createMcpServer → McpAuthResolver host requirement (injected)
createToolRegistry → capability tool families (runtime)
ChatGraphFactory → createChatTools (runtime)
IntentGraphFactory → SemanticVerifier (runtime)
IntentGraphFactory → IntentGraphQueue host requirement (injected)
OpportunityGraphFactory → HydeGraphFactory (runtime)
OpportunityGraphFactory → OpportunityEvaluator (runtime)
OpportunityGraphFactory → NegotiationGraphFactory (runtime)
OpportunityGraphFactory → OpportunityGraphDatabase host requirement (injected)
NegotiationGraphFactory → IndexNegotiator (runtime)
NegotiationGraphFactory → AgentDispatcher host requirement (injected)
NegotiationGraphFactory → NegotiationTimeoutQueue host requirement (injected)
```

Each manifest edge must name a `packages/protocol` evidence path and symbol. Validation fails when either endpoint or evidence path is missing.

- [ ] **Step 6: Implement atomic write and check CLI**

Support:

```bash
bun scripts/build-protocol-atlas.ts          # write atomically
bun scripts/build-protocol-atlas.ts --check  # compare in memory and fail on drift
```

Write to a sibling temporary file and rename it over `docs/protocol-atlas/protocol.generated.js`. In check mode, print one actionable command and exit nonzero on mismatch.

- [ ] **Step 7: Add root scripts**

Add to `package.json`:

```json
"build:protocol-atlas": "bun scripts/build-protocol-atlas.ts",
"check:protocol-atlas": "bun scripts/build-protocol-atlas.ts --check"
```

Do not add the atlas to the deployable application build.

- [ ] **Step 8: Generate the initial artifact and run focused checks**

Run:

```bash
bun run build:protocol-atlas
bun test scripts/tests/build-protocol-atlas.spec.ts
bun run check:protocol-atlas
```

Expected: generated artifact is stable and both test/check commands PASS.

- [ ] **Step 9: Commit the generator**

```bash
git add package.json scripts/build-protocol-atlas.ts scripts/tests/build-protocol-atlas.spec.ts \
  docs/protocol-atlas/protocol.generated.js
git commit -m "feat(docs): generate protocol atlas inventory"
```

---

### Task 3: Implement the environment-neutral interaction core

**Files:**
- Create: `docs/protocol-atlas/atlas-core.js`
- Create: `scripts/tests/protocol-atlas-core.spec.ts`

**Interfaces:**
- Produces `globalThis.ProtocolAtlasCore` with:

```js
{
  defaultState(),
  parseHash(hash, content, generated),
  serializeHash(state),
  transition(state, action, content, generated),
  validateData(content, generated),
  searchItems(query, content, generated),
  filterGraph(filters, generated),
}
```

- State shape:

```js
{
  chapterId: "orientation",
  stepId: null,
  layer: "protocol",
  selectedNodeId: null,
  query: "",
  filters: { capabilities: [], kinds: [], edgeKinds: [] },
  notice: null,
}
```

- Consumed by Task 6's DOM renderer.

- [ ] **Step 1: Write failing core tests**

Import the classic script for side effects and read the global:

```ts
import { beforeAll, describe, expect, test } from "bun:test";

type AtlasCore = {
  defaultState(): Record<string, unknown>;
  parseHash(hash: string, content: ReturnType<typeof fixtureContent>, generated: ReturnType<typeof fixtureGenerated>): Record<string, unknown>;
  serializeHash(state: Record<string, unknown>): string;
  transition(state: Record<string, unknown>, action: Record<string, unknown>, content: ReturnType<typeof fixtureContent>, generated: ReturnType<typeof fixtureGenerated>): Record<string, unknown>;
  searchItems(query: string, content: ReturnType<typeof fixtureContent>, generated: ReturnType<typeof fixtureGenerated>): Array<{ id: string }>;
  filterGraph(filters: Record<string, string[]>, generated: ReturnType<typeof fixtureGenerated>): ReturnType<typeof expectedOpportunityAgentSubgraph>;
};

beforeAll(async () => {
  await import("../../docs/protocol-atlas/atlas-core.js");
});

const core = () => (globalThis as typeof globalThis & { ProtocolAtlasCore: AtlasCore }).ProtocolAtlasCore;
const fixtureContent = () => ({
  schemaVersion: 1,
  chapters: [
    { id: "orientation", title: "Orientation", stepIds: [] },
    { id: "discovery", title: "Discovery", stepIds: ["resolve-effective-scope", "retrieve-candidates", "evaluate-fit"] },
    { id: "runtime", title: "Runtime", stepIds: ["invocation-runtime"] },
  ],
  flows: [{
    id: "discover-opportunity",
    chapterId: "discovery",
    steps: [
      { id: "resolve-effective-scope", title: "Resolve scope" },
      { id: "retrieve-candidates", title: "Retrieve candidates" },
      { id: "evaluate-fit", title: "Evaluate fit" },
    ],
  }],
  concepts: [], invariants: [], vocabulary: [], relationships: [],
});
const fixtureGenerated = () => ({
  schemaVersion: 1,
  nodes: [
    { id: "component.opportunity-graph-factory", label: "OpportunityGraphFactory", symbol: "OpportunityGraphFactory", capability: "opportunities", kind: "graph-factory", summary: "Runs discovery." },
    { id: "component.opportunity-evaluator", label: "Opportunity Evaluator", symbol: "OpportunityEvaluator", capability: "opportunities", kind: "agent", summary: "Evaluates candidate fit." },
  ],
  edges: [{ id: "runtime.evaluate", sourceId: "component.opportunity-graph-factory", targetId: "component.opportunity-evaluator", kind: "runtime" }],
});
const fixtureState = (overrides = {}) => ({
  chapterId: "orientation",
  stepId: null,
  layer: "protocol",
  selectedNodeId: null,
  query: "",
  filters: { capabilities: [], kinds: [], edgeKinds: [] },
  notice: null,
  ...overrides,
});
const expectedOpportunityAgentSubgraph = () => ({
  nodes: [fixtureGenerated().nodes[1]],
  edges: [],
});

describe("ProtocolAtlasCore routing", () => {
  test("round-trips chapter, step, layer, selected node, and filters", () => {
    const state = fixtureState();
    expect(core().parseHash(core().serializeHash(state), fixtureContent(), fixtureGenerated())).toEqual(state);
  });

  test("recovers invalid state to orientation with a notice", () => {
    expect(core().parseHash("#chapter=missing&layer=nope", fixtureContent(), fixtureGenerated())).toMatchObject({
      chapterId: "orientation",
      layer: "protocol",
      notice: "That atlas location no longer exists. Returned to Orientation.",
    });
  });
});

describe("ProtocolAtlasCore search and filters", () => {
  test("ranks exact symbol matches before summary matches", () => {
    expect(core().searchItems("OpportunityGraphFactory", fixtureContent(), fixtureGenerated())[0].id)
      .toBe("component.opportunity-graph-factory");
  });

  test("composes capability, kind, and edge-kind filters", () => {
    expect(core().filterGraph({ capabilities: ["opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] }, fixtureGenerated()))
      .toEqual(expectedOpportunityAgentSubgraph());
  });
});
```

- [ ] **Step 2: Run the core test and verify it fails**

Run: `bun test scripts/tests/protocol-atlas-core.spec.ts`  
Expected: FAIL because `atlas-core.js` does not exist.

- [ ] **Step 3: Implement data validation**

`validateData` must return `{ ok: boolean, errors: string[] }`. Validate schema version, unique chapter/flow/concept/invariant/node/edge IDs, chapter-step membership, edge endpoints, and curated `nodeIds` against generated nodes. It must not throw for runtime data failures.

- [ ] **Step 4: Implement deterministic URL state**

Use `URLSearchParams` inside the hash. Serialize fields in this fixed order:

```text
chapter, step, layer, node, capabilities, kinds, edgeKinds
```

Omit defaults. Sort multi-value filters before joining with commas. Invalid state returns the default plus the recovery notice.

- [ ] **Step 5: Implement transitions, search, and filtering**

Actions are exact tagged objects:

```js
{ type: "select-chapter", chapterId }
{ type: "select-step", stepId }
{ type: "set-layer", layer }
{ type: "select-node", nodeId }
{ type: "set-query", query }
{ type: "set-filters", filters }
{ type: "reset-filters" }
{ type: "next-step" }
{ type: "previous-step" }
```

Layer changes preserve chapter/step. Search exact label/symbol matches first, then prefix, then tokenized summary matches. Empty or whitespace-only search returns no overlay results. Filtering retains only edges whose endpoints survive node filtering.

- [ ] **Step 6: Run focused tests**

Run: `bun test scripts/tests/protocol-atlas-core.spec.ts`  
Expected: PASS.

- [ ] **Step 7: Commit the core**

```bash
git add docs/protocol-atlas/atlas-core.js scripts/tests/protocol-atlas-core.spec.ts
git commit -m "feat(docs): add protocol atlas interaction core"
```

---

### Task 4: Author the protocol-only curated atlas content

**Files:**
- Create: `docs/protocol-atlas/atlas-content.js`
- Modify: `scripts/build-protocol-atlas.ts`
- Modify: `scripts/tests/build-protocol-atlas.spec.ts`
- Regenerate: `docs/protocol-atlas/protocol.generated.js`

**Interfaces:**
- Produces `globalThis.ProtocolAtlasContent`:

```js
{
  schemaVersion: 1,
  chapters: Chapter[],
  flows: Flow[],
  concepts: Concept[],
  invariants: Invariant[],
  vocabulary: VocabularyEntry[],
  relationships: ConceptualRelationship[],
}
```

- Chapter IDs, in order:

```text
orientation, primitives, trust-scope, discovery, consent, runtime, explore
```

- Flow IDs:

```text
trusted-context, express-signal, discover-opportunity, consent-connect, external-agent-mcp
```

- Consumed by Tasks 6 and 7 and validated by Task 2's generator.

- [ ] **Step 1: Add failing curated-reference tests**

Extend `build-protocol-atlas.spec.ts`:

```ts
import { resolve } from "node:path";

import {
  buildAtlasArtifact,
  loadProtocolGeneratorInput,
  validateCuratedReferences,
} from "../build-protocol-atlas.ts";

const repoRoot = resolve(import.meta.dir, "../..");
async function loadAtlasContent() {
  delete (globalThis as { ProtocolAtlasContent?: unknown }).ProtocolAtlasContent;
  await import(`../../docs/protocol-atlas/atlas-content.js?test=${crypto.randomUUID()}`);
  const content = structuredClone((globalThis as { ProtocolAtlasContent: Record<string, unknown> }).ProtocolAtlasContent);
  delete (globalThis as { ProtocolAtlasContent?: unknown }).ProtocolAtlasContent;
  return content;
}

test("accepts the approved seven chapters and five flows", async () => {
  const content = await loadAtlasContent();
  expect(content.chapters.map(({ id }: { id: string }) => id)).toEqual([
    "orientation", "primitives", "trust-scope", "discovery", "consent", "runtime", "explore",
  ]);
  expect(content.flows.map(({ id }: { id: string }) => id)).toEqual([
    "trusted-context", "express-signal", "discover-opportunity", "consent-connect", "external-agent-mcp",
  ]);
  const artifact = buildAtlasArtifact(await loadProtocolGeneratorInput(repoRoot));
  expect(validateCuratedReferences(content, artifact)).toEqual([]);
});

test("forbids concrete host implementation paths in curated content", async () => {
  const content = await loadAtlasContent() as { flows: Array<{ steps: Array<{ sourcePaths?: string[] }> }> };
  content.flows[0].steps[0].sourcePaths = ["services/api/src/main.ts"];
  const artifact = buildAtlasArtifact(await loadProtocolGeneratorInput(repoRoot));
  expect(validateCuratedReferences(content, artifact)).toContain(
    "curated source paths must begin with packages/protocol/",
  );
});
```

- [ ] **Step 2: Run the test and verify content is missing**

Run: `bun test scripts/tests/build-protocol-atlas.spec.ts`  
Expected: FAIL because `atlas-content.js` does not exist.

- [ ] **Step 3: Define the protocol concepts and vocabulary**

Include these concept IDs exactly:

```text
participant, software-agent, signal, premise, context, community, membership,
agent-permission, effective-scope, candidate, opportunity, negotiation, connection,
provider-helper-role, radar
```

Vocabulary entries must explicitly map:

```text
Signal ↔ product Signal ↔ implementation intent
Community ↔ product Network ↔ implementation network/index
Participant ↔ product Person ↔ implementation user
Draft/Sent/Connected/Declined/Expired ↔ product states ↔ internal lifecycle states
Software Agent ↔ agent registry actor; provider/helper role ↔ internal valency role "agent"
```

Mark Radar, semantic entropy, felicity conditions, referential anchors, HyDE, valency, and Gricean presentation as product/reference-implementation concepts rather than normative primitives.

- [ ] **Step 4: Define the normative invariants**

Include stable invariant IDs and concise text for:

```text
scope-intersection, participant-consent, action-attribution, candidate-private,
no-fabrication, context-freshness, opportunity-legibility, terminality,
host-boundary, negotiation-not-consent
```

`host-boundary` must say: “The protocol declares required ports and callbacks; how a host fulfills them is outside this atlas.”

- [ ] **Step 5: Author the five flows with exact step IDs**

```text
trusted-context:
  approved-material → atomic-premises → assign-and-embed → synthesize-context → refresh-representations

express-signal:
  participant-input → infer-speech-act → verify-or-clarify → reconcile → assign-communities → persist-and-enqueue

discover-opportunity:
  load-trigger → resolve-effective-scope → retrieve-candidates → evaluate-fit → recheck-admission → negotiate-optional → surface

consent-connect:
  actionable-opportunity → first-participant-sends → counterparty-reviews → accept-or-decline → open-human-conversation

external-agent-mcp:
  caller-credential → auth-resolver-requirement → protocol-capability-policy → authorized-tool-registry → invocation-runtime → scoped-capability
```

For every step provide title, plain-language summary, `conceptIds`, `nodeIds`, `invariantIds`, previous/next IDs, and separate Protocol/Implementation notes. Implementation source paths must remain in `packages/protocol`.

- [ ] **Step 6: Encode source discrepancies as visible gap notes**

Add explicit notes for:

- normative bounded negotiation versus the current uncapped external-agent exception;
- Draft/Sent/Connected versus internal lifecycle states;
- Community versus Network/index;
- background-only opportunity creation versus stale synchronous examples;
- candidate privacy versus surfaced opportunity presentation.

Do not resolve these by inventing one merged lifecycle.

- [ ] **Step 7: Load curated content in the generator and validate references**

The generator imports the classic script for side effects under Bun, reads `globalThis.ProtocolAtlasContent`, validates it, and clears the temporary global after use. In browser output, content remains a classic global.

- [ ] **Step 8: Regenerate and run data tests**

Run:

```bash
bun run build:protocol-atlas
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
```

Expected: PASS; every curated generated-node reference resolves.

- [ ] **Step 9: Commit curated content**

```bash
git add docs/protocol-atlas/atlas-content.js docs/protocol-atlas/protocol.generated.js \
  scripts/build-protocol-atlas.ts scripts/tests/build-protocol-atlas.spec.ts
git commit -m "docs(protocol): author guided atlas content"
```

---

### Task 5: Build the semantic shell and Technical Blueprint visual system

**Files:**
- Create: `docs/protocol-atlas/index.html`
- Create: `docs/protocol-atlas/atlas.css`
- Modify: `scripts/tests/build-protocol-atlas.spec.ts`

**Interfaces:**
- `index.html` exposes fixed targets used by Task 6:

```text
#atlas-nav, #atlas-main, #atlas-diagram, #atlas-inspector, #atlas-search,
#atlas-layer-toggle, #atlas-filters, #atlas-notice, #atlas-status
```

- `atlas.css` exposes component classes used by the renderer:

```text
.atlas-node, .atlas-edge, .atlas-stepper, .atlas-card, .atlas-inspector,
.atlas-chip, .atlas-disclosure, .atlas-search-results, .atlas-empty,
.is-selected, .is-disabled, .visually-hidden
```

- [ ] **Step 1: Add a failing static asset contract test**

```ts
test("loads dependency-free classic assets in deterministic order", async () => {
  const html = await Bun.file("docs/protocol-atlas/index.html").text();
  expect(html).toContain('<link rel="stylesheet" href="./atlas.css">');
  expect(html).toMatch(/atlas-content\.js[\s\S]*protocol\.generated\.js[\s\S]*atlas-core\.js[\s\S]*atlas\.js/);
  expect(html).not.toMatch(/https?:\/\/|type="module"|<script[^>]+src="\//);
});
```

- [ ] **Step 2: Run the test and verify the shell is missing**

Run: `bun test scripts/tests/build-protocol-atlas.spec.ts -t "loads dependency-free classic assets"`  
Expected: FAIL because `index.html` does not exist.

- [ ] **Step 3: Create the semantic HTML shell**

Use semantic landmarks and real controls rather than clickable divs:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Index Protocol Atlas</title>
  <link rel="stylesheet" href="./atlas.css">
</head>
<body>
  <a class="skip-link" href="#atlas-main">Skip to atlas content</a>
  <header class="atlas-header">
    <a class="atlas-brand" href="#">PROTOCOL::ATLAS</a>
    <div id="atlas-layer-toggle" role="group" aria-label="Atlas layer"></div>
    <button id="atlas-search" type="button" aria-haspopup="dialog">Search</button>
  </header>
  <div class="atlas-layout">
    <nav id="atlas-nav" aria-label="Atlas chapters"></nav>
    <main id="atlas-main" tabindex="-1">
      <div id="atlas-notice" role="status" aria-live="polite"></div>
      <section id="atlas-diagram" aria-labelledby="atlas-title"></section>
    </main>
    <aside id="atlas-inspector" aria-label="Concept inspector"></aside>
  </div>
  <section id="atlas-filters" aria-label="Diagram filters"></section>
  <p id="atlas-status" class="visually-hidden" role="status" aria-live="polite"></p>
  <noscript>This atlas's diagrams require JavaScript. Read <a href="../../packages/protocol/README.md">the protocol model</a> or <a href="../../packages/protocol/IMPLEMENTATION.md">the implementation guide</a>.</noscript>
  <script src="./atlas-content.js"></script>
  <script src="./protocol.generated.js"></script>
  <script src="./atlas-core.js"></script>
  <script src="./atlas.js"></script>
</body>
</html>
```

- [ ] **Step 4: Implement the Technical Blueprint tokens and layout**

Define CSS custom properties for navy surfaces, grid, ink, muted ink, cyan/green/amber/violet accents, focus ring, edge patterns, spacing, radii, and typography. Use system sans and monospace stacks only. The desktop grid is `15rem minmax(0, 1fr) 19rem`; at `max-width: 900px`, stack the inspector below main; at `max-width: 640px`, make navigation horizontally scrollable and diagrams vertically arranged.

- [ ] **Step 5: Add accessibility and motion states**

Include:

```css
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Use distinct dash patterns and text legends for static, runtime, injected, and conceptual edges.

- [ ] **Step 6: Run static and lint checks**

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts
bunx eslint scripts/build-protocol-atlas.ts scripts/tests/build-protocol-atlas.spec.ts docs/protocol-atlas/*.js
```

Expected: PASS with no errors.

- [ ] **Step 7: Commit the shell**

```bash
git add docs/protocol-atlas/index.html docs/protocol-atlas/atlas.css scripts/tests/build-protocol-atlas.spec.ts
git commit -m "feat(docs): add protocol atlas blueprint shell"
```

---

### Task 6: Render guided chapters, diagrams, and the inspector

**Files:**
- Create: `docs/protocol-atlas/atlas.js`
- Modify: `docs/protocol-atlas/atlas.css`
- Modify: `scripts/tests/protocol-atlas-core.spec.ts`

**Interfaces:**
- Consumes the three globals from Tasks 2–4.
- Internal renderer functions:

```js
bootstrapAtlas();
dispatch(action);
render(state);
renderNavigation(state, content);
renderChapter(state, content, generated);
renderDiagram(step, state, content, generated);
renderInspector(selectedNodeId, content, generated);
renderStepper(flow, step, state);
```

- [ ] **Step 1: Add failing transition tests for guided flow movement**

```ts
test("moves within a flow and crosses to the declared next step only", () => {
  const start = fixtureState({ chapterId: "discovery", stepId: "retrieve-candidates" });
  expect(core().transition(start, { type: "next-step" }, fixtureContent(), fixtureGenerated()).stepId)
    .toBe("evaluate-fit");
  expect(core().transition(start, { type: "previous-step" }, fixtureContent(), fixtureGenerated()).stepId)
    .toBe("resolve-effective-scope");
});

test("preserves chapter and step while switching layers", () => {
  const state = fixtureState({ chapterId: "runtime", stepId: "invocation-runtime", layer: "protocol" });
  expect(core().transition(state, { type: "set-layer", layer: "implementation" }, fixtureContent(), fixtureGenerated()))
    .toMatchObject({ chapterId: "runtime", stepId: "invocation-runtime", layer: "implementation" });
});
```

- [ ] **Step 2: Run and verify the transition tests fail**

Run: `bun test scripts/tests/protocol-atlas-core.spec.ts -t "moves within|preserves chapter"`  
Expected: FAIL until transition behavior is complete.

- [ ] **Step 3: Implement bootstrap and graceful data validation**

On `DOMContentLoaded`, read the three globals and call `ProtocolAtlasCore.validateData`. If curated content is invalid, render a fatal readable message with README links. If generated data is invalid or missing, retain curated chapters, show the approved banner, disable Explore and code drawers, and log validation details with `console.error`.

- [ ] **Step 4: Render chapter navigation and stepper controls**

Use ordered lists and buttons with `aria-current="page"` or `aria-current="step"`. Previous/Next controls dispatch core actions. The active chapter title and step summary render as text before the diagram.

- [ ] **Step 5: Render protocol diagrams as accessible SVG**

Each SVG includes `<title>` and `<desc>`. Derive node positions from the curated step's ordered `conceptIds` and `nodeIds`; do not introduce drag/zoom. On mobile, CSS switches to a stacked card representation. Nodes are `<button>` elements in an HTML overlay or keyboard-focusable SVG groups with explicit key handlers; prefer HTML buttons for reliable accessibility.

- [ ] **Step 6: Render the Implementation layer without host internals**

Implementation nodes come from `protocol.generated.js`. Host-requirement nodes use a boundary treatment and text “Required from host; implementation intentionally not shown.” Never render a path outside `packages/protocol`.

- [ ] **Step 7: Render inspector and Show code disclosure**

The inspector combines definition, role in step, invariant, vocabulary mapping, kind, capability, source path, symbol, and stability. “Show code” is a native `<details>` element. Add a copy-path button using `navigator.clipboard.writeText` with a fallback text selection path; do not synthesize GitHub branch links.

- [ ] **Step 8: Wire layer controls and keyboard operation**

Layer buttons dispatch `set-layer`. `ArrowRight`/`ArrowLeft` move steps only when focus is not in an input, disclosure, or search control. `Escape` clears selected node or closes search. Focus the inspector heading after explicit node selection on narrow layouts.

- [ ] **Step 9: Run focused checks and manually open the site**

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts scripts/tests/build-protocol-atlas.spec.ts
bunx eslint docs/protocol-atlas/*.js
```

Then open `docs/protocol-atlas/index.html` directly and verify Orientation, chapter navigation, one complete flow, layer switching, inspector selection, and Show code without console errors.

- [ ] **Step 10: Commit guided rendering**

```bash
git add docs/protocol-atlas/atlas.js docs/protocol-atlas/atlas.css scripts/tests/protocol-atlas-core.spec.ts
git commit -m "feat(docs): render protocol atlas guided flows"
```

---

### Task 7: Add deep links, search, filters, failure recovery, and responsive polish

**Files:**
- Modify: `docs/protocol-atlas/atlas.js`
- Modify: `docs/protocol-atlas/atlas-core.js`
- Modify: `docs/protocol-atlas/atlas.css`
- Modify: `scripts/tests/protocol-atlas-core.spec.ts`
- Modify: `scripts/tests/build-protocol-atlas.spec.ts`

**Interfaces:**
- Completes Task 3's core contract and Task 6's DOM contract; introduces no new global.

- [ ] **Step 1: Add failing deep-link and empty-result tests**

```ts
test("serializes filters in stable order and restores selected nodes", () => {
  const state = fixtureState({
    selectedNodeId: "component.opportunity-evaluator",
    filters: { capabilities: ["signals", "opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] },
  });
  expect(core().serializeHash(state)).toBe(
    "#node=component.opportunity-evaluator&capabilities=opportunities%2Csignals&kinds=agent&edgeKinds=runtime",
  );
});

test("returns an explicit empty search result contract", () => {
  expect(core().searchItems("definitely absent", fixtureContent(), fixtureGenerated())).toEqual([]);
});
```

- [ ] **Step 2: Run the tests and verify failures**

Run: `bun test scripts/tests/protocol-atlas-core.spec.ts -t "serializes filters|empty search"`  
Expected: FAIL until stable hash and empty-state behavior are complete.

- [ ] **Step 3: Wire history state**

After every user action, update `location.hash` with `serializeHash`. Listen for `hashchange`, parse, render, and avoid loops by comparing the normalized hash. Back/forward and reload must restore chapter, step, layer, node, and filters.

- [ ] **Step 4: Implement the search dialog**

Use a native `<dialog>` when available and an accessible in-page fallback otherwise. Search concepts and core components. Show exact symbol/label matches first and include chapter/capability/kind metadata. Selecting a result navigates to its primary chapter, switches to Implementation for generated nodes, selects it, closes the dialog, and announces the change.

- [ ] **Step 5: Implement generated graph filters**

Render checkboxes for capability, kind, and edge kind only in Implementation/Explore contexts. Updating filters re-renders without changing chapter/step. An empty subgraph renders:

```text
No components match these filters. Reset filters or broaden the selection.
```

with a real reset button.

- [ ] **Step 6: Complete runtime failure behavior**

Test and implement:

- invalid hash → Orientation plus recovery notice;
- missing generated global → curated chapters remain, Explore disabled;
- malformed generated edge → edge omitted, banner shown, developer detail logged;
- clipboard failure → select visible path text and announce instructions;
- empty search → “No atlas concepts or components match…” plus query reset.

- [ ] **Step 7: Complete responsive and accessibility polish**

Verify at 1440px, 900px, 640px, and 375px widths. Ensure no horizontal body overflow. Add `aria-expanded`, `aria-controls`, live-region announcements, focus return after dialog close, and minimum 44px touch targets. Confirm edge labels and dash patterns remain distinguishable in grayscale.

- [ ] **Step 8: Add a protocol-only static inventory assertion**

Extend generator tests to scan both generated and curated assets:

```ts
test("contains no concrete host implementation references", async () => {
  const sources = await Promise.all([
    "docs/protocol-atlas/atlas-content.js",
    "docs/protocol-atlas/protocol.generated.js",
  ].map((path) => Bun.file(path).text()));
  expect(sources.join("\n")).not.toMatch(/services\/api|apps\/web|src\/controllers|src\/services|src\/adapters|src\/queues/);
});
```

- [ ] **Step 9: Run targeted validation**

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
bunx eslint docs/protocol-atlas/*.js scripts/build-protocol-atlas.ts scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
```

Expected: PASS with no errors.

- [ ] **Step 10: Commit interaction completion**

```bash
git add docs/protocol-atlas/atlas.js docs/protocol-atlas/atlas-core.js docs/protocol-atlas/atlas.css \
  scripts/tests/protocol-atlas-core.spec.ts scripts/tests/build-protocol-atlas.spec.ts
git commit -m "feat(docs): complete protocol atlas exploration"
```

---

### Task 8: Add the source-evidenced Configuration Lab

**Files:**
- Modify: `scripts/build-protocol-atlas.ts`
- Modify: `scripts/tests/build-protocol-atlas.spec.ts`
- Modify: `scripts/tests/protocol-atlas-core.spec.ts`
- Modify: `docs/protocol-atlas/atlas-content.js`
- Modify: `docs/protocol-atlas/atlas-core.js`
- Modify: `docs/protocol-atlas/atlas.js`
- Modify: `docs/protocol-atlas/atlas.css`
- Regenerate: `docs/protocol-atlas/protocol.generated.js`

**Interfaces:**
- Curated authority remains `globalThis.ProtocolAtlasContent`. Add `configurationExperiments`, while retaining curated `schemaVersion: 1` and the existing chapter/flow records.
- Upgrade the generated envelope to schema 2:

```ts
export type AtlasArtifactV1 = {
  schemaVersion: 1;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
};

export type AtlasArtifact = {
  schemaVersion: 2;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  configurationExperiments: GeneratedConfigurationExperiment[];
};
```

- Model curated configuration records without allowing unrestricted input:

```ts
export type ConfigurationEffect = "activated" | "bypassed" | "changed" | "unresolved";
export type ConfigurationTargetKind = "node" | "edge" | "step";

export type ConfigurationReadSite = {
  path: string;
  symbol: string;
};

export type ConfigurationSetting = {
  key: string;
  readSites: readonly ConfigurationReadSite[];
  entryAccessorSymbol: string;
  accessorClosure: readonly EvidenceHop[];
  acceptedValues: readonly string[];
  readTiming: "module-load" | "invocation";
};

export type EvidenceHop = {
  path: string;
  symbol: string;
};

export type DefinitiveConfigurationDelta = {
  id: string;
  effect: Exclude<ConfigurationEffect, "unresolved">;
  targetKind: ConfigurationTargetKind;
  targetId: string;
  consumerPath: string;
  consumerSymbol: string;
  referenceChain: readonly EvidenceHop[];
  behaviorTest: { path: string; testName: string };
};

export type UnresolvedConfigurationDelta = {
  id: string;
  effect: "unresolved";
  targetKind: ConfigurationTargetKind;
  targetId: string;
  noDirectProtocolConsumer: true;
};

export type ConfigurationMode = {
  id: string;
  assignments: readonly { key: string; value: string | null }[]; // null means unset
  resolvedValues: readonly { key: string; value: string }[];
  prerequisites: readonly (
    | { kind: "setting"; key: string; value: string | null }
    | { kind: "injected-capability"; nodeId: string }
  )[];
  deltas: readonly (DefinitiveConfigurationDelta | UnresolvedConfigurationDelta)[];
  explanation: string;
  caveats: readonly string[];
};
```

- `GeneratedConfigurationExperiment` is the normalized, sorted evidence join. It retains the curated title, summary, fallback mode, assignments, explanations, prerequisites, target associations, and caveats, and adds only validated package-owned evidence. It must contain no active environment values, timestamps, line numbers, absolute paths, or inferred experiments.
- Extend `GeneratorInput` with all production TypeScript modules under `packages/protocol/src` needed for syntax-aware reference analysis. Inventory membership remains selected and reviewed; this wider scan is solely for configuration evidence and unresolved-consumer detection.
- Extend `globalThis.ProtocolAtlasCore` with pure configuration helpers:

```js
{
  configurationAvailability(generated),
  deriveConfigurationComparison(experimentId, modeId, content, generated),
}
```

- Extend state without changing the existing filter shape:

```js
{
  // existing fields...
  configurationExperimentId: null,
  configurationModeId: null,
  focusIntent: null,
  announcement: null,
}
```

`focusIntent` and `announcement` are transient transition results, ignored by hash serialization and reset by the next action.

- Add exact actions:

```js
{ type: "select-configuration-experiment", experimentId }
{ type: "select-configuration-mode", experimentId, modeId }
{ type: "reset-configuration" }
```

- Serialize configuration after the existing fields in fixed hash order:

```text
chapter, step, layer, node, capabilities, kinds, edgeKinds, experiment, mode
```

- [ ] **Step 1: Perform the source-only preflight before authoring the manifest**

Read the approved Configuration Lab section in `docs/superpowers/specs/2026-08-07-protocol-atlas-design.md`. Also read the latest approved protocol slimming design, using its landed repository path when available or the current sibling worktree copy only as review context.

Reconcile every curated setting’s read path, accessor symbol, consumer symbol, behavior-test citation, target node/edge/step, and ordered reference chain against the current `packages/protocol` tree. Prefer canonical capability/application/domain paths; do not preserve a deprecated path merely because the atlas previously cited it.

Start with the current source seams, including:

```text
packages/protocol/src/opportunity/discovery.env.ts
packages/protocol/src/opportunity/application/opportunity.graph.ts
packages/protocol/src/opportunity/application/opportunity.introducer-feature.ts
packages/protocol/src/premise/premise.graph.ts
packages/protocol/src/shared/hyde/hyde.env.ts
packages/protocol/src/questions/application/question.env.ts
packages/protocol/src/negotiation/domain/negotiation.protocol.ts
packages/protocol/src/negotiation/domain/negotiation.screen.contracts.ts
packages/protocol/src/negotiation/domain/negotiation.stance.contracts.ts
packages/protocol/src/negotiation/domain/negotiation.consultation-policy.ts
packages/protocol/src/negotiation/domain/negotiation.deadlock.ts
packages/protocol/src/opportunity/discriminator/discriminator.env.ts
packages/protocol/src/opportunity/negotiation-evidence/negotiation-evidence.env.ts
packages/protocol/src/opportunity/outcome/outcome.env.ts
```

Run source-only searches:

```bash
rg -n --glob '*.ts' \
  'DISCOVERY_|RUN_OPPORTUNITY_EVAL_IN_PARALLEL|HYDE_FRAME_CONSTRAINTS_ENABLED|PREMISE_DEDUP_SIMILARITY|INTRODUCER_DISCOVERY_ENABLED|NEGOTIATION_|NEGOTIATOR_STANCE|QUESTIONER_|POOL_QUESTIONS_|OUTCOME_QUESTIONS_MODE' \
  packages/protocol/src

rg -n --glob '*.ts' \
  'discoveryAllowedTypes|discoveryProfileSource|getHydeGenerationMode|isQuestionerEnabled|isDiscoveryQuestionsEnabled|isUptakeGuardEnabled|uptakeAuthorityThreshold|configuredProtocolVersion|configuredScreenMode|configuredNegotiatorStance|negotiationConsultationPolicyMode|configuredDeadlock|poolQuestions|negotiationEvidenceQuestionsMode|outcomeQuestionsMode' \
  packages/protocol/src
```

Expected:

- every approved setting has all current `packages/protocol` read sites, an entry accessor/direct-read symbol, and a complete accessor closure;
- definitive deltas have a current runtime consumer outside that closure, ordered syntax-verifiable chain, target association, and DB-free behavior test;
- unresolved deltas have read/accessor-closure evidence, no same-module value reference outside the closure, and no external runtime import surface that can expose a closure export;
- any path changed by slimming is updated before the manifest is written;
- no atlas evidence comes from a compatibility shim scheduled for deletion.

This preflight must not inspect `.env*`, `services/api`, applications, Railway, host configuration, deployed revisions, `process.env` values, or other live environment state. The slimming design’s configured-capability protection remains an operational rule; the lab is only a fallback-based source simulator.

- [ ] **Step 2: Write the generator RED tests**

Extend `scripts/tests/build-protocol-atlas.spec.ts` with fixtures for curated settings, named modes, definitive chains, unresolved records, target associations, and production-source reverse references.

Lock the approved inventory with a compact ID/mode assertion derived from the approved spec, rather than reproducing full manifest objects in the test:

```ts
const APPROVED_CONFIGURATION_MODE_IDS = {
  "discovery-corpus": ["fallback", "intent-only", "premise-profile", "context-profile", "context-cross-match"],
  "discovery-premise-limit": ["fallback-40", "disabled-0", "expanded-100"],
  "discovery-rejection-cooldown": ["fallback-7d", "short-1d", "long-30d"],
  "discovery-evaluation-topology": ["bundled", "pairwise"],
  "hyde-frame-constraints": ["legacy", "frame-v1"],
  "premise-deduplication": ["fallback-0.93", "broad-0.85", "strict-0.98"],
  "introducer-discovery": ["off", "on"],
  "negotiation-context": ["include-active", "exact-only"],
  "negotiation-turn-caps": ["fallback-4-6", "short-2-3", "extended-8-12"],
  "negotiation-protocol": ["v1", "v2"],
  "negotiation-screen": ["off", "shadow", "enforce"],
  "negotiation-stance": ["advocate", "evaluator", "skeptic"],
  "negotiation-consultation": ["off", "shadow", "v2-on", "v2-short-window"],
  "negotiation-deadlock": ["off", "v2-threshold-4", "v2-fast-2", "v2-skeptic"],
  "questioner-uptake": ["off", "on-threshold-70", "on-threshold-90"],
  "questioner-discovery-contract": ["off", "transcripts-unresolved", "insights-unresolved"],
  "pool-question-contract": ["off", "shadow-mining", "on-pull", "on-push", "on-visit", "on-newborn"],
  "pool-ranking": ["off", "on"],
  "negotiation-evidence-contract": ["off", "shadow", "on-alias"],
  "outcome-questions-contract": ["off", "shadow", "on-alias"],
} as const;

test("locks the approved seven chapters, five flows, and 20 configuration experiments", async () => {
  const content = await loadAtlasContent() as {
    chapters: Array<{ id: string }>;
    flows: Array<{ id: string }>;
    configurationExperiments: Array<{
      id: string;
      modes: Array<{ id: string }>;
    }>;
  };
  expect(content.chapters).toHaveLength(7);
  expect(content.flows).toHaveLength(5);
  expect(Object.fromEntries(
    content.configurationExperiments.map((experiment) => [
      experiment.id,
      experiment.modes.map((mode) => mode.id),
    ]),
  )).toEqual(APPROVED_CONFIGURATION_MODE_IDS);
  expect(content.configurationExperiments.flatMap((experiment) => experiment.modes)).toHaveLength(61);
});
```

Add focused tests proving:

1. schema-2 experiments and nested records sort and serialize deterministically;
2. duplicate experiment, setting, mode, assignment, delta, and target IDs fail;
3. missing required modes fail rather than being pruned;
4. unknown node, edge, and guided-step targets fail;
5. package-only read, consumer, and test paths are enforced, and a setting fails if any current production read of its key is missing from declared `readSites`;
6. a definitive delta fails if its consumer symbol or any ordered chain hop is removed;
7. a definitive delta requires a behavior-test path and named test;
8. accessor-to-accessor wrappers are traversed only through the declared, internally verified accessor closure;
9. an unresolved delta rejects consumer/test fields and fails on a same-module value reference outside its closure, an external named/default runtime import of a closure export, or a namespace import that can expose one;
10. declaration-only barrel re-exports are allowed, but the first downstream runtime import through the barrel fails; type-only imports and named imports proven to target other exports remain allowed;
11. setting prerequisites require an exact `{ key, value }` assignment and reject mode-shaped or cross-experiment ambiguity;
12. secret-shaped keys, unrestricted assignments, malformed prerequisites, timestamps, line numbers, traversal paths, and host paths fail;
13. `on-alias` normalizes to the current source-supported shadow-equivalent explanation rather than inventing an `on` consumer;
14. curated authority fields survive the join and generated evidence fields are derived rather than semantically inferred.

Add a subprocess determinism test using a `--stdout` generator mode. Spawn twice with different controlled sentinel values, including a covered configuration key, and assert byte equality plus absence of both sentinels:

```ts
expect(first.exitCode).toBe(0);
expect(second.exitCode).toBe(0);
expect(first.stdout).toEqual(second.stdout);
expect(first.stdout).not.toContain("atlas-sentinel-a");
expect(first.stdout).not.toContain("atlas-sentinel-b");
```

- [ ] **Step 3: Run the generator RED phase**

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts \
  -t "configuration|seven chapters|definitive|unresolved|sentinel"
```

Expected: FAIL because curated experiments, schema 2, evidence joining, reference-chain validation, reverse-consumer validation, and `--stdout` do not exist.

- [ ] **Step 4: Implement the generator GREEN phase and curate the 20 experiments**

In `docs/protocol-atlas/atlas-content.js`, add the 20 approved experiments and all 61 required modes exactly as defined by the approved spec. Do not add an eighth chapter or sixth flow.

For each experiment author:

- stable ID, title, summary, capability, coverage classification, and package-fallback mode;
- exact setting keys, all package-owned read sites, entry accessor symbols, complete accessor closures, accepted values, and read timing;
- named modes containing only exact non-secret assignments or `unset`;
- source-derived resolved values and fallback values;
- prerequisites;
- affected chapters, steps, nodes, and edges;
- human-reviewed explanations, delta semantics, caveats, and coverage notes;
- definitive evidence or an explicit unresolved assertion, never both.

Include the permanent disclaimer verbatim:

> This compares documented `packages/protocol` behavior against package fallbacks. It does not show any deployed environment and is not evidence that a capability is unused or removable.

Keep `questioner-discovery-contract`, the host-activation portions of `pool-question-contract`, `negotiation-evidence-contract`, and `outcome-questions-contract` unresolved/protocol-boundary-only unless the preflight finds a direct current package consumer satisfying the approved evidence rules. Such a discovery is a design-review finding, not permission to silently reclassify the manifest.

In `scripts/build-protocol-atlas.ts`:

1. scan production `.ts` modules under `packages/protocol/src` for evidence only, excluding `tests/`, `*.spec.ts`, `*.test.ts`, and declarations;
2. parse environment reads with the TypeScript AST, supporting direct property and string-literal element access without evaluating modules, and fail when a production read of an approved key is absent from its declared `readSites`;
3. verify entry accessor declarations and every declared accessor-closure helper/reference;
4. verify consumer declarations and each ordered reference-chain hop from outside the accessor closure with runtime import/reference semantics, excluding type-only references;
5. validate unresolved records with a bounded import-surface gate: reject same-module value references outside the closure; reject external named/default runtime imports resolving to a closure export; reject namespace imports from the accessor module or declaration-only barrel chain when they can expose a closure export; permit barrel declarations themselves, type-only imports, and named imports proven to resolve to other exports;
6. verify behavior-test path and named test citation;
7. validate all node, edge, chapter, flow, and step targets;
8. reject secret-shaped keys such as names containing `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE_KEY`, `API_KEY`, or credential equivalents;
9. normalize and sort experiments, settings, modes, assignments, prerequisites, deltas, chains, and target IDs;
10. emit schema 2 with the joined `configurationExperiments`;
11. add `--stdout`, emitting only serialized artifact bytes and performing no write;
12. keep write mode atomic and `--check` byte-comparing the complete schema-2 artifact.

The generator must not load `.env` files explicitly or read `process.env` to populate configuration records. `process.argv` and `process.pid` may continue to control CLI/write mechanics only.

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts \
  -t "configuration|seven chapters|definitive|unresolved|sentinel"
```

Expected: PASS with exactly seven chapters, five flows, 20 experiments, and 61 named modes.

- [ ] **Step 5: Write the core RED tests**

Extend the core fixtures in `scripts/tests/protocol-atlas-core.spec.ts` with a small schema-2 generated artifact containing one definitive and one unresolved comparison. Do not duplicate the production manifest.

Add tests for:

- valid experiment/mode hash round-trips and fixed ordering;
- invalid or incomplete experiment/mode pairs recovering to Orientation with the existing notice;
- experiment selection moving to Explore/Implementation;
- selecting a different experiment choosing that experiment’s package fallback;
- reset returning the selected experiment to its fallback without clearing ordinary filters;
- leaving Explore or switching to Protocol clearing the comparison;
- ordinary filters remaining stored but inactive during a focused comparison;
- pure derivation of activated/bypassed/changed/unresolved targets and prerequisite status;
- deterministic delta counts and announcement text;
- focus intents for replacement radios after selection/reset;
- schema-1 generated data retaining the ordinary atlas while reporting Configuration Lab unavailable;
- one malformed schema-2 experiment being omitted without invalidating nodes, edges, or valid experiments.

Representative routing assertion:

```ts
expect(core().serializeHash(fixtureState({
  chapterId: "explore",
  layer: "implementation",
  configurationExperimentId: "negotiation-screen",
  configurationModeId: "enforce",
}))).toBe(
  "#chapter=explore&layer=implementation&experiment=negotiation-screen&mode=enforce",
);
```

Representative degradation assertion:

```ts
expect(core().configurationAvailability(fixtureGeneratedV1())).toEqual({
  available: false,
  experiments: [],
  errors: ["Configuration Lab unavailable for this artifact."],
});
```

- [ ] **Step 6: Run the core RED phase**

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts \
  -t "configuration|schema-1|experiment|prerequisite|focus"
```

Expected: FAIL because configuration state, hash fields, transitions, derivation, transient UI intents, and schema compatibility do not exist.

- [ ] **Step 7: Implement the core GREEN phase**

In `docs/protocol-atlas/atlas-core.js`:

- accept generated schema 1 and schema 2 for ordinary node/edge validation;
- treat schema 1 or a missing schema-2 configuration section as Configuration Lab unavailable, not as an ordinary atlas failure;
- validate each schema-2 experiment independently and return valid experiments plus per-record errors;
- parse `experiment` and `mode` only as a valid pair;
- serialize them after existing filters;
- clear the pair when leaving Explore or switching to Protocol;
- preserve general filters while the focused comparison is active;
- select the package fallback when an experiment is first selected or changed;
- reset only the active experiment’s mode to its package fallback while keeping the experiment focused and filters inactive;
- derive delta lists and counts without mutating generated data;
- keep bypassed targets in the comparison result rather than deleting them;
- return deterministic focus and live-announcement intents from configuration transitions;
- clear stale transient intents on the next transition;
- never infer a definitive delta when the generated record says unresolved.

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts \
  -t "configuration|schema-1|experiment|prerequisite|focus"
```

Expected: PASS.

- [ ] **Step 8: Write the renderer RED tests**

Use the existing Happy DOM renderer harness in `scripts/tests/protocol-atlas-core.spec.ts`. Extend the static CSS contract in `scripts/tests/build-protocol-atlas.spec.ts` for effective 44px controls, literal non-color delta labels/pattern hooks, focus-visible treatment, reduced motion, and bounded 900px/640px/375px layouts. Add renderer tests proving:

1. Explore contains the Configuration Lab as a subsection, not navigation chapter eight;
2. the disclaimer is permanently visible;
3. experiments and modes use semantic `<fieldset>`, `<legend>`, and radio controls with no text/number input;
4. exact assignments, fallback/resolved values, prerequisites, evidence paths/symbols, behavior-test citations, explanations, and caveats render as text;
5. choosing a mode updates the canonical hash and focused topology;
6. Back, Forward, and reload restore the experiment/mode pair;
7. switching experiment focuses the replacement fallback radio;
8. mode/reset rerenders preserve focus on the replacement radio;
9. the live region announces experiment, mode, and counts for all four delta kinds;
10. activated, bypassed, changed, and unresolved targets receive text badges and distinct classes/patterns;
11. bypassed topology remains present but visually secondary;
12. ordinary filters remain stored but inactive while any experiment—including its fallback mode—is focused, and become active again only after leaving the Configuration Lab focus;
13. schema 1 shows exactly `Configuration Lab unavailable for this artifact.` while ordinary Explore remains usable;
14. one malformed experiment is omitted with a concise banner and `console.error`, while another valid experiment remains usable;
15. an experiment with no valid reviewed deltas renders an explicit unresolved/empty state;
16. no rendered copy claims to show local, test, development, Railway, or production values.

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts scripts/tests/build-protocol-atlas.spec.ts \
  -t "Configuration Lab|configuration fieldset|configuration CSS|delta|replacement radio|artifact"
```

Expected: FAIL because the renderer and CSS do not yet implement the lab or its static contracts.

- [ ] **Step 9: Implement the renderer and CSS GREEN phase**

In `docs/protocol-atlas/atlas.js`:

- render the lab only inside Explore;
- render the permanent disclaimer, coverage note, experiment fieldset, named-mode radio group, reset action, and evidence panel;
- show fallback versus selected-mode assignments and resolved values without executing protocol code;
- show prerequisites as satisfied, unmet, or protocol-boundary/unresolved based only on generated records;
- reuse the existing node/edge topology and overlay generated deltas;
- retain all bypassed and unaffected topology, dimming rather than removing it;
- include a textual delta list carrying the same meaning as the diagram;
- suspend general filter application while an experiment is focused, including its fallback mode, without clearing filter state; restore filter application only after leaving the Configuration Lab focus;
- apply `focusIntent` after replacement DOM exists and announce `announcement` through `#atlas-status`;
- preserve canonical hash/history behavior through existing `dispatch`, `syncHash`, and `hashchange` paths;
- isolate malformed experiments and log developer detail without disabling ordinary implementation evidence;
- render schema-1 degradation with the approved unavailable message;
- never access `process.env`, `.env` files, storage, network APIs, Railway, runtime telemetry, or host implementation data.

In `docs/protocol-atlas/atlas.css`, add non-color-only styles:

```css
.configuration-delta--activated { /* + badge plus distinct solid/double treatment */ }
.configuration-delta--bypassed { /* − badge, patterned/dimmed but still visible */ }
.configuration-delta--changed { /* ~ badge plus distinct dashed treatment */ }
.configuration-delta--unresolved { /* ? badge plus dotted/hatch treatment */ }
```

Also add:

- layout for the fieldsets, mode radios, assignment table/list, prerequisite/caveat panels, coverage note, and textual delta summary;
- minimum 44px targets for radios and reset controls;
- visible `:focus-visible` treatment;
- grayscale-distinguishable patterns and literal `+ activated`, `− bypassed`, `~ changed`, and `? unresolved` labels;
- `prefers-reduced-motion` compliance;
- stacked, overflow-safe behavior at 900px, 640px, and 375px;
- no horizontal body overflow or precision interaction requirement.

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts scripts/tests/build-protocol-atlas.spec.ts \
  -t "Configuration Lab|configuration fieldset|configuration CSS|delta|replacement radio|artifact"
```

Expected: PASS.

- [ ] **Step 10: Regenerate schema 2 and run all automated Task 8 validation**

Run:

```bash
bun run build:protocol-atlas
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
bunx eslint scripts/build-protocol-atlas.ts \
  scripts/tests/build-protocol-atlas.spec.ts \
  scripts/tests/protocol-atlas-core.spec.ts \
  docs/protocol-atlas/atlas-content.js \
  docs/protocol-atlas/atlas-core.js \
  docs/protocol-atlas/atlas.js
```

Expected:

- all tests and lint checks PASS;
- the committed artifact has `schemaVersion: 2`;
- the artifact reports exactly 20 experiments and 61 modes;
- `--check` reports the artifact current;
- repeated generation is byte-identical.

Run all unique DB-free behavior-test citations from the generated configuration evidence:

```bash
set -euo pipefail
ATLAS_BEHAVIOR_TEST_OUTPUT="$(bun -e '
    await import("./docs/protocol-atlas/protocol.generated.js");
    const generated = globalThis.ProtocolAtlasGenerated;
    const paths = new Set();
    for (const experiment of generated.configurationExperiments ?? []) {
      for (const mode of experiment.modes ?? []) {
        for (const delta of mode.deltas ?? []) {
          if (delta.behaviorTest?.path) paths.add(delta.behaviorTest.path);
        }
      }
    }
    process.stdout.write([...paths].sort().join("\n"));
  '
)"
if [[ -z "${ATLAS_BEHAVIOR_TEST_OUTPUT//[$'\t\r\n ']/}" ]]; then
  echo "No Configuration Lab behavior-test citations were generated" >&2
  exit 1
fi
mapfile -t ATLAS_BEHAVIOR_TESTS < <(printf '%s\n' "$ATLAS_BEHAVIOR_TEST_OUTPUT" | grep -v '^$')
for test_path in "${ATLAS_BEHAVIOR_TESTS[@]}"; do
  if [[ ! -f "$test_path" ]]; then
    echo "Missing cited behavior test: $test_path" >&2
    exit 1
  fi
done
bun test "${ATLAS_BEHAVIOR_TESTS[@]}"
```

Expected: every cited behavior test PASS. Do not cite or run database-backed tests, provider-backed tests, live evals, or host tests.

Run boundary and determinism assertions:

```bash
rg -n \
  'services/api|apps/|src/controllers|src/services|src/adapters|src/queues|Railway|generatedAt|timestamp' \
  docs/protocol-atlas/atlas-content.js \
  docs/protocol-atlas/protocol.generated.js \
  scripts/build-protocol-atlas.ts

rg -n \
  'process\.env|Bun\.env|dotenv|--env-file|readFile[^;]*\.env|Bun\.file[^;]*\.env' \
  scripts/build-protocol-atlas.ts \
  docs/protocol-atlas/atlas-content.js \
  docs/protocol-atlas/atlas-core.js \
  docs/protocol-atlas/atlas.js
```

Expected:

- no concrete host path or timestamp is emitted;
- any occurrence of `process.env` in the generator is syntax-analysis code or the controlled sentinel test, never a value read used as atlas content;
- runtime assets contain no environment inspection.

- [ ] **Step 11: Perform focused browser acceptance**

Open `docs/protocol-atlas/index.html` directly from `file://` and through:

```bash
python3 -m http.server 4173 --directory docs/protocol-atlas
```

Verify in both contexts:

1. navigation remains exactly seven chapters and five flows;
2. Explore contains the Configuration Lab;
3. the disclaimer and coverage note are always visible;
4. one definitive experiment shows fallback versus selected assignments and correct activated/bypassed/changed evidence;
5. one unresolved contract shows `? unresolved` without an invented consumer;
6. switching experiments selects the new fallback;
7. reset preserves ordinary filters;
8. deep link, reload, Back, and Forward restore the exact pair;
9. keyboard-only radio/reset operation preserves focus;
10. the live region announces experiment, mode, and four delta counts;
11. delta meaning remains legible in grayscale and without color;
12. reduced-motion behavior is static;
13. 1440px, 900px, 640px, and 375px layouts have no body overflow;
14. no external request, active environment value, host inspection, or console error occurs.

Stop the HTTP server after verification.

- [ ] **Step 12: Commit the Configuration Lab**

```bash
git add scripts/build-protocol-atlas.ts \
  scripts/tests/build-protocol-atlas.spec.ts \
  scripts/tests/protocol-atlas-core.spec.ts \
  docs/protocol-atlas/atlas-content.js \
  docs/protocol-atlas/atlas-core.js \
  docs/protocol-atlas/atlas.js \
  docs/protocol-atlas/atlas.css \
  docs/protocol-atlas/protocol.generated.js
git commit -m "feat(docs): add protocol atlas configuration lab"
```

No `packages/protocol` source, package metadata, lockfile, HTML shell, spec, or plan file belongs in the Task 8 implementation commit.

---

### Task 9: Version, verify, and prepare the branch for review

**Files:**
- Modify: `packages/protocol/package.json`
- Modify: `packages/protocol/CHANGELOG.md`
- Modify: `bun.lock`
- Regenerate: `docs/protocol-atlas/protocol.generated.js`
- Keep during Task 9 and final review:
  - `docs/superpowers/specs/2026-08-07-protocol-atlas-design.md`
  - `docs/superpowers/plans/2026-08-07-protocol-atlas.md`

**Interfaces:**
- No new runtime interface. This task proves the complete documented contract and packages the tooling-only protocol change correctly.

- [ ] **Step 1: Bump the protocol patch version**

Change `packages/protocol/package.json` from the current `10.0.3` to `10.0.4`. If the branch is rebased onto a newer protocol version before execution, increment that current version's patch instead; do not lower or reuse a published base version.

- [ ] **Step 2: Add the changelog entry**

Under `## [Unreleased]` → `### Added`, add:

```md
- Add the protocol-only Guided Atlas, deterministic architecture inventory
  generator, and source-evidenced Configuration Lab. The atlas explains
  normative concepts, the current `packages/protocol` reference implementation,
  and counterfactual behavior-gate changes, while live environment values and
  concrete API or host implementations remain outside its scope. Tooling-only
  public-package change; no root export or runtime behavior changes.
```

Also note the extracted capability metadata helper under `### Changed` if that heading exists; otherwise add it:

```md
### Changed
- Share capability classification metadata between the existing architecture
  boundary gate and the protocol atlas generator; allowed dependency directions
  are unchanged.
```

- [ ] **Step 3: Regenerate the root lockfile and atlas**

Run:

```bash
bun install
bun run build:protocol-atlas
```

Expected: `bun.lock` records the new workspace version and the generated artifact is deterministic.

- [ ] **Step 4: Run protocol architecture checks affected by helper extraction**

Run:

```bash
cd packages/protocol
bun run architecture:exports
bun run architecture:host-isolation
bun run architecture:capabilities
bun run architecture:cycles
bun test scripts/architecture/tests/capability-model.spec.ts scripts/architecture/tests/module-graph.spec.ts
bun run build
cd ../..
```

Expected: all commands PASS. Do not run live evals or database-backed tests.

- [ ] **Step 5: Run atlas and repository targeted checks**

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
bunx eslint packages/protocol/scripts/architecture/capability-model.ts \
  packages/protocol/scripts/architecture/capability-boundaries.ts \
  packages/protocol/scripts/architecture/tests/capability-model.spec.ts \
  scripts/build-protocol-atlas.ts scripts/tests/build-protocol-atlas.spec.ts \
  scripts/tests/protocol-atlas-core.spec.ts docs/protocol-atlas/*.js
bun run check:subtree-parity
```

Expected: all commands PASS with zero lint errors.

- [ ] **Step 6: Perform manual browser acceptance from `file://`**

Open `docs/protocol-atlas/index.html` directly and verify:

1. seven chapters and five guided flows;
2. Protocol/Implementation switching without losing position;
3. node selection, inspector, Show code, and copy path;
4. search, filters, reset, and empty states;
5. deep links, reload, and back/forward;
6. keyboard-only flow, visible focus, and Escape behavior;
7. reduced-motion mode;
8. 1440px and 375px layouts without body overflow;
9. no console errors and no network requests;
10. no API implementation node, path, or explanation;
11. exactly 20 Configuration Lab experiments and 61 named modes;
12. one definitive and one unresolved configuration comparison;
13. disclaimer, coverage note, assignments, prerequisites, and evidence;
14. configuration deep links, Back/Forward, reset, radio focus, and live announcements;
15. `+`, `−`, `~`, and `?` delta semantics remain legible without color.

Record concise manual notes in the eventual PR description.

- [ ] **Step 7: Perform manual acceptance from a static HTTP server**

Run from the repository root:

```bash
python3 -m http.server 4173 --directory docs/protocol-atlas
```

Open `http://127.0.0.1:4173/`, repeat one full guided flow, a search, a deep-link reload, and an inspector/code disclosure. Stop the server after verification. Expected: behavior matches `file://` and no external request occurs.

- [ ] **Step 8: Review the final diff for protocol-only scope**

Run:

```bash
git diff --check origin/dev...HEAD
git diff --name-only origin/dev...HEAD
git diff --check
git diff --name-only
git diff --cached --check
git diff --cached --name-only
rg -n "services/api|apps/web|src/controllers|src/services|src/adapters|src/queues" docs/protocol-atlas scripts/build-protocol-atlas.ts
```

Expected: the `rg` command returns no matches in atlas content/generator. Package architecture tooling and documentation are the only protocol-adjacent changes.

- [ ] **Step 9: Confirm review artifacts remain available**

```bash
test -f docs/superpowers/specs/2026-08-07-protocol-atlas-design.md
test -f docs/superpowers/plans/2026-08-07-protocol-atlas.md
```

Expected: both commands succeed so the Task 9 and whole-branch reviewers can read the approved requirements. The coordinator removes these files only after final review is clean.

- [ ] **Step 10: Commit release metadata and final verification state**

```bash
git add packages/protocol/package.json packages/protocol/CHANGELOG.md bun.lock \
  docs/protocol-atlas/protocol.generated.js
git commit -m "chore(protocol): prepare protocol atlas release"
```

- [ ] **Step 11: Verify the final clean state**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git diff --check origin/dev...HEAD
```

Expected: clean worktree, only intentional commits, and no whitespace errors.

---

## Post-review cleanup

After the whole-branch review is clean and any reviewed fix wave is complete, the coordinator must remove the transient artifacts before invoking branch-finishing workflow:

```bash
git rm -f docs/superpowers/specs/2026-08-07-protocol-atlas-design.md \
  docs/superpowers/plans/2026-08-07-protocol-atlas.md
git commit -m "chore: remove protocol atlas planning artifacts"
```

Then rerun `git diff --check origin/dev...HEAD` and `git status --short --branch`. This deletion happens after review by explicit user ruling because the SDD review packages require the plan file.

## Completion Evidence

The implementation handoff must report:

- changed files grouped by architecture metadata, generator, static site, tests, and release metadata;
- exact command outputs and exit codes for every targeted check;
- generated inventory node/edge counts plus exact configuration experiment/mode counts;
- manual `file://` and HTTP browser acceptance notes, including one definitive and one unresolved configuration comparison;
- explicit confirmation that atlas evidence paths are `packages/protocol`-only;
- explicit confirmation that no concrete API component is depicted or explained;
- accessibility and responsive checks performed;
- residual risks or intentionally omitted relationships;
- final commit hashes and worktree status.
