import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildAtlasArtifact, loadProtocolGeneratorInput, serializeAtlasArtifact, validateAtlasArtifact, validateConfigurationExperiments, validateCuratedReferences, type AtlasArtifact, type GeneratorInput } from "../build-protocol-atlas.ts";

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

const repoRoot = resolve(import.meta.dir, "../..");

type MutableConfigurationDelta = {
  id: string;
  effect: string;
  targetKind: string;
  targetId: string;
  settingKeys?: string[];
  noDirectProtocolConsumer?: boolean;
  consumerPath?: string;
  consumerSymbol?: string;
  referenceChain?: Array<{ path: string; symbol: string }>;
  behaviorTest?: { path: string; testName: string };
};

type MutableConfigurationContent = {
  chapters: Array<{ id: string }>;
  flows: Array<{ steps: Array<{ id: string }> }>;
  configurationExperiments: Array<{
    id: string;
    fallbackModeId: string;
    settings: Array<{
      key: string;
      readSites: Array<{ path: string; symbol: string }>;
      accessorClosure: Array<{ path: string; symbol: string }>;
      acceptedValues: string[];
      readTiming?: string;
    }>;
    modes: Array<{
      id: string;
      assignments: Array<{ key: string; value: string | null }>;
      resolvedValues: Array<{ key: string; value: string }>;
      prerequisites: Array<Record<string, unknown>>;
      deltas: MutableConfigurationDelta[];
      caveats: string[];
    }>;
  }>;
};

async function loadAtlasContent() {
  delete (globalThis as { ProtocolAtlasContent?: unknown }).ProtocolAtlasContent;
  await import(`../../docs/protocol-atlas/atlas-content.js?test=${crypto.randomUUID()}`);
  const content = structuredClone(
    (globalThis as { ProtocolAtlasContent: Record<string, unknown> }).ProtocolAtlasContent,
  );
  delete (globalThis as { ProtocolAtlasContent?: unknown }).ProtocolAtlasContent;
  return content;
}

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

test("contains no concrete host implementation references", async () => {
  const sources = await Promise.all([
    "docs/protocol-atlas/atlas-content.js",
    "docs/protocol-atlas/protocol.generated.js",
  ].map((path) => Bun.file(path).text()));
  expect(sources.join("\n")).not.toMatch(/services\/api|apps\/web|src\/controllers|src\/services|src\/adapters|src\/queues/);
});

test("keeps responsive layouts bounded with touch and grayscale-safe interaction cues", async () => {
  const css = await Bun.file("docs/protocol-atlas/atlas.css").text();
  expect(css).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  expect(css).toContain("@media (max-width: 900px)");
  expect(css).toContain("@media (max-width: 640px)");
  const layerToggleRule = css.match(/#atlas-layer-toggle button\s*\{([^}]*)\}/)?.[1];
  expect(layerToggleRule).toMatch(/min-height:\s*(?:2\.75rem|44px)/);
  const nodeGrid = css.match(/\.atlas-node-grid\s*\{([^}]*)\}/)?.[1];
  expect(nodeGrid).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);

  const nodeCard = css.match(/\.atlas-node-grid \.atlas-node\s*\{([^}]*)\}/)?.[1];
  expect(nodeCard).toMatch(/height:\s*100%/);
  expect(nodeCard).not.toMatch(/max-height|overflow-y/);

  const intermediate = css.slice(css.indexOf("@media (max-width: 900px)"), css.indexOf("@media (max-width: 640px)"));
  expect(intermediate).toMatch(/\.atlas-node-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  expect(intermediate).toMatch(/\.atlas-relationship\s*\{[^}]*grid-template-columns:\s*1fr/s);

  const mobile = css.slice(css.indexOf("@media (max-width: 640px)"), css.indexOf("@media (max-width: 375px)"));
  expect(mobile).toMatch(/\.atlas-node-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  expect(css).not.toContain(".atlas-diagram-canvas svg");
  expect(css).not.toContain("overflow-y: auto;\n  pointer-events: auto");
  expect(css).toContain(".configuration-delta--activated");
  expect(css).toContain(".configuration-delta--bypassed");
  expect(css).toContain(".configuration-delta--changed");
  expect(css).toContain(".configuration-delta--unresolved");
  expect(css).toContain("@media (max-width: 375px)");
  expect(css).toMatch(/\.configuration-mode-option[\s\S]*min-height:\s*(?:2\.75rem|44px)/);
});

