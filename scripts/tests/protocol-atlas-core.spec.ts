import { beforeAll, describe, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";

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
    { id: "explore", title: "Explore", stepIds: [] },
  ],
  flows: [{
    id: "discover-opportunity",
    chapterId: "discovery",
    steps: [
      {
        id: "resolve-effective-scope", title: "Resolve scope", summary: "Resolve eligible scope.",
        conceptIds: ["opportunity"], nodeIds: ["component.opportunity-graph-factory"],
        sourcePaths: ["packages/protocol/src/opportunity/application/opportunity.graph.ts"],
        previous: null, next: "retrieve-candidates",
      },
      {
        id: "retrieve-candidates", title: "Retrieve candidates", summary: "Retrieve private candidates.",
        conceptIds: ["opportunity"], nodeIds: ["component.opportunity-graph-factory"],
        sourcePaths: ["packages/protocol/src/opportunity/application/opportunity.graph.ts"],
        previous: "resolve-effective-scope", next: "evaluate-fit",
      },
      {
        id: "evaluate-fit", title: "Evaluate fit", summary: "Evaluate candidate fit.",
        conceptIds: ["opportunity"], nodeIds: ["component.opportunity-evaluator"],
        sourcePaths: ["packages/protocol/src/opportunity/application/opportunity.evaluator.ts"],
        previous: "retrieve-candidates", next: null,
      },
    ],
  }, {
    id: "external-agent-mcp",
    chapterId: "runtime",
    steps: [{ id: "invocation-runtime", title: "Invocation runtime" }],
  }],
  concepts: [{ id: "opportunity", title: "Opportunity", summary: "A participant-visible evaluated match.", normative: true }],
  invariants: [{ id: "candidate-private", text: "Candidates remain private." }],
  vocabulary: [], relationships: [],
});
const fixtureGenerated = () => ({
  schemaVersion: 1,
  nodes: [
    {
      id: "component.opportunity-graph-factory", label: "OpportunityGraphFactory", symbol: "OpportunityGraphFactory",
      capability: "opportunities", kind: "graph-factory", summary: "Runs discovery.",
      sourcePath: "packages/protocol/src/opportunity/application/opportunity.graph.ts",
    },
    {
      id: "component.opportunity-evaluator", label: "Opportunity Evaluator", symbol: "OpportunityEvaluator",
      capability: "opportunities", kind: "agent", summary: "Evaluates candidate fit.",
      sourcePath: "packages/protocol/src/opportunity/application/opportunity.evaluator.ts",
    },
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

type RendererHarness = {
  window: GlobalWindow;
  document: GlobalWindow["document"];
  cleanup(): void;
};

async function rendererHarness(options: { hash?: string; generated?: ReturnType<typeof fixtureGenerated> | null } = {}): Promise<RendererHarness> {
  const window = new GlobalWindow({ url: `file:///protocol-atlas/index.html${options.hash ?? ""}` });
  window.document.body.innerHTML = `
    <header><div id="atlas-layer-toggle"></div><button id="atlas-search" type="button">Search</button></header>
    <nav id="atlas-nav"></nav>
    <main id="atlas-main"><div id="atlas-notice"></div><section id="atlas-diagram"></section></main>
    <aside id="atlas-inspector"></aside><section id="atlas-filters"></section><p id="atlas-status"></p>
  `;

  const globals = ["document", "location", "history", "navigator", "Element", "matchMedia", "requestAnimationFrame", "getSelection", "addEventListener", "removeEventListener", "ProtocolAtlasContent", "ProtocolAtlasGenerated"] as const;
  const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const install = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  install("document", window.document);
  install("location", window.location);
  install("history", window.history);
  install("navigator", window.navigator);
  install("Element", window.Element);
  install("matchMedia", window.matchMedia.bind(window));
  install("requestAnimationFrame", (callback: FrameRequestCallback) => callback(0));
  install("getSelection", window.getSelection.bind(window));
  install("addEventListener", window.addEventListener.bind(window));
  install("removeEventListener", window.removeEventListener.bind(window));
  install("ProtocolAtlasContent", fixtureContent());
  install("ProtocolAtlasGenerated", options.generated === null ? undefined : (options.generated ?? fixtureGenerated()));

  await import(`../../docs/protocol-atlas/atlas.js?test=${crypto.randomUUID()}`);
  if (window.document.querySelectorAll("#atlas-nav button").length === 0) {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  }

  return {
    window,
    document: window.document,
    cleanup() {
      window.happyDOM.abort();
      for (const name of globals) {
        const descriptor = descriptors.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

function buttonWithText(document: GlobalWindow["document"], selector: string, text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)].find((button) => button.textContent?.includes(text));
}

function activeStep(document: GlobalWindow["document"]) {
  return document.querySelector('[aria-current="step"]')?.textContent;
}

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

  test("serializes filters in stable order and restores selected nodes", () => {
    const state = fixtureState({
      selectedNodeId: "component.opportunity-evaluator",
      filters: { capabilities: ["signals", "opportunities", "signals"], kinds: ["agent"], edgeKinds: ["runtime"] },
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

  test("moves within a flow and crosses to the declared next step only", () => {
    const start = fixtureState({ chapterId: "discovery", stepId: "retrieve-candidates" });
    expect(core().transition(start, { type: "next-step" }, fixtureContent(), fixtureGenerated()).stepId)
      .toBe("evaluate-fit");
    expect(core().transition(start, { type: "previous-step" }, fixtureContent(), fixtureGenerated()).stepId)
      .toBe("resolve-effective-scope");
    const last = fixtureState({ chapterId: "discovery", stepId: "evaluate-fit" });
    expect(core().transition(last, { type: "next-step" }, fixtureContent(), fixtureGenerated()).stepId)
      .toBe("evaluate-fit");
  });

  test("preserves chapter and step while switching layers", () => {
    const state = fixtureState({ chapterId: "runtime", stepId: "invocation-runtime", layer: "protocol" });
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

describe("Protocol Atlas guided renderer", () => {
  test("normalizes an implementation-layer bookmark to curated protocol when generated data is unavailable", async () => {
    const originalError = console.error;
    let harness: RendererHarness | undefined;
    console.error = () => {};
    try {
      harness = await rendererHarness({
        hash: "#chapter=discovery&step=retrieve-candidates&layer=implementation",
        generated: null,
      });
      expect(harness.document.querySelector('#atlas-layer-toggle [aria-pressed="true"]')?.textContent).toBe("protocol");
      expect(harness.document.querySelector<HTMLButtonElement>("#atlas-layer-toggle button:last-child")?.disabled).toBe(true);
      expect(harness.document.querySelector(".atlas-node strong")?.textContent).toBe("Opportunity");
      expect(harness.document.querySelector("#atlas-notice")?.textContent).toContain("Curated protocol chapters remain available");
    } finally {
      console.error = originalError;
      harness?.cleanup();
    }
  });

  test("does not assign a step source path or code disclosure to an unmapped normative concept", async () => {
    const harness = await rendererHarness();
    try {
      buttonWithText(harness.document, "#atlas-nav button", "Discovery")?.click();
      buttonWithText(harness.document, ".atlas-stepper button", "Retrieve candidates")?.click();
      buttonWithText(harness.document, ".atlas-node", "Opportunity")?.click();

      expect(harness.document.querySelector("#atlas-inspector-heading")?.textContent).toBe("Opportunity");
      expect([...harness.document.querySelectorAll(".atlas-metadata dt")].map((node) => node.textContent)).not.toContain("Source path");
      expect(harness.document.querySelector("#atlas-inspector details")).toBeNull();
    } finally {
      harness.cleanup();
    }
  });

  test("dispatches semantic step controls, describes SVGs, and excludes interactive controls from arrow navigation", async () => {
    const harness = await rendererHarness();
    try {
      buttonWithText(harness.document, "#atlas-nav button", "Discovery")?.click();
      expect(activeStep(harness.document)).toBe("Resolve scope");

      const svg = harness.document.querySelector(".atlas-diagram-canvas svg");
      expect(svg?.querySelector("title")?.textContent).toContain("Resolve scope");
      expect(svg?.querySelector("desc")?.textContent).toContain("ordered nodes");

      const stepActions = harness.document.querySelectorAll<HTMLButtonElement>(".atlas-step-actions button");
      expect([...stepActions].map((button) => button.tagName)).toEqual(["BUTTON", "BUTTON"]);
      stepActions[1].click();
      expect(activeStep(harness.document)).toBe("Retrieve candidates");
      harness.document.querySelectorAll<HTMLButtonElement>(".atlas-step-actions button")[0].click();
      expect(activeStep(harness.document)).toBe("Resolve scope");

      harness.document.body.dispatchEvent(new harness.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(activeStep(harness.document)).toBe("Retrieve candidates");

      const input = harness.document.createElement("input");
      harness.document.body.append(input);
      input.focus();
      input.dispatchEvent(new harness.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(activeStep(harness.document)).toBe("Retrieve candidates");
      const searchButton = harness.document.querySelector<HTMLButtonElement>("#atlas-search");
      if (searchButton) searchButton.disabled = false;
      searchButton?.focus();
      searchButton?.dispatchEvent(new harness.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(activeStep(harness.document)).toBe("Retrieve candidates");

      harness.document.querySelectorAll<HTMLButtonElement>("#atlas-layer-toggle button")[1].click();
      harness.document.querySelector<HTMLButtonElement>(".atlas-node")?.click();
      const disclosure = harness.document.querySelector<HTMLDetailsElement>(".atlas-disclosure");
      const disclosureSummary = disclosure?.querySelector("summary");
      expect(disclosureSummary?.getAttribute("aria-expanded")).toBe("false");
      expect(disclosureSummary?.getAttribute("aria-controls")).toBe(disclosure?.querySelector(".atlas-code-evidence")?.id);
      if (disclosure) disclosure.open = true;
      const disclosureButton = disclosure?.querySelector<HTMLButtonElement>("button");
      expect(disclosureButton).not.toBeNull();
      disclosureButton?.focus();
      disclosureButton?.dispatchEvent(new harness.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(activeStep(harness.document)).toBe("Retrieve candidates");
    } finally {
      harness.cleanup();
    }
  });
});

describe("Protocol Atlas history, search, filters, and recovery", () => {
  test("writes user actions to the hash and restores state on hashchange", async () => {
    const harness = await rendererHarness();
    try {
      buttonWithText(harness.document, "#atlas-nav button", "Discovery")?.click();
      expect(harness.window.location.hash).toBe("#chapter=discovery&step=resolve-effective-scope");

      harness.window.location.hash = "#chapter=discovery&step=evaluate-fit&layer=implementation&node=component.opportunity-evaluator";
      harness.window.dispatchEvent(new harness.window.HashChangeEvent("hashchange"));
      expect(activeStep(harness.document)).toBe("Evaluate fit");
      expect(harness.document.querySelector('#atlas-layer-toggle [aria-pressed="true"]')?.textContent).toBe("implementation");
      expect(harness.document.querySelector("#atlas-inspector-heading")?.textContent).toBe("Opportunity Evaluator");
    } finally {
      harness.cleanup();
    }
  });

  test("searches concepts and components, navigates, closes, announces, and returns focus", async () => {
    const harness = await rendererHarness();
    try {
      const searchButton = harness.document.querySelector<HTMLButtonElement>("#atlas-search");
      searchButton?.click();
      expect(searchButton?.getAttribute("aria-expanded")).toBe("true");
      expect(searchButton?.getAttribute("aria-controls")).toBe("atlas-search-dialog");
      expect(harness.document.querySelector("[data-atlas-search]")?.getAttribute("role")).toBe("dialog");
      const input = harness.document.querySelector<HTMLInputElement>("[data-atlas-search] input[type='search']");
      expect(input).not.toBeNull();
      if (!input) return;
      input.value = "OpportunityGraphFactory";
      input.dispatchEvent(new harness.window.Event("input", { bubbles: true }));
      const result = harness.document.querySelector<HTMLButtonElement>(".atlas-search-results button");
      expect(result?.textContent).toContain("OpportunityGraphFactory");
      expect(result?.textContent).toContain("opportunities");
      result?.click();
      expect(searchButton?.getAttribute("aria-expanded")).toBe("false");
      expect(harness.document.activeElement?.id).toBe("atlas-search");
      expect(harness.document.querySelector('#atlas-layer-toggle [aria-pressed="true"]')?.textContent).toBe("implementation");
      expect(harness.document.querySelector("#atlas-inspector-heading")?.textContent).toContain("Opportunity");
      expect(harness.document.querySelector("#atlas-status")?.textContent).toContain("Navigated");
    } finally {
      harness.cleanup();
    }
  });

  test("shows an explicit empty search state with a query reset", async () => {
    const harness = await rendererHarness();
    try {
      harness.document.querySelector<HTMLButtonElement>("#atlas-search")?.click();
      const input = harness.document.querySelector<HTMLInputElement>("[data-atlas-search] input[type='search']");
      if (!input) return;
      input.value = "definitely absent";
      input.dispatchEvent(new harness.window.Event("input", { bubbles: true }));
      expect(harness.document.querySelector(".atlas-search-empty")?.textContent).toContain("No atlas concepts or components match");
      buttonWithText(harness.document, "[data-atlas-search] button", "Reset query")?.click();
      expect(input.value).toBe("");
    } finally {
      harness.cleanup();
    }
  });

  test("renders composed implementation filters, an empty subgraph, and a reset", async () => {
    const generated = fixtureGenerated();
    generated.nodes.push({
      id: "component.signal-tool", label: "Signal Tool", symbol: "SignalTool", capability: "signals",
      kind: "tool-family", summary: "Handles signals.", sourcePath: "packages/protocol/src/signals/tool.ts",
    });
    const harness = await rendererHarness({ generated });
    try {
      buttonWithText(harness.document, "#atlas-nav button", "Explore")?.click();
      const opportunities = harness.document.querySelector<HTMLInputElement>('#atlas-filters input[name="capabilities"][value="opportunities"]');
      const tool = harness.document.querySelector<HTMLInputElement>('#atlas-filters input[name="kinds"][value="tool-family"]');
      expect(opportunities).not.toBeNull();
      expect(tool).not.toBeNull();
      opportunities?.click();
      harness.document.querySelector<HTMLInputElement>('#atlas-filters input[name="kinds"][value="tool-family"]')?.click();
      expect(harness.document.querySelector(".atlas-filter-empty")?.textContent).toContain("No components match these filters");
      buttonWithText(harness.document, ".atlas-filter-empty button", "Reset filters")?.click();
      expect(harness.document.querySelectorAll(".atlas-node").length).toBe(3);
    } finally {
      harness.cleanup();
    }
  });

  test("recovers invalid hashes and omits malformed generated edges without dropping generated nodes", async () => {
    const invalid = await rendererHarness({ hash: "#chapter=missing" });
    try {
      expect(invalid.document.querySelector("#atlas-title")?.textContent).toBe("Orientation");
      expect(invalid.document.querySelector("#atlas-notice")?.textContent).toContain("Returned to Orientation");
    } finally {
      invalid.cleanup();
    }

    const malformed = fixtureGenerated();
    malformed.edges[0].targetId = "component.missing";
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => errors.push(args);
    let harness: RendererHarness | undefined;
    try {
      harness = await rendererHarness({ generated: malformed });
      expect(harness.document.querySelector<HTMLButtonElement>("#atlas-layer-toggle button:last-child")?.disabled).toBe(false);
      expect(harness.document.querySelector("#atlas-notice")?.textContent).toContain("malformed generated edge");
      expect(errors.flat().join(" ")).toContain("runtime.evaluate");
    } finally {
      console.error = originalError;
      harness?.cleanup();
    }
  });

  test("selects visible path text and announces instructions when clipboard access fails", async () => {
    const harness = await rendererHarness();
    try {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("clipboard denied"); } },
      });
      Object.defineProperty(harness.document, "execCommand", { configurable: true, value: () => false });
      buttonWithText(harness.document, "#atlas-nav button", "Discovery")?.click();
      harness.document.querySelectorAll<HTMLButtonElement>("#atlas-layer-toggle button")[1].click();
      harness.document.querySelector<HTMLButtonElement>(".atlas-node")?.click();
      const details = harness.document.querySelector<HTMLDetailsElement>(".atlas-disclosure");
      if (details) details.open = true;
      details?.querySelector<HTMLButtonElement>("button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.window.getSelection()?.toString()).toContain("packages/protocol/");
      expect(harness.document.querySelector("#atlas-status")?.textContent).toContain("Path selected");
    } finally {
      harness.cleanup();
    }
  });

  test("rejects traversal-shaped protocol source paths", async () => {
    const generated = fixtureGenerated();
    generated.nodes[0].sourcePath = "packages/protocol/../services/api/src/main.ts";
    const harness = await rendererHarness({ generated });
    try {
      buttonWithText(harness.document, "#atlas-nav button", "Discovery")?.click();
      harness.document.querySelectorAll<HTMLButtonElement>("#atlas-layer-toggle button")[1].click();
      harness.document.querySelector<HTMLButtonElement>(".atlas-node")?.click();
      expect([...harness.document.querySelectorAll(".atlas-metadata dt")].map((node) => node.textContent)).not.toContain("Source path");
      expect(harness.document.querySelector(".atlas-disclosure")).toBeNull();
    } finally {
      harness.cleanup();
    }
  });
});

describe("ProtocolAtlasCore search and filters", () => {
  test("ranks exact symbol matches before summary matches without locale-sensitive normalization", () => {
    const original = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = () => {
      throw new Error("search must not depend on the ambient locale");
    };
    try {
      expect(core().searchItems("OpportunityGraphFactory", fixtureContent(), fixtureGenerated())[0].id)
        .toBe("component.opportunity-graph-factory");
    } finally {
      String.prototype.toLocaleLowerCase = original;
    }
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
  });

  test("returns an explicit empty search result contract", () => {
    expect(core().searchItems("definitely absent", fixtureContent(), fixtureGenerated())).toEqual([]);
  });

  test("composes capability, kind, and edge-kind filters", () => {
    expect(core().filterGraph({ capabilities: ["opportunities"], kinds: ["agent"], edgeKinds: ["runtime"] }, fixtureGenerated()))
      .toEqual(expectedOpportunityAgentSubgraph());
  });
});
