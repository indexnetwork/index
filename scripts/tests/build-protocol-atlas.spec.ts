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
  expect(css).toContain("--edge-runtime-pattern: 10 5");
  expect(css).toContain("--edge-injected-pattern: 3 4");
  expect(css).toContain("--edge-conceptual-pattern: 1 5");
  expect(css).toMatch(/\.atlas-edge text\s*\{/);
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

  test("ignores type-only and barrel-only references for unresolved consumers", async () => {
    const content = await loadAtlasContent() as MutableConfigurationContent;
    const input = await loadProtocolGeneratorInput(repoRoot);
    input.sourceFiles["packages/protocol/src/opportunity/outcome/type-only.ts"] = [
      'import type { isOutcomeQuestionsActivated as ActivationType } from "./outcome.env.js";',
      "export type Consumer = typeof ActivationType;",
    ].join("\n");
    input.sourceFiles["packages/protocol/src/opportunity/outcome/barrel.ts"] = 'export { isOutcomeQuestionsActivated } from "./outcome.env.js";';
    const artifact = buildAtlasArtifact(input, content);
    expect(validateConfigurationExperiments(content, artifact, input, repoRoot)).toEqual([]);
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