test("loads dependency-free classic assets in deterministic order", async () => {
  const html = await Bun.file("docs/protocol-atlas/index.html").text();
  expect(html).toContain('<link rel="stylesheet" href="./atlas.css">');
  expect(html).toMatch(/atlas-content\.js[\s\S]*protocol\.generated\.js[\s\S]*atlas-core\.js[\s\S]*atlas\.js/);
  expect(html).not.toMatch(/https?:\/\/|type="module"|<script[^>]+src="\//);
});

describe("protocol atlas curated content", () => {
  test("accepts the approved seven chapters, five flows, and 20 configuration experiments", async () => {
    const content = await loadAtlasContent() as {
      chapters: Array<{ id: string }>;
      flows: Array<{ id: string }>;
      configurationExperiments: Array<{ id: string; modes: Array<{ id: string }> }>;
    };
    expect(content.chapters.map(({ id }) => id)).toEqual([
      "orientation", "primitives", "trust-scope", "discovery", "consent", "runtime", "explore",
    ]);
    expect(content.flows.map(({ id }) => id)).toEqual([
      "trusted-context", "express-signal", "discover-opportunity", "consent-connect", "external-agent-mcp",
    ]);
    expect(Object.fromEntries(content.configurationExperiments.map((experiment) => [
      experiment.id,
      experiment.modes.map((mode) => mode.id),
    ]))).toEqual(APPROVED_CONFIGURATION_MODE_IDS);
    expect(content.configurationExperiments.flatMap((experiment) => experiment.modes)).toHaveLength(61);
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    expect(validateCuratedReferences(content, artifact)).toEqual([]);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot)).toEqual([]);
  });

  test("locks chapter teaching sections and source discrepancy coverage", async () => {
    const content = await loadAtlasContent() as {
      chapters: Array<{ id: string; title: string; summary: string; sections?: Array<{ id: string; title: string; summary: string; items: string[] }> }>;
      flows: Array<{ id: string; steps: Array<{ id: string; summary: string; notes: { protocol: string; implementation: string } }> }>;
      concepts: Array<{ id: string; definition: string }>;
      invariants: Array<{ id: string; text: string }>;
      relationships: Array<{ id: string; kind: string; title?: string; summary: string }>;
      configurationExperiments: Array<{ id: string; modes: Array<{ id: string; deltas: MutableConfigurationDelta[] }> }>;
    };
    expect(content.chapters.map(({ title }) => title)).toEqual([
      "Orientation", "Primitives", "Trust + Scope", "Discovery", "Consent", "Runtime", "Explore",
    ]);
    const sectionsByChapter = Object.fromEntries(content.chapters.map((chapter) => [chapter.id, chapter.sections?.map(({ id }) => id) ?? []]));
    expect(sectionsByChapter.orientation).toEqual(["protocol-layers", "vocabulary-layers"]);
    expect(sectionsByChapter.primitives).toEqual(["protocol-primitives", "agent-role-distinction"]);
    expect(sectionsByChapter["trust-scope"]).toEqual(["effective-scope-intersection", "privacy-and-consent"]);
    expect(sectionsByChapter.runtime).toEqual(["runtime-drilldown", "host-boundary-stop"]);
    const chapterCopy = JSON.stringify(content.chapters);
    for (const text of [
      "Normative protocol vocabulary", "Current product vocabulary", "Historical/internal implementation vocabulary",
      "Participant", "Software Agent", "Provider/helper role", "applicable Community policy",
      "data minimization", "incognito", "entry surface", "runtime shell", "capability facade",
      "tool or graph factory", "domain state and schema", "injected port", "required host capability",
    ]) expect(chapterCopy.toLocaleLowerCase()).toContain(text.toLocaleLowerCase());
    const trustedContext = content.flows.find(({ id }) => id === "trusted-context")!;
    expect(JSON.stringify(trustedContext)).toContain("contact-data minimization");
    expect(content.concepts.find(({ id }) => id === "effective-scope")?.definition).toContain("applicable Community policy");
    expect(content.invariants.find(({ id }) => id === "scope-intersection")?.text).toContain("applicable Community policy");
    expect(content.relationships.filter(({ kind }) => kind === "discrepancy").map(({ id }) => id)).toEqual([
      "gap-bounded-negotiation", "gap-lifecycle-vocabulary", "gap-community-network", "gap-background-discovery", "gap-candidate-presentation",
    ]);
    const discovery = content.configurationExperiments.find(({ id }) => id === "discovery-corpus")!;
    expect(discovery.modes.find(({ id }) => id === "context-profile")?.deltas).toEqual([
      expect.objectContaining({ settingKeys: ["DISCOVERY_PROFILE_SOURCE"], behaviorTest: expect.objectContaining({ testName: expect.stringContaining("DISCOVERY_PROFILE_SOURCE=user_context") }) }),
    ]);
    expect(discovery.modes.find(({ id }) => id === "context-cross-match")?.deltas).toEqual([
      expect.objectContaining({
        settingKeys: ["DISCOVERY_CONTEXT_TO_INTENT"],
        behaviorTest: expect.objectContaining({
          testName: "DISCOVERY_CONTEXT_TO_INTENT=1 with user_context and intent,profile invokes context-to-intent search and evidence",
        }),
      }),
    ]);
  });

  test("preserves approved concept, invariant, flow-step, and vocabulary contracts", async () => {
    const content = await loadAtlasContent() as {
      concepts: Array<{ id: string }>;
      invariants: Array<{ id: string; text: string }>;
      flows: Array<{ id: string; steps: Array<{
        id: string;
        title: string;
        summary: string;
        conceptIds: string[];
        nodeIds: string[];
        invariantIds: string[];
        sourcePaths: string[];
        previous: string | null;
        next: string | null;
        notes: { protocol: string; implementation: string };
      }> }>;
      vocabulary: Array<{ id: string; protocolTerm: string; productTerm: string; implementationTerm: string }>;
      relationships: Array<{ id: string; kind: string; title?: string; summary: string }>;
    };
    expect(content.concepts.map(({ id }) => id)).toEqual([
      "participant", "software-agent", "signal", "premise", "context", "community", "membership",
      "agent-permission", "effective-scope", "candidate", "opportunity", "negotiation", "connection",
      "provider-helper-role", "radar",
    ]);
    expect(content.invariants.map(({ id }) => id)).toEqual([
      "scope-intersection", "participant-consent", "action-attribution", "candidate-private", "no-fabrication",
      "context-freshness", "opportunity-legibility", "terminality", "host-boundary", "negotiation-not-consent",
    ]);
    expect(content.invariants.find(({ id }) => id === "host-boundary")?.text).toBe(
      "The protocol declares required ports and callbacks; how a host fulfills them is outside this atlas.",
    );
    expect(Object.fromEntries(content.flows.map(({ id, steps }) => [id, steps.map((step) => step.id)]))).toEqual({
      "trusted-context": ["approved-material", "atomic-premises", "assign-and-embed", "synthesize-context", "refresh-representations"],
      "express-signal": ["participant-input", "infer-speech-act", "verify-or-clarify", "reconcile", "assign-communities", "persist-and-enqueue"],
      "discover-opportunity": ["load-trigger", "resolve-effective-scope", "retrieve-candidates", "evaluate-fit", "recheck-admission", "negotiate-optional", "surface"],
      "consent-connect": ["actionable-opportunity", "first-participant-sends", "counterparty-reviews", "accept-or-decline", "open-human-conversation"],
      "external-agent-mcp": ["caller-credential", "auth-resolver-requirement", "protocol-capability-policy", "authorized-tool-registry", "invocation-runtime", "scoped-capability"],
    });
    expect(content.vocabulary.map(({ protocolTerm, productTerm, implementationTerm }) => ({ protocolTerm, productTerm, implementationTerm }))).toEqual([
      { protocolTerm: "Signal", productTerm: "Signal", implementationTerm: "intent" },
      { protocolTerm: "Community", productTerm: "Network", implementationTerm: "network/index" },
      { protocolTerm: "Participant", productTerm: "Person", implementationTerm: "user" },
      { protocolTerm: "Draft/Sent/Connected/Declined/Expired", productTerm: "Draft/Sent/Connected/Declined/Expired", implementationTerm: "internal lifecycle states" },
      { protocolTerm: "Software Agent", productTerm: "Software Agent", implementationTerm: "agent registry actor" },
      { protocolTerm: "provider/helper role", productTerm: "provider/helper role", implementationTerm: "internal valency role \"agent\"" },
    ]);
    for (const flow of content.flows) {
      flow.steps.forEach((step, index) => {
        expect(step.title).not.toBeEmpty();
        expect(step.summary).not.toBeEmpty();
        expect(step.conceptIds.length).toBeGreaterThan(0);
        expect(step.nodeIds.length).toBeGreaterThan(0);
        expect(step.invariantIds.length).toBeGreaterThan(0);
        expect(step.sourcePaths.length).toBeGreaterThan(0);
        expect(step.sourcePaths.every((path) => path.startsWith("packages/protocol/"))).toBe(true);
        expect(step.previous).toBe(index === 0 ? null : flow.steps[index - 1].id);
        expect(step.next).toBe(index === flow.steps.length - 1 ? null : flow.steps[index + 1].id);
        expect(step.notes.protocol).not.toBeEmpty();
        expect(step.notes.implementation).not.toBeEmpty();
      });
    }
    expect(content.relationships.filter(({ kind }) => kind === "discrepancy")).toHaveLength(5);
    expect(content.relationships.filter(({ kind }) => kind === "reference-concept").map(({ title }) => title)).toEqual([
      "Radar", "Semantic entropy", "Felicity conditions", "Referential anchors", "HyDE", "Valency", "Gricean presentation",
    ]);
  });

  test("rejects missing or malformed required chapter teaching sections", async () => {
    const source = await loadAtlasContent() as {
      chapters: Array<{ id: string; sections?: Array<{ id: string; title: string; summary: string; items: string[] }> }>;
      flows: Array<{ id: string; steps: Array<{ summary: string; notes: { protocol: string } }> }>;
    };
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, source);

    const malformed = structuredClone(source);
    const primitives = malformed.chapters.find(({ id }) => id === "primitives")!;
    primitives.sections = [{ id: "protocol-primitives", title: "", summary: "", items: [] }];
    expect(validateCuratedReferences(malformed, artifact).join("\n")).toContain("required teaching section");

    const missingPrimitive = structuredClone(source);
    missingPrimitive.chapters.find(({ id }) => id === "primitives")!.sections!
      .find(({ id }) => id === "protocol-primitives")!.items = ["Participant"];
    expect(validateCuratedReferences(missingPrimitive, artifact).join("\n")).toContain("approved primitive titles");

    const missingRuntimeStage = structuredClone(source);
    missingRuntimeStage.chapters.find(({ id }) => id === "runtime")!.sections!
      .find(({ id }) => id === "runtime-drilldown")!.items = ["Protocol entry surface"];
    expect(validateCuratedReferences(missingRuntimeStage, artifact).join("\n")).toContain("runtime drill-down stages");

    const missingMinimization = structuredClone(source);
    const firstTrustedStep = missingMinimization.flows.find(({ id }) => id === "trusted-context")!.steps[0];
    firstTrustedStep.summary = "Only approved material may become context.";
    expect(validateCuratedReferences(missingMinimization, artifact).join("\n")).toContain("contact-data minimization");
  });

  test("forbids concrete host implementation paths in curated content", async () => {
    const content = await loadAtlasContent() as { flows: Array<{ steps: Array<{ sourcePaths?: string[] }> }> };
    content.flows[0].steps[0].sourcePaths = ["services/api/src/main.ts"];
    const artifact = buildAtlasArtifact(await loadProtocolGeneratorInput(repoRoot));
    expect(validateCuratedReferences(content, artifact)).toContain(
      "curated source paths must begin with packages/protocol/",
    );
  });
});

