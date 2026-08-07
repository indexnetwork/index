import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAtlasArtifact, serializeAtlasArtifact, validateAtlasArtifact, type AtlasArtifact, type GeneratorInput } from "../build-protocol-atlas.ts";

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
