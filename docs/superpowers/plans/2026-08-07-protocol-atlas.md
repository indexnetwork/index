# Protocol Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free, graphical Guided Atlas that explains only `packages/protocol`, with curated protocol narratives and a deterministic protocol-source inventory.

**Architecture:** A classic-script static microsite under `docs/protocol-atlas/` reads one hand-authored content global and one generated inventory global. A protocol-only Bun generator validates selected package exports, source paths, capability ownership, typed relationships, and curated references; a pure browser/Bun core owns routing, search, filters, and selection state; a thin DOM layer renders the Technical Blueprint experience.

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
- Keep the first release to seven chapters, five guided flows, and a selected core inventory—not a full package catalog.
- Meet WCAG 2.2 AA contrast for text and controls; support keyboard use, visible focus, SVG descriptions, reduced motion, and narrow layouts.
- Follow the repository's targeted-validation policy; do not run database-backed tests.

---

## File Structure

### Protocol architecture metadata

- Create `packages/protocol/scripts/architecture/capability-model.ts` — reusable capability names, canonical/legacy directory normalization, allowed directions, and source-path classification.
- Modify `packages/protocol/scripts/architecture/capability-boundaries.ts` — consume the shared model without changing the architecture gate's behavior.
- Create `packages/protocol/scripts/architecture/tests/capability-model.spec.ts` — lock canonical, compatibility, runtime-shell, and neutral shared classifications.

### Generator and tests

- Create `scripts/build-protocol-atlas.ts` — pure data contracts, selected core manifest, protocol-only source loading, validation, deterministic JavaScript serialization, write/check CLI.
- Create `scripts/tests/build-protocol-atlas.spec.ts` — generator, boundary, determinism, cross-reference, and stale-artifact tests.
- Modify `package.json` — add `build:protocol-atlas` and `check:protocol-atlas` scripts.

### Static atlas

- Create `docs/protocol-atlas/index.html` — semantic shell, landmarks, fallback, and classic asset ordering.
- Create `docs/protocol-atlas/atlas.css` — Technical Blueprint visual system and responsive/accessibility states.
- Create `docs/protocol-atlas/atlas-core.js` — environment-neutral global with data validation, routing, transition, search, and graph filtering.
- Create `docs/protocol-atlas/atlas.js` — DOM bootstrap, chapter/step rendering, SVG diagrams, inspector, controls, history, and graceful degradation.
- Create `docs/protocol-atlas/atlas-content.js` — seven chapters, five flows, concepts, invariants, vocabulary, and curated conceptual relationships.
- Create `docs/protocol-atlas/protocol.generated.js` — committed output from the generator; never hand-edit.
- Create `scripts/tests/protocol-atlas-core.spec.ts` — pure behavior tests for the classic-script core.

### Release/documentation

- Modify `packages/protocol/package.json` — patch version bump because protocol architecture tooling changes.
- Modify `packages/protocol/CHANGELOG.md` — record the architecture metadata extraction and atlas.
- Modify `bun.lock` — regenerate after the package version changes.
- Delete the related `docs/superpowers/specs/2026-08-07-protocol-atlas-design.md` and `docs/superpowers/plans/2026-08-07-protocol-atlas.md` before branch closeout, as required by repository policy.

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

### Task 8: Version, verify, and prepare the branch for review

**Files:**
- Modify: `packages/protocol/package.json`
- Modify: `packages/protocol/CHANGELOG.md`
- Modify: `bun.lock`
- Regenerate: `docs/protocol-atlas/protocol.generated.js`
- Delete before final branch commit:
  - `docs/superpowers/specs/2026-08-07-protocol-atlas-design.md`
  - `docs/superpowers/plans/2026-08-07-protocol-atlas.md`

**Interfaces:**
- No new runtime interface. This task proves the complete documented contract and packages the tooling-only protocol change correctly.

- [ ] **Step 1: Bump the protocol patch version**

Change `packages/protocol/package.json` from `10.0.1` to `10.0.2`. If the branch is rebased onto a newer protocol version before execution, increment that current version's patch instead; do not lower or reuse a published base version.

- [ ] **Step 2: Add the changelog entry**

Under `## [Unreleased]` → `### Added`, add:

```md
- Add the protocol-only Guided Atlas and deterministic architecture inventory
  generator. The atlas explains normative concepts and the current
  `packages/protocol` reference implementation, while concrete API and host
  implementations remain outside its scope. Tooling-only public-package
  change; no root export or runtime behavior changes.
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
10. no API implementation node, path, or explanation.

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
rg -n "services/api|apps/web|src/controllers|src/services|src/adapters|src/queues" docs/protocol-atlas scripts/build-protocol-atlas.ts
```

Expected: the `rg` command returns no matches in atlas content/generator. Package architecture tooling and documentation are the only protocol-adjacent changes.

- [ ] **Step 9: Remove transient superpowers artifacts before branch finishing**

```bash
git rm -f docs/superpowers/specs/2026-08-07-protocol-atlas-design.md \
  docs/superpowers/plans/2026-08-07-protocol-atlas.md
```

This is required by the repository Development Reference. Preserve the approved decisions in the permanent atlas content, generator tests, changelog, and PR description.

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

## Completion Evidence

The implementation handoff must report:

- changed files grouped by architecture metadata, generator, static site, tests, and release metadata;
- exact command outputs and exit codes for every targeted check;
- generated inventory node/edge counts;
- manual `file://` and HTTP browser acceptance notes;
- explicit confirmation that atlas evidence paths are `packages/protocol`-only;
- explicit confirmation that no concrete API component is depicted or explained;
- accessibility and responsive checks performed;
- residual risks or intentionally omitted relationships;
- final commit hashes and worktree status.