describe("protocol atlas generator", () => {
  test("sorts schema-2 records and emits a classic-script global deterministically", () => {
    const artifact = buildAtlasArtifact(fixtureInput());
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.configurationExperiments).toEqual([]);
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

  test("rejects invalid generated record shapes and enum values", async () => {
    const content = await loadAtlasContent();
    const artifact = buildAtlasArtifact(await loadProtocolGeneratorInput(repoRoot), content);
    const mutations: Array<[string, (copy: AtlasArtifact) => void, string]> = [
      ["node kind", (copy) => { (copy.nodes[0] as unknown as Record<string, unknown>).kind = "database"; }, "node kind"],
      ["node layer", (copy) => { (copy.nodes[0] as unknown as Record<string, unknown>).layer = "host"; }, "node layer"],
      ["node capability", (copy) => { (copy.nodes[0] as unknown as Record<string, unknown>).capability = 42; }, "node capability"],
      ["edge kind", (copy) => { (copy.edges[0] as unknown as Record<string, unknown>).kind = "telemetry"; }, "edge kind"],
      ["edge label", (copy) => { (copy.edges[0] as unknown as Record<string, unknown>).label = null; }, "edge label"],
      ["read timing", (copy) => { ((copy.configurationExperiments[0].settings as Array<Record<string, unknown>>)[0]).readTiming = "whenever"; }, "readTiming"],
      ["coverage", (copy) => { copy.configurationExperiments[0].coverage = "observed"; }, "coverage"],
      ["effect", (copy) => { const mode = (copy.configurationExperiments[0].modes as Array<Record<string, unknown>>).find(({ deltas }) => Array.isArray(deltas) && deltas.length > 0)!; (mode.deltas as Array<Record<string, unknown>>)[0].effect = "teleported"; }, "effect"],
      ["target kind", (copy) => { const mode = (copy.configurationExperiments[0].modes as Array<Record<string, unknown>>).find(({ deltas }) => Array.isArray(deltas) && deltas.length > 0)!; (mode.deltas as Array<Record<string, unknown>>)[0].targetKind = "route"; }, "targetKind"],
      ["assignment shape", (copy) => { (copy.configurationExperiments[0].modes[0].assignments as unknown[]) = [null]; }, "assignment"],
      ["null node entry", (copy) => { (copy.nodes as unknown[]).push(null); }, "generated nodes["],
      ["string node entry", (copy) => { (copy.nodes as unknown[]).push("not-a-record"); }, "generated nodes["],
      ["null edge entry", (copy) => { (copy.edges as unknown[]).push(null); }, "generated edges["],
      ["string edge entry", (copy) => { (copy.edges as unknown[]).push("not-a-record"); }, "generated edges["],
    ];
    for (const [label, mutate, expected] of mutations) {
      const copy = structuredClone(artifact);
      mutate(copy);
      expect(validateAtlasArtifact(copy, repoRoot).join("\n"), label).toContain(expected);
    }
  });

  test("derives static edges only from runtime module references", () => {
    const input = fixtureInput();
    const sourcePath = "packages/protocol/src/runtime/foreground/composition.ts";
    const runtimeTargetPath = "packages/protocol/src/runtime/foreground/runtime-target.ts";
    const typeTargetPath = "packages/protocol/src/runtime/foreground/type-target.ts";
    input.components.push(
      {
        id: "component.composition",
        label: "Composition",
        kind: "runtime-shell",
        capability: "interaction-composition",
        sourcePath,
        chapterIds: [],
        flowIds: [],
        summary: "Composes runtime behavior.",
      },
      {
        id: "component.runtime-target",
        label: "Runtime target",
        kind: "tool-family",
        capability: "interaction-composition",
        sourcePath: runtimeTargetPath,
        chapterIds: [],
        flowIds: [],
        summary: "A runtime dependency.",
      },
      {
        id: "component.type-target",
        label: "Type target",
        kind: "port",
        capability: "interaction-composition",
        sourcePath: typeTargetPath,
        chapterIds: [],
        flowIds: [],
        summary: "A type-only dependency.",
      },
    );
    input.sourceFiles = {
      ...input.sourceFiles,
      [sourcePath]: [
        'import { runtimeTarget } from "./runtime-target.js";',
        'import type { TypeTarget } from "./type-target.js";',
      ].join("\n"),
      [runtimeTargetPath]: "export const runtimeTarget = true;\n",
      [typeTargetPath]: "export type TypeTarget = string;\n",
    };

    const staticTargets = buildAtlasArtifact(input).edges
      .filter(({ sourceId, kind }) => sourceId === "component.composition" && kind === "static")
      .map(({ targetId }) => targetId);

    expect(staticTargets).toContain("component.runtime-target");
    expect(staticTargets).not.toContain("component.type-target");
  });

  test("targets only runtime-imported symbols when a module also exports a type-only port", () => {
    const input = fixtureInput();
    const sourcePath = "packages/protocol/src/runtime/foreground/composition.ts";
    const mixedTargetPath = "packages/protocol/src/shared/interfaces/mixed-target.ts";
    input.components.push(
      {
        id: "component.runtime-target",
        label: "Runtime target",
        kind: "public-symbol",
        capability: "interaction-composition",
        sourcePath: mixedTargetPath,
        symbol: "runtimeTarget",
        chapterIds: [],
        flowIds: [],
        summary: "A runtime dependency.",
      },
      {
        id: "host-requirement.type-target",
        label: "Type target",
        kind: "host-requirement",
        capability: "interaction-composition",
        sourcePath: mixedTargetPath,
        symbol: "TypeTarget",
        chapterIds: [],
        flowIds: [],
        summary: "A type-only dependency from the same module.",
      },
    );
    input.sourceFiles = {
      ...input.sourceFiles,
      [sourcePath]: 'import { runtimeTarget, type TypeTarget } from "../../shared/interfaces/mixed-target.js";\n',
      [mixedTargetPath]: [
        "export const runtimeTarget = true;",
        "export interface TypeTarget {}",
      ].join("\n"),
    };
    input.components.push({
      id: "component.composition",
      label: "Composition",
      kind: "runtime-shell",
      capability: "interaction-composition",
      sourcePath,
      chapterIds: [],
      flowIds: [],
      summary: "Composes runtime behavior.",
    });

    const staticTargets = buildAtlasArtifact(input).edges
      .filter(({ sourceId, kind }) => sourceId === "component.composition" && kind === "static")
      .map(({ targetId }) => targetId);

    expect(staticTargets).toContain("component.runtime-target");
    expect(staticTargets).not.toContain("host-requirement.type-target");
  });

  test("rejects missing node and edge evidence paths", () => {
    const artifact = fixtureArtifact();
    artifact.nodes[0].sourcePath = "packages/protocol/src/missing.ts";
    artifact.edges[0].evidencePath = "packages/protocol/src/also-missing.ts";

    expect(validateAtlasArtifact(artifact, fixtureRoot)).toEqual(expect.arrayContaining([
      expect.stringContaining("sourcePath does not exist"),
      expect.stringContaining("evidencePath does not exist"),
    ]));
  });

  test("rejects secret keys, incomplete read sites, malformed prerequisites, and missing targets", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const discovery = content.configurationExperiments.find(({ id }) => id === "discovery-corpus")!;
    discovery.settings[0].key = "DISCOVERY_API_KEY";
    discovery.settings[1].readSites = [];
    Object.assign(discovery, { timestamp: "2026-08-07T00:00:00Z" });
    discovery.modes[1].prerequisites = [{ kind: "setting", key: "DISCOVERY_ALLOWED_TYPES", mode: "intent-only" }];
    discovery.modes[1].deltas[0].targetId = "component.missing";
    discovery.modes[1].deltas.push({ ...structuredClone(discovery.modes[1].deltas[0]), consumerPath: undefined, targetId: "component.missing" });
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n");
    expect(issues).toContain("secret-shaped");
    expect(issues).toContain("readSites do not match");
    expect(issues).toContain("malformed setting prerequisite");
    expect(issues).toContain("references missing node");
    expect(issues).toContain("duplicate delta targets");
    expect(issues).toContain("must not contain timestamps");
  });

  test("keeps curated /application paths valid when the repository root is /app", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    const serializedExperiments = JSON.stringify(content.configurationExperiments);

    expect(serializedExperiments).toContain("/application/");

    const issues = validateConfigurationExperiments(content, artifact, input, "/app");
    const simulatedRootMissingPath = / (?:read site|accessor closure hop|consumerPath|reference-chain hop|behavior test) does not exist: packages\/protocol\//;
    const unexpectedIssues = issues.filter((issue) => !simulatedRootMissingPath.test(issue));

    expect(unexpectedIssues).toEqual([]);
  });

  test("schema-aware validation ignores machine-like paths in non-path prose", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    content.configurationExperiments[0].modes[0].caveats.push("Operator note: /app/runtime output is deployment-local prose.");
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);

    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot);

    expect(issues).toEqual([]);
  });

  test("schema-aware validation rejects absolute values in every configuration path field", async () => {
    const input = await loadProtocolGeneratorInput(repoRoot);
    const base = await loadAtlasContent() as MutableConfigurationContent;
    const closureExperiment = base.configurationExperiments.find((candidate) =>
      candidate.settings.some((setting) => setting.accessorClosure.length > 0))!;
    const closureSetting = closureExperiment.settings.find((setting) => setting.accessorClosure.length > 0)!;
    const definitiveExperiment = base.configurationExperiments.find((candidate) =>
      candidate.modes.some((mode) => mode.deltas.some((delta) =>
        delta.consumerPath && delta.referenceChain?.length && delta.behaviorTest)))!;
    const definitiveMode = definitiveExperiment.modes.find((candidate) => candidate.deltas.some((delta) =>
      delta.consumerPath && delta.referenceChain?.length && delta.behaviorTest))!;
    const definitiveDelta = definitiveMode.deltas.find((candidate) =>
      candidate.consumerPath && candidate.referenceChain?.length && candidate.behaviorTest)!;
    const deltaId = `${definitiveExperiment.id}.${definitiveMode.id}.${definitiveDelta.id}`;
    const selectedSetting = (content: MutableConfigurationContent) => content.configurationExperiments
      .find(({ id }) => id === closureExperiment.id)!.settings.find(({ key }) => key === closureSetting.key)!;
    const selectedDelta = (content: MutableConfigurationContent) => content.configurationExperiments
      .find(({ id }) => id === definitiveExperiment.id)!.modes.find(({ id }) => id === definitiveMode.id)!
      .deltas.find(({ id }) => id === definitiveDelta.id)!;

    const cases: Array<{
      name: string;
      mutate: (content: MutableConfigurationContent) => void;
      expected: string;
    }> = [
      {
        name: "setting.readSites[].path",
        mutate: (content) => { selectedSetting(content).readSites[0].path = "/app/read-site.ts"; },
        expected: `${closureExperiment.id}.${closureSetting.key} read site must begin with packages/protocol/`,
      },
      {
        name: "setting.accessorClosure[].path",
        mutate: (content) => { selectedSetting(content).accessorClosure[0].path = "/app/accessor.ts"; },
        expected: `${closureExperiment.id}.${closureSetting.key} accessor closure hop must begin with packages/protocol/`,
      },
      {
        name: "definitive delta.consumerPath",
        mutate: (content) => { selectedDelta(content).consumerPath = "/app/consumer.ts"; },
        expected: `${deltaId} consumerPath must begin with packages/protocol/`,
      },
      {
        name: "definitive delta.referenceChain[].path",
        mutate: (content) => { selectedDelta(content).referenceChain![0].path = "/app/reference.ts"; },
        expected: `${deltaId} reference-chain hop must begin with packages/protocol/`,
      },
      {
        name: "definitive delta.behaviorTest.path",
        mutate: (content) => { selectedDelta(content).behaviorTest!.path = "/app/behavior.spec.ts"; },
        expected: `${deltaId} behavior test must begin with packages/protocol/`,
      },
    ];

    for (const { name, mutate, expected } of cases) {
      const content = structuredClone(base);
      mutate(content);
      const artifact = buildAtlasArtifact(input, content);
      const issues = validateConfigurationExperiments(content, artifact, input, repoRoot);
      expect(issues, name).toContain(expected);
      expect(issues.filter((issue) => issue === expected), name).toHaveLength(1);
    }
  });

  test("schema-aware validation preserves one field-specific error for every non-string path", async () => {
    const input = await loadProtocolGeneratorInput(repoRoot);
    const base = await loadAtlasContent() as MutableConfigurationContent;
    const closureExperiment = base.configurationExperiments.find((candidate) =>
      candidate.settings.some((setting) => setting.accessorClosure.length > 0))!;
    const closureSetting = closureExperiment.settings.find((setting) => setting.accessorClosure.length > 0)!;
    const definitiveExperiment = base.configurationExperiments.find((candidate) =>
      candidate.modes.some((mode) => mode.deltas.some((delta) =>
        delta.consumerPath && delta.referenceChain?.length && delta.behaviorTest)))!;
    const definitiveMode = definitiveExperiment.modes.find((candidate) => candidate.deltas.some((delta) =>
      delta.consumerPath && delta.referenceChain?.length && delta.behaviorTest))!;
    const definitiveDelta = definitiveMode.deltas.find((candidate) =>
      candidate.consumerPath && candidate.referenceChain?.length && candidate.behaviorTest)!;
    const deltaId = `${definitiveExperiment.id}.${definitiveMode.id}.${definitiveDelta.id}`;
    const selectedSetting = (content: MutableConfigurationContent) => content.configurationExperiments
      .find(({ id }) => id === closureExperiment.id)!.settings.find(({ key }) => key === closureSetting.key)!;
    const selectedDelta = (content: MutableConfigurationContent) => content.configurationExperiments
      .find(({ id }) => id === definitiveExperiment.id)!.modes.find(({ id }) => id === definitiveMode.id)!
      .deltas.find(({ id }) => id === definitiveDelta.id)!;

    const cases: Array<{
      name: string;
      mutate: (content: MutableConfigurationContent) => void;
      expected: string;
    }> = [
      {
        name: "setting.readSites[].path",
        mutate: (content) => { (selectedSetting(content).readSites[0] as { path: unknown }).path = 42; },
        expected: `${closureExperiment.id}.${closureSetting.key} read site must name a path`,
      },
      {
        name: "setting.accessorClosure[].path",
        mutate: (content) => { (selectedSetting(content).accessorClosure[0] as { path: unknown }).path = 42; },
        expected: `${closureExperiment.id}.${closureSetting.key} accessor closure hop is missing`,
      },
      {
        name: "definitive delta.consumerPath",
        mutate: (content) => { (selectedDelta(content) as { consumerPath: unknown }).consumerPath = 42; },
        expected: `${deltaId} must name consumerPath`,
      },
      {
        name: "definitive delta.referenceChain[].path",
        mutate: (content) => { (selectedDelta(content).referenceChain![0] as { path: unknown }).path = 42; },
        expected: `${deltaId} reference-chain hop is missing`,
      },
      {
        name: "definitive delta.behaviorTest.path",
        mutate: (content) => { (selectedDelta(content).behaviorTest! as { path: unknown }).path = 42; },
        expected: `${deltaId} behavior test must name a path`,
      },
    ];

    for (const { name, mutate, expected } of cases) {
      const content = structuredClone(base);
      mutate(content);
      const artifact = buildAtlasArtifact(input, content);
      const issues = validateConfigurationExperiments(content, artifact, input, repoRoot);
      expect(issues.filter((issue) => issue === expected), name).toEqual([expected]);
    }
  });

  test("binds each environment read to its actual enclosing source symbol", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const discovery = content.configurationExperiments.find(({ id }) => id === "discovery-corpus")!;
    discovery.settings.find(({ key }) => key === "DISCOVERY_ALLOWED_TYPES")!.readSites[0].symbol = "discoveryProfileSource";
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("readSites do not match current production reads");
  });

  test("enforces definitive evidence and unresolved consumerlessness", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const definitive = content.configurationExperiments.find(({ id }) => id === "negotiation-screen")!.modes[1].deltas[0];
    definitive.consumerSymbol = "MissingConsumer";
    definitive.referenceChain![0].symbol = "MissingHop";
    definitive.behaviorTest!.testName = "missing test name";
    const unresolved = content.configurationExperiments.find(({ id }) => id === "questioner-discovery-contract")!.modes[1].deltas[0];
    unresolved.consumerPath = "packages/protocol/src/opportunity/application/opportunity.graph.ts";
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/questions/application/unresolved-consumer.ts"] = [
      'import { isDiscoveryQuestionsEnabled } from "./question.env.js";',
      "export const active = isDiscoveryQuestionsEnabled();",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n");
    expect(issues).toContain("consumer symbol is missing");
    expect(issues).toContain("reference-chain hop is missing");
    expect(issues).toContain("behavior test name is missing");
    expect(issues).toContain("unresolved delta must not include consumerPath");
    expect(issues).toContain("unresolved accessor has direct production consumer");
  });

  test("rejects empty, reordered, and disconnected definitive reference chains", async () => {
    const input = await loadProtocolGeneratorInput(repoRoot);
    const base = await loadAtlasContent() as MutableConfigurationContent;

    for (const mutate of [
      (delta: MutableConfigurationDelta) => { delta.referenceChain = []; },
      (delta: MutableConfigurationDelta) => { delta.referenceChain = [...(delta.referenceChain ?? [])].reverse(); },
      (delta: MutableConfigurationDelta) => {
        delta.referenceChain = [
          ...(delta.referenceChain ?? []).slice(0, 1),
          { path: "packages/protocol/src/negotiation/domain/negotiation.protocol.ts", symbol: "configuredProtocolVersion" },
          ...(delta.referenceChain ?? []).slice(1),
        ];
      },
    ]) {
      const content = structuredClone(base);
      const delta = content.configurationExperiments.find(({ id }) => id === "negotiation-screen")!.modes.find(({ id }) => id === "shadow")!.deltas[0];
      mutate(delta);
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toMatch(/reference chain.*(?:empty|ordered|link)/i);
    }
  });

  test("rejects a direct named import of an unresolved accessor even when unused", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] =
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";\nexport const unrelated = 1;\n';
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("rejects a renamed import of an unresolved accessor even when unused", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] =
      'import { isOutcomeQuestionsActivated as active } from "./outcome.env.js";\nexport const unrelated = 1;\n';
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("detects an imported alias call escaping an unresolved accessor closure", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import { isOutcomeQuestionsActivated as active } from "./outcome.env.js";',
      "export function consumeOutcomeQuestions() { return active(); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("detects named re-export calls escaping an unresolved accessor closure", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-barrel.ts"] =
      'export { isOutcomeQuestionsActivated as outcomeQuestionsActive } from "./outcome.env.js";\n';
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import { outcomeQuestionsActive } from "./unresolved-barrel.js";',
      "export function consumeOutcomeQuestions() { return outcomeQuestionsActive(); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("detects local value alias calls escaping an unresolved accessor closure", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "const active = isOutcomeQuestionsActivated;",
      "export function consumeOutcomeQuestions() { return active(); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("detects namespace-import aliases escaping an unresolved accessor closure", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      "const active = outcomeQuestions.isOutcomeQuestionsActivated;",
      "export function consumeOutcomeQuestions() { return active(); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  for (const [shape, statements] of [
    ["computed namespace element access", [
      'import * as outcomeQuestions from "./outcome.env.js";',
      'export function consumeOutcomeQuestions() { return outcomeQuestions["isOutcomeQuestionsActivated"](); }',
    ]],
    ["computed namespace destructuring", [
      'import * as outcomeQuestions from "./outcome.env.js";',
      'const { ["isOutcomeQuestionsActivated"]: active } = outcomeQuestions;',
      "export function consumeOutcomeQuestions() { return active(); }",
    ]],
  ] as const) {
    test(`detects ${shape} as an unresolved accessor value escape`, async () => {
      const content = await loadAtlasContent() as MutableConfigurationContent;
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = statements.join("\n");
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
    });
  }

  test("allows a declaration-only default-export barrel for an unresolved accessor", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-default-barrel.ts"] = [
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "export default isOutcomeQuestionsActivated;",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).not.toContain("unresolved accessor has direct production consumer");
  });

  test("detects a downstream default-import consumer escaping an unresolved accessor barrel", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-default-barrel.ts"] = [
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "export default isOutcomeQuestionsActivated;",
    ].join("\n");
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import outcomeQuestionsActive from "./unresolved-default-barrel.js";',
      "export const unrelated = 1;",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n");
    expect(issues).toContain("unresolved accessor has direct production consumer");
    expect(issues).toContain("unresolved-consumer.ts#<module>->default");
    expect(issues).not.toContain("unresolved-default-barrel.ts#<module>");
  });

  test("resolves an element-access default barrel before detecting its downstream consumer", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-default-barrel.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      'export default outcomeQuestions["isOutcomeQuestionsActivated"];',
    ].join("\n");
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import active from "./unresolved-default-barrel.js";',
      "export function consumeOutcomeQuestions() { return active(); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n");
    expect(issues).toContain("unresolved-consumer.ts#<module>->default");
    expect(issues).not.toContain("unresolved-default-barrel.ts#<module>");
  });

  test("detects a computed destructuring assignment escaping an unresolved accessor", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      "let active: () => boolean;",
      '({ ["isOutcomeQuestionsActivated"]: active } = outcomeQuestions);',
      "export function consumeOutcomeQuestions() { return active(); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("constant-folds statically known element-access keys", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      'const key = "isOutcomeQuestionsActivated" as const;',
      "export function consumeOutcomeQuestions() { return outcomeQuestions[key](); }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("fails closed for a dynamic key on a namespace containing an unresolved accessor", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      "export function consumeOutcomeQuestions(key: string) { return outcomeQuestions[key]; }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("fails closed on a namespace import even when visible code uses a different export", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/resolved-consumer.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      'const key = "OUTCOME_MAX_CANDIDATES" as const;',
      "export function readOutcomeLimit() { return outcomeQuestions[key]; }",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("allows a named import proven to resolve to a different export", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/resolved-consumer.ts"] =
      'import { OUTCOME_MAX_CANDIDATES } from "./outcome.env.js";\nexport const limit = OUTCOME_MAX_CANDIDATES;\n';
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot)).toEqual([]);
  });

  test("fails closed on reflective and dynamic destructuring access through a namespace import", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    for (const source of [
      [
        'import * as outcomeQuestions from "./outcome.env.js";',
        "export function consume(key: string) { return Reflect.get(outcomeQuestions, key); }",
      ].join("\n"),
      [
        'import * as outcomeQuestions from "./outcome.env.js";',
        "const key: string = Math.random() ? 'x' : 'y';",
        "const { [key]: active } = outcomeQuestions;",
        "export { active };",
      ].join("\n"),
    ]) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = source;
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
    }
  });

  for (const [shape, statements] of [
    ["namespace destructuring", [
      'import * as outcomeQuestions from "./outcome.env.js";',
      "const { isOutcomeQuestionsActivated: active } = outcomeQuestions;",
      "export function consumeOutcomeQuestions() { return active(); }",
    ]],
    ["object alias", [
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "const gates = { active: isOutcomeQuestionsActivated };",
      "export function consumeOutcomeQuestions() { return gates.active(); }",
    ]],
    ["Function.call", [
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "export function consumeOutcomeQuestions() { return isOutcomeQuestionsActivated.call(undefined); }",
    ]],
    ["callback passing", [
      'import { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "const invoke = (callback: () => boolean) => callback();",
      "export function consumeOutcomeQuestions() { return invoke(isOutcomeQuestionsActivated); }",
    ]],
  ] as const) {
    test(`detects ${shape} as an unresolved accessor value escape`, async () => {
      const content = await loadAtlasContent() as MutableConfigurationContent;
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = statements.join("\n");
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
    });
  }

  test("rejects shadowed same-name declarations as definitive chain evidence", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    const path = "packages/protocol/src/negotiation/application/negotiation.graph.ts";
    input.sourceFiles[path] = input.sourceFiles[path]
      .replaceAll("configuredScreenMode()", "this.configuredScreenMode()")
      .replace("export class NegotiationGraphFactory {", 'export class NegotiationGraphFactory {\n  private configuredScreenMode() { return "off" as const; }');
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("reference chain has no ordered link");
  });

  test("requires exact named test calls rather than arbitrary source substrings", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const delta = content.configurationExperiments.find(({ id }) => id === "negotiation-screen")!.modes.find(({ id }) => id === "shadow")!.deltas[0];
    delta.behaviorTest!.testName = "describe";
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("behavior test name is missing");
  });

  test("rejects missing locked modes and duplicate nested ids", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const screen = content.configurationExperiments.find(({ id }) => id === "negotiation-screen")!;
    screen.modes = screen.modes.filter(({ id }) => id !== "enforce");
    screen.settings.push(structuredClone(screen.settings[0]));
    screen.modes[0].assignments.push(structuredClone(screen.modes[0].assignments[0]));
    screen.modes[1].deltas.push(structuredClone(screen.modes[1].deltas[0]));
    screen.modes.push(structuredClone(screen.modes[0]));
    content.configurationExperiments.push(structuredClone(screen));
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n");
    expect(issues).toContain("missing approved mode");
    expect(issues).toContain("duplicate configuration experiment id");
    expect(issues).toContain("duplicate configuration setting key");
    expect(issues).toContain("duplicate assignments");
    expect(issues).toContain("duplicate configuration mode id");
    expect(issues).toContain("duplicate deltas");
  });

  test("rejects unknown edge and step targets plus mismatched prerequisites", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const consultation = content.configurationExperiments.find(({ id }) => id === "negotiation-consultation")!;
    const mode = consultation.modes.find(({ id }) => id === "v2-on")!;
    mode.prerequisites = [{ kind: "setting", key: "NEGOTIATION_PROTOCOL_VERSION", value: "v1" }];
    mode.deltas[0].targetKind = "edge";
    mode.deltas[0].targetId = "edge.missing";
    const second = structuredClone(mode.deltas[0]);
    second.id = `${second.id}.step`;
    second.targetKind = "step";
    second.targetId = "step-missing";
    mode.deltas.push(second);
    const input = await loadProtocolGeneratorInput(repoRoot);
    const artifact = buildAtlasArtifact(input, content);
    const issues = validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n");
    expect(issues).toContain("missing edge edge.missing");
    expect(issues).toContain("missing step step-missing");
    expect(issues).toContain("setting prerequisite does not match its mode assignment");
  });

  test("ignores type-only and declaration-only barrel references for unresolved consumers", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/type-only.ts"] = [
      'import type { isOutcomeQuestionsActivated as ActivationType } from "./outcome.env.js";',
      "export type Consumer = typeof ActivationType;",
    ].join("\n");
    input.sourceFiles["packages/protocol/src/opportunity/outcome/named-barrel.ts"] = 'export { isOutcomeQuestionsActivated } from "./outcome.env.js";';
    input.sourceFiles["packages/protocol/src/opportunity/outcome/namespace-barrel.ts"] = 'export * as outcomeQuestions from "./outcome.env.js";';
    input.sourceFiles["packages/protocol/src/opportunity/outcome/local-namespace-barrel.ts"] = [
      'import * as outcomeQuestions from "./outcome.env.js";',
      "export { outcomeQuestions };",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot)).toEqual([]);
  });

  test("rejects the first downstream runtime import through single and multi-hop barrels", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    for (const sourceFiles of [
      {
        "packages/protocol/src/opportunity/outcome/barrel.ts": 'export { isOutcomeQuestionsActivated } from "./outcome.env.js";',
        "packages/protocol/src/opportunity/outcome/unresolved-consumer.ts": 'import { isOutcomeQuestionsActivated } from "./barrel.js";\nexport const unrelated = 1;',
      },
      {
        "packages/protocol/src/opportunity/outcome/namespace-barrel.ts": 'export * as outcomeQuestions from "./outcome.env.js";',
        "packages/protocol/src/opportunity/outcome/unresolved-consumer.ts": 'import * as barrel from "./namespace-barrel.js";\nexport const unrelated = 1;',
      },
      {
        "packages/protocol/src/opportunity/outcome/local-namespace-barrel.ts": [
          'import * as outcomeQuestions from "./outcome.env.js";',
          "export { outcomeQuestions };",
        ].join("\n"),
        "packages/protocol/src/opportunity/outcome/unresolved-consumer.ts": 'import { outcomeQuestions } from "./local-namespace-barrel.js";\nexport const unrelated = 1;',
      },
      {
        "packages/protocol/src/opportunity/outcome/barrel-a.ts": 'export * from "./outcome.env.js";',
        "packages/protocol/src/opportunity/outcome/barrel-b.ts": 'export * from "./barrel-a.js";',
        "packages/protocol/src/opportunity/outcome/unresolved-consumer.ts": 'import * as outcomeQuestions from "./barrel-b.js";\nexport const unrelated = 1;',
      },
    ]) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      Object.assign(input.sourceFiles, sourceFiles);
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
    }
  }, 15_000);

  test("rejects namespace imports through locally re-exported namespace barrels", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    for (const sourceFiles of [
      {
        "packages/protocol/src/opportunity/outcome/local-barrel.ts": [
          'import * as outcomeQuestions from "./outcome.env.js";',
          "export { outcomeQuestions as nested };",
        ].join("\n"),
        "packages/protocol/src/opportunity/outcome/unresolved-consumer.ts": 'import * as barrel from "./local-barrel.js";\nexport const unrelated = 1;',
      },
      {
        "packages/protocol/src/opportunity/outcome/local-barrel-a.ts": [
          'import * as outcomeQuestions from "./outcome.env.js";',
          "export { outcomeQuestions as nested };",
        ].join("\n"),
        "packages/protocol/src/opportunity/outcome/local-barrel-b.ts": 'export { nested as deeper } from "./local-barrel-a.js";',
        "packages/protocol/src/opportunity/outcome/unresolved-consumer.ts": 'import * as barrel from "./local-barrel-b.js";\nexport const unrelated = 1;',
      },
    ]) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      Object.assign(input.sourceFiles, sourceFiles);
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
    }
  });

  test("does not let a separate direct re-export exempt an unused local import binding", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/mixed-import-barrel.ts"] = [
      'import { isOutcomeQuestionsActivated as unusedActivation } from "./outcome.env.js";',
      'export { isOutcomeQuestionsActivated } from "./outcome.env.js";',
      "export const unrelated = 1;",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("honors explicit exports before export-star provenance", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/masked-barrel.ts"] = [
      'export { OUTCOME_MAX_CANDIDATES as isOutcomeQuestionsActivated } from "./outcome.env.js";',
      'export * from "./outcome.env.js";',
    ].join("\n");
    input.sourceFiles["packages/protocol/src/opportunity/outcome/resolved-consumer.ts"] = [
      'import { isOutcomeQuestionsActivated } from "./masked-barrel.js";',
      "export const limit = isOutcomeQuestionsActivated;",
    ].join("\n");
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot)).toEqual([]);
  });

  test("honors every explicit runtime export form before export-star provenance", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const forms = [
      {
        name: "exported namespace",
        source: [
          "export namespace isOutcomeQuestionsActivated { export const safe = true; }",
          'export * from "./outcome.env.js";',
        ].join("\n"),
      },
      {
        name: "object binding pattern",
        source: [
          "const safe = { value: 1 };",
          "export const { value: isOutcomeQuestionsActivated } = safe;",
          'export * from "./outcome.env.js";',
        ].join("\n"),
      },
      {
        name: "array binding pattern",
        source: [
          "const safe = [1] as const;",
          "export const [isOutcomeQuestionsActivated] = safe;",
          'export * from "./outcome.env.js";',
        ].join("\n"),
      },
      {
        name: "runtime import-equals alias",
        source: [
          'export import isOutcomeQuestionsActivated = require("./safe-value.js");',
          'export * from "./outcome.env.js";',
        ].join("\n"),
        extra: { "packages/protocol/src/opportunity/outcome/safe-value.ts": "export const safe = 1;" },
      },
    ];
    for (const form of forms) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/masked-barrel.ts"] = form.source;
      Object.assign(input.sourceFiles, form.extra ?? {});
      input.sourceFiles["packages/protocol/src/opportunity/outcome/resolved-consumer.ts"] = [
        'import { isOutcomeQuestionsActivated } from "./masked-barrel.js";',
        "export const safe = isOutcomeQuestionsActivated;",
      ].join("\n");
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot), form.name).toEqual([]);
    }
  }, 20_000);

  test("does not let type-only explicit declarations mask runtime export-star provenance", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    for (const declaration of [
      "export interface isOutcomeQuestionsActivated { readonly typeOnly: true }",
      "export type isOutcomeQuestionsActivated = { readonly typeOnly: true };",
    ]) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/masked-barrel.ts"] = [
        declaration,
        'export * from "./outcome.env.js";',
      ].join("\n");
      input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
        'import { isOutcomeQuestionsActivated } from "./masked-barrel.js";',
        "export const escaped = isOutcomeQuestionsActivated;",
      ].join("\n");
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n"))
        .toContain("unresolved accessor has direct production consumer");
    }
  }, 15_000);

  test("does not let ambient value aliases mask runtime export-star provenance", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const cases = [
      {
        name: "local ambient alias",
        maskedSource: [
          "declare const ambientActivation: boolean;",
          "export { ambientActivation as isOutcomeQuestionsActivated };",
          'export * from "./outcome.env.js";',
        ].join("\n"),
        extra: {},
        shouldMask: false,
      },
      {
        name: "ambient named re-export",
        maskedSource: [
          'export { ambientActivation as isOutcomeQuestionsActivated } from "./ambient-value.js";',
          'export * from "./outcome.env.js";',
        ].join("\n"),
        extra: {
          "packages/protocol/src/opportunity/outcome/ambient-value.ts":
            "export declare const ambientActivation: boolean;",
        },
        shouldMask: false,
      },
      {
        name: "declaration-file named re-export",
        maskedSource: [
          'export { ambientActivation as isOutcomeQuestionsActivated } from "./ambient-value.d.ts";',
          'export * from "./outcome.env.js";',
        ].join("\n"),
        extra: {
          "packages/protocol/src/opportunity/outcome/ambient-value.d.ts":
            "export const ambientActivation: boolean;",
        },
        shouldMask: false,
      },
      {
        name: "runtime local alias control",
        maskedSource: [
          "const runtimeActivation = false;",
          "export { runtimeActivation as isOutcomeQuestionsActivated };",
          'export * from "./outcome.env.js";',
        ].join("\n"),
        extra: {},
        shouldMask: true,
      },
      {
        name: "runtime named re-export control",
        maskedSource: [
          'export { runtimeActivation as isOutcomeQuestionsActivated } from "./runtime-value.js";',
          'export * from "./outcome.env.js";',
        ].join("\n"),
        extra: {
          "packages/protocol/src/opportunity/outcome/runtime-value.ts":
            "export const runtimeActivation = false;",
        },
        shouldMask: true,
      },
    ];

    for (const fixture of cases) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/masked-barrel.ts"] = fixture.maskedSource;
      Object.assign(input.sourceFiles, fixture.extra);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = [
        'import { isOutcomeQuestionsActivated } from "./masked-barrel.js";',
        "export const escaped = isOutcomeQuestionsActivated;",
      ].join("\n");
      const artifact = buildAtlasArtifact(input, content);
      const errors = validateConfigurationExperiments(content, artifact, input, repoRoot);
      if (fixture.shouldMask) {
        expect(errors, fixture.name).toEqual([]);
      } else {
        expect(errors.join("\n"), fixture.name).toContain("unresolved accessor has direct production consumer");
      }
    }
  }, 20_000);

  test("rejects statically analyzable dynamic and import-equals namespace imports", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    for (const source of [
      'export async function load() { return import("./outcome.env.js"); }',
      'import outcomeQuestions = require("./outcome.env.js");\nexport const unrelated = 1;',
    ]) {
      const input = await loadProtocolGeneratorInput(repoRoot);
      input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = source;
      const artifact = buildAtlasArtifact(input, content);
      expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
    }
  });

  test("rejects dynamic namespace imports through a declaration-only barrel", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/barrel.ts"] = 'export * from "./outcome.env.js";';
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] =
      'export async function load() { return import("./barrel.js"); }';
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("fails malformed cyclic barrel provenance without recursing indefinitely", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/barrel-a.ts"] = [
      'export * from "./barrel-b.js";',
      'export * from "./outcome.env.js";',
    ].join("\n");
    input.sourceFiles["packages/protocol/src/opportunity/outcome/barrel-b.ts"] = 'export * from "./barrel-a.js";';
    input.sourceFiles["packages/protocol/src/opportunity/outcome/unresolved-consumer.ts"] = 'import * as outcomeQuestions from "./barrel-a.js";\nexport const unrelated = 1;';
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved export provenance cycle");
  });

  test("rejects a same-module reference outside the unresolved accessor closure", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    const path = "packages/protocol/src/opportunity/outcome/outcome.env.ts";
    input.sourceFiles[path] += "\nexport const escapedOutcomeActivation = isOutcomeQuestionsActivated;\n";
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot).join("\n")).toContain("unresolved accessor has direct production consumer");
  });

  test("normalizes real nested experiments deterministically without adding unresolved chains", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const reordered = structuredClone(content);
    reordered.configurationExperiments.reverse();
    for (const experiment of reordered.configurationExperiments) {
      experiment.settings.reverse();
      experiment.modes.reverse();
      for (const mode of experiment.modes) {
        mode.assignments.reverse();
        mode.resolvedValues.reverse();
        mode.prerequisites.reverse();
        mode.deltas.reverse();
        mode.caveats.reverse();
      }
    }
    const input = await loadProtocolGeneratorInput(repoRoot);
    const first = serializeAtlasArtifact(buildAtlasArtifact(input, content));
    const second = serializeAtlasArtifact(buildAtlasArtifact(input, reordered));
    expect(second).toBe(first);
    const generated = buildAtlasArtifact(input, content);
    const unresolved = generated.configurationExperiments.flatMap((experiment) => experiment.modes)
      .flatMap((mode) => mode.deltas as Array<Record<string, unknown>>)
      .filter((delta) => delta.effect === "unresolved");
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((delta) => !("referenceChain" in delta))).toBe(true);
  });

  test("emits byte-identical stdout under different covered environment sentinels", () => {
    const run = (sentinel: string) => Bun.spawnSync({
      cmd: ["bun", "scripts/build-protocol-atlas.ts", "--stdout"],
      cwd: repoRoot,
      env: { ...process.env, NEGOTIATION_SCREEN_MODE: sentinel },
      stdout: "pipe",
      stderr: "pipe",
    });
    const first = run("atlas-sentinel-a");
    const second = run("atlas-sentinel-b");
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.stdout).toEqual(second.stdout);
    const output = first.stdout.toString();
    expect(output).not.toContain("atlas-sentinel-a");
    expect(output).not.toContain("atlas-sentinel-b");
  }, 15_000);
});
