import { beforeAll, describe, expect, test } from "bun:test";

type AtlasCore = {
  defaultState(): Record<string, unknown>;
  parseHash(hash: string, content: ReturnType<typeof fixtureContent>, generated: ReturnType<typeof fixtureGenerated>): Record<string, unknown>;
  serializeHash(state: Record<string, unknown>): string;
  transition(state: Record<string, unknown>, action: Record<string, unknown>, content: ReturnType<typeof fixtureContent>, generated: ReturnType<typeof fixtureGenerated>): Record<string, unknown>;
  validateData(content: unknown, generated: unknown): { ok: boolean; errors: string[] };
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
      { id: "resolve-effective-scope", title: "Resolve scope", nodeIds: ["component.opportunity-graph-factory"] },
      { id: "retrieve-candidates", title: "Retrieve candidates" },
      { id: "evaluate-fit", title: "Evaluate fit", nodeIds: ["component.opportunity-evaluator"] },
    ],
  }, {
    id: "external-agent-mcp",
    chapterId: "runtime",
    steps: [{ id: "invocation-runtime", title: "Invocation runtime" }],
  }],
  concepts: [{ id: "opportunity", title: "Opportunity", summary: "A participant-visible evaluated match." }],
  invariants: [{ id: "candidate-private", text: "Candidates remain private." }],
  vocabulary: [], relationships: [],
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
  test("returns a fresh state with the stable public shape", () => {
    const first = core().defaultState();
    const second = core().defaultState();
    expect(first).toEqual(fixtureState());
    expect(first).not.toBe(second);
    expect(first.filters).not.toBe(second.filters);
  });

  test("round-trips chapter, step, layer, selected node, and filters", () => {
    const state = fixtureState({
      chapterId: "discovery",
      stepId: "evaluate-fit",
      layer: "implementation",
      selectedNodeId: "component.opportunity-evaluator",
      filters: { capabilities: ["opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] },
    });
    expect(core().parseHash(core().serializeHash(state), fixtureContent(), fixtureGenerated())).toEqual(state);
  });

  test("serializes fields in fixed order, omits defaults, and sorts filters", () => {
    const state = fixtureState({
      selectedNodeId: "component.opportunity-evaluator",
      filters: { capabilities: ["signals", "opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] },
    });
    expect(core().serializeHash(state)).toBe(
      "#node=component.opportunity-evaluator&capabilities=opportunities%2Csignals&kinds=agent&edgeKinds=runtime",
    );
    expect(core().serializeHash(fixtureState())).toBe("#");
  });

  test("recovers invalid state to orientation with a notice", () => {
    expect(core().parseHash("#chapter=missing&layer=nope", fixtureContent(), fixtureGenerated())).toMatchObject({
      chapterId: "orientation",
      layer: "protocol",
      notice: "That atlas location no longer exists. Returned to Orientation.",
    });
  });

  test("rejects invalid steps, selected nodes, and filters as one invalid location", () => {
    for (const hash of [
      "#chapter=discovery&step=missing",
      "#node=component.missing",
      "#capabilities=unknown",
    ]) {
      expect(core().parseHash(hash, fixtureContent(), fixtureGenerated())).toEqual(fixtureState({
        notice: "That atlas location no longer exists. Returned to Orientation.",
      }));
    }
  });
});

describe("ProtocolAtlasCore data validation", () => {
  test("accepts valid content and generated data", () => {
    expect(core().validateData(fixtureContent(), fixtureGenerated())).toEqual({ ok: true, errors: [] });
  });

  test("reports malformed non-array curated nodeIds", () => {
    const content = fixtureContent();
    const discoveryFlow = content.flows[0];
    const malformed = {
      ...content,
      flows: [{
        ...discoveryFlow,
        steps: [
          { ...discoveryFlow.steps[0], nodeIds: "component.missing" },
          ...discoveryFlow.steps.slice(1),
        ],
      }, ...content.flows.slice(1)],
    };

    expect(core().validateData(malformed, fixtureGenerated())).toEqual({
      ok: false,
      errors: ["curated nodeIds must be an array"],
    });
  });

  test("reports schema, duplicate, membership, endpoint, and curated node failures", () => {
    const validContent = fixtureContent();
    const validGenerated = fixtureGenerated();
    const discoveryFlow = validContent.flows[0];
    const content = {
      ...validContent,
      schemaVersion: 2,
      chapters: [
        ...validContent.chapters.slice(0, 2),
        { ...validContent.chapters[2], stepIds: ["invocation-runtime", "missing-step"] },
        { ...validContent.chapters[0] },
      ],
      flows: [{
        ...discoveryFlow,
        steps: [
          { ...discoveryFlow.steps[0], nodeIds: ["component.opportunity-graph-factory", "component.missing"] },
          ...discoveryFlow.steps.slice(1),
        ],
      }, ...validContent.flows.slice(1), { ...discoveryFlow }],
      concepts: [...validContent.concepts, { ...validContent.concepts[0] }],
      invariants: [...validContent.invariants, { ...validContent.invariants[0] }],
    };
    const generated = {
      ...validGenerated,
      nodes: [...validGenerated.nodes, { ...validGenerated.nodes[0] }],
      edges: [
        { ...validGenerated.edges[0], targetId: "component.missing" },
        { ...validGenerated.edges[0] },
      ],
    };

    const result = core().validateData(content, generated);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("schemaVersion");
    for (const category of ["chapter", "flow", "concept", "invariant", "node", "edge"]) {
      expect(result.errors.join("\n")).toContain(`duplicate ${category} id`);
    }
    expect(result.errors.join("\n")).toContain("missing-step");
    expect(result.errors.join("\n")).toContain("component.missing");
  });

  test("returns validation errors instead of throwing on missing runtime data", () => {
    expect(() => core().validateData(null, undefined)).not.toThrow();
    expect(core().validateData(null, undefined).ok).toBe(false);
  });
});

describe("ProtocolAtlasCore transitions", () => {
  test("selects chapters and steps and clears stale selections", () => {
    const selected = fixtureState({ selectedNodeId: "component.opportunity-evaluator", notice: "old" });
    const chapter = core().transition(selected, { type: "select-chapter", chapterId: "discovery" }, fixtureContent(), fixtureGenerated());
    expect(chapter).toMatchObject({
      chapterId: "discovery",
      stepId: "resolve-effective-scope",
      selectedNodeId: null,
      notice: null,
    });
    expect(core().transition(chapter, { type: "select-step", stepId: "evaluate-fit" }, fixtureContent(), fixtureGenerated()))
      .toMatchObject({ chapterId: "discovery", stepId: "evaluate-fit" });
  });

  test("moves within a flow and stops at declared boundaries", () => {
    const middle = fixtureState({ chapterId: "discovery", stepId: "retrieve-candidates" });
    expect(core().transition(middle, { type: "next-step" }, fixtureContent(), fixtureGenerated()).stepId)
      .toBe("evaluate-fit");
    expect(core().transition(middle, { type: "previous-step" }, fixtureContent(), fixtureGenerated()).stepId)
      .toBe("resolve-effective-scope");
    const last = fixtureState({ chapterId: "discovery", stepId: "evaluate-fit" });
    expect(core().transition(last, { type: "next-step" }, fixtureContent(), fixtureGenerated()).stepId)
      .toBe("evaluate-fit");
  });

  test("preserves chapter and step while switching layers", () => {
    const state = fixtureState({ chapterId: "runtime", stepId: "invocation-runtime" });
    expect(core().transition(state, { type: "set-layer", layer: "implementation" }, fixtureContent(), fixtureGenerated()))
      .toMatchObject({ chapterId: "runtime", stepId: "invocation-runtime", layer: "implementation" });
  });

  test("updates node, query, and filters without mutating the prior state", () => {
    const state = fixtureState();
    const withNode = core().transition(state, { type: "select-node", nodeId: "component.opportunity-evaluator" }, fixtureContent(), fixtureGenerated());
    const withQuery = core().transition(withNode, { type: "set-query", query: " fit " }, fixtureContent(), fixtureGenerated());
    const withFilters = core().transition(withQuery, {
      type: "set-filters",
      filters: { capabilities: ["opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] },
    }, fixtureContent(), fixtureGenerated());
    expect(state).toEqual(fixtureState());
    expect(withFilters).toMatchObject({
      selectedNodeId: "component.opportunity-evaluator",
      query: " fit ",
      filters: { capabilities: ["opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] },
    });
    expect(core().transition(withFilters, { type: "reset-filters" }, fixtureContent(), fixtureGenerated()).filters)
      .toEqual({ capabilities: [], kinds: [], edgeKinds: [] });
  });
});

describe("ProtocolAtlasCore search and filters", () => {
  test("ranks exact symbol matches before summary matches", () => {
    expect(core().searchItems("OpportunityGraphFactory", fixtureContent(), fixtureGenerated())[0].id)
      .toBe("component.opportunity-graph-factory");
  });

  test("ranks prefix matches before tokenized summary matches", () => {
    const generated = fixtureGenerated();
    generated.nodes.push({
      id: "component.summary-only",
      label: "Evaluator internals",
      symbol: "InternalEvaluator",
      capability: "opportunities",
      kind: "agent",
      summary: "Opportunity evaluation details.",
    });
    expect(core().searchItems("Opportunity", fixtureContent(), generated).map(({ id }) => id).slice(0, 3)).toEqual([
      "opportunity",
      "component.opportunity-graph-factory",
      "component.opportunity-evaluator",
    ]);
    expect(core().searchItems("   ", fixtureContent(), generated)).toEqual([]);
    expect(core().searchItems("definitely absent", fixtureContent(), generated)).toEqual([]);
  });

  test("composes capability, kind, and edge-kind filters", () => {
    expect(core().filterGraph({ capabilities: ["opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] }, fixtureGenerated()))
      .toEqual(expectedOpportunityAgentSubgraph());
  });
});
