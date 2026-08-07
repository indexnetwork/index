import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildAtlasArtifact, loadProtocolGeneratorInput, serializeAtlasArtifact, validateAtlasArtifact, validateCuratedReferences, type AtlasArtifact, type GeneratorInput } from "../build-protocol-atlas.ts";

const repoRoot = resolve(import.meta.dir, "../..");

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

test("loads dependency-free classic assets in deterministic order", async () => {
  const html = await Bun.file("docs/protocol-atlas/index.html").text();
  expect(html).toContain('<link rel="stylesheet" href="./atlas.css">');
  expect(html).toMatch(/atlas-content\.js[\s\S]*protocol\.generated\.js[\s\S]*atlas-core\.js[\s\S]*atlas\.js/);
  expect(html).not.toMatch(/https?:\/\/|type="module"|<script[^>]+src="\//);
});

describe("protocol atlas curated content", () => {
  test("accepts the approved seven chapters and five flows", async () => {
    const content = await loadAtlasContent() as {
      chapters: Array<{ id: string }>;
      flows: Array<{ id: string }>;
    };
    expect(content.chapters.map(({ id }) => id)).toEqual([
      "orientation", "primitives", "trust-scope", "discovery", "consent", "runtime", "explore",
    ]);
    expect(content.flows.map(({ id }) => id)).toEqual([
      "trusted-context", "express-signal", "discover-opportunity", "consent-connect", "external-agent-mcp",
    ]);
    const artifact = buildAtlasArtifact(await loadProtocolGeneratorInput(repoRoot));
    expect(validateCuratedReferences(content, artifact)).toEqual([]);
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
});
