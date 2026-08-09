#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { facadeCapabilityForSourcePath, type Capability } from "../packages/protocol/scripts/architecture/capability-model.ts";
import { parseSourceFile, runtimeModuleSpecifiers } from "../packages/protocol/scripts/architecture/module-graph.ts";

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
export type ConfigurationEffect = "activated" | "bypassed" | "changed" | "unresolved";
export type GeneratedConfigurationExperiment = Record<string, unknown> & { id: string; modes: Array<Record<string, unknown> & { id: string }> };
export type AtlasArtifactV1 = { schemaVersion: 1; nodes: AtlasNode[]; edges: AtlasEdge[] };
export type AtlasArtifact = { schemaVersion: 2; nodes: AtlasNode[]; edges: AtlasEdge[]; configurationExperiments: GeneratedConfigurationExperiment[] };

const APPROVED_CONFIGURATION_MODE_IDS: Readonly<Record<string, readonly string[]>> = {
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
};

export type GeneratorInput = {
  exportInventory: {
    exports: Array<{
      name: string;
      kind: "type" | "value";
      stability: "stable" | "experimental";
      source: string;
    }>;
  };
  components: Array<Omit<AtlasNode, "layer" | "stability"> & { rootExport?: string }>;
  edges: AtlasEdge[];
  sourceFiles: Record<string, string>;
  behaviorTestFiles?: Record<string, string>;
};

type RootExport = GeneratorInput["exportInventory"]["exports"][number];
type ComponentInput = GeneratorInput["components"][number];

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

type SelectedRootExport = (typeof ROOT_EXPORT_COMPONENTS)[number];

const GRAPH_FACTORY_SYMBOLS = new Set<SelectedRootExport>(ROOT_EXPORT_COMPONENTS.slice(0, 12));
const AGENT_SYMBOLS = new Set<SelectedRootExport>(ROOT_EXPORT_COMPONENTS.slice(12, 20));
const TOOL_FAMILY_SYMBOLS = new Set<SelectedRootExport>(ROOT_EXPORT_COMPONENTS.slice(20, 29));
const HOST_REQUIREMENT_SYMBOLS = new Set<SelectedRootExport>(ROOT_EXPORT_COMPONENTS.slice(32));

/** Reviewed implementation drill-downs; no directory scan decides atlas membership. */
const IMPLEMENTATION_PATH_BY_SYMBOL: Readonly<Record<SelectedRootExport, string>> = {
  ChatGraphFactory: "packages/protocol/src/chat/chat.graph.ts",
  IntentGraphFactory: "packages/protocol/src/signals/application/intent.graph.ts",
  OpportunityGraphFactory: "packages/protocol/src/opportunity/application/opportunity.graph.ts",
  EnrichmentGraphFactory: "packages/protocol/src/enrichment/enrichment.graph.ts",
  PremiseGraphFactory: "packages/protocol/src/premise/premise.graph.ts",
  NegotiationGraphFactory: "packages/protocol/src/negotiation/application/negotiation.graph.ts",
  HydeGraphFactory: "packages/protocol/src/shared/hyde/hyde.graph.ts",
  NetworkGraphFactory: "packages/protocol/src/communities/application/network.graph.ts",
  NetworkMembershipGraphFactory: "packages/protocol/src/communities/application/membership.graph.ts",
  IntentNetworkGraphFactory: "packages/protocol/src/communities/application/indexer.graph.ts",
  RadarGraphFactory: "packages/protocol/src/opportunity/radar/radar.graph.ts",
  MaintenanceGraphFactory: "packages/protocol/src/maintenance/maintenance.graph.ts",
  SemanticVerifier: "packages/protocol/src/signals/application/intent.verifier.ts",
  IntentIndexer: "packages/protocol/src/signals/application/intent.indexer.ts",
  UserContextGenerator: "packages/protocol/src/context/context.generator.ts",
  LensInferrer: "packages/protocol/src/shared/hyde/lens.inferrer.ts",
  OpportunityEvaluator: "packages/protocol/src/opportunity/application/opportunity.evaluator.ts",
  OpportunityPresenter: "packages/protocol/src/opportunity/application/opportunity.presenter.ts",
  IndexNegotiator: "packages/protocol/src/negotiation/application/negotiation.agent.ts",
  QuestionerAgent: "packages/protocol/src/questions/application/question.agent.ts",
  createChatTools: "packages/protocol/src/chat/chat.tools.ts",
  createIntentTools: "packages/protocol/src/signals/application/intent.tools.ts",
  createEnrichmentTools: "packages/protocol/src/enrichment/enrichment.tools.ts",
  createPremiseTools: "packages/protocol/src/premise/premise.tools.ts",
  createNetworkTools: "packages/protocol/src/communities/application/network.tools.ts",
  createOpportunityTools: "packages/protocol/src/opportunity/application/opportunity.tools.ts",
  createNegotiationTools: "packages/protocol/src/negotiation/application/negotiation.tools.ts",
  createQuestionerTools: "packages/protocol/src/questions/application/question.tools.ts",
  createAgentTools: "packages/protocol/src/participant-agents/application/agent.tools.ts",
  createToolRegistry: "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
  invokeToolRuntime: "packages/protocol/src/shared/agent/tool.runtime.ts",
  createMcpServer: "packages/protocol/src/mcp/mcp.server.ts",
  McpAuthResolver: "packages/protocol/src/shared/interfaces/auth.interface.ts",
  Embedder: "packages/protocol/src/shared/interfaces/embedder.interface.ts",
  Cache: "packages/protocol/src/shared/interfaces/cache.interface.ts",
  HydeCache: "packages/protocol/src/shared/interfaces/cache.interface.ts",
  IntentGraphQueue: "packages/protocol/src/shared/interfaces/queue.interface.ts",
  AgentDispatcher: "packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts",
  NegotiationTimeoutQueue: "packages/protocol/src/shared/interfaces/negotiation-events.interface.ts",
  ChatGraphCompositeDatabase: "packages/protocol/src/shared/interfaces/database.interface.ts",
  UserDatabase: "packages/protocol/src/shared/interfaces/database.interface.ts",
  SystemDatabase: "packages/protocol/src/shared/interfaces/database.interface.ts",
  OpportunityGraphDatabase: "packages/protocol/src/shared/interfaces/database.interface.ts",
  NegotiationGraphDatabase: "packages/protocol/src/shared/interfaces/database.interface.ts",
};

const CAPABILITY_FACADES = [
  "signals", "participant-context", "communities", "opportunities", "negotiation",
  "questions", "participant-agents", "contacts", "integrations", "interaction-composition",
] as const;

const RUNTIME_SHELLS: ReadonlyArray<{
  id: string;
  label: string;
  capability: Capability;
  sourcePath: string;
  summary: string;
}> = [
  { id: "runtime-shell.root", label: "Protocol root", capability: "public-compatibility", sourcePath: "packages/protocol/src/index.ts", summary: "The supported protocol package entry point." },
  { id: "runtime-shell.foreground", label: "Foreground runtime", capability: "interaction-composition", sourcePath: "packages/protocol/src/runtime/foreground/index.ts", summary: "Composes request-driven protocol behavior." },
  { id: "runtime-shell.background", label: "Background runtime", capability: "ambient-background", sourcePath: "packages/protocol/src/runtime/background/index.ts", summary: "Exposes ambient background protocol behavior." },
  { id: "runtime-shell.public", label: "Public compatibility shell", capability: "public-compatibility", sourcePath: "packages/protocol/src/public/index.ts", summary: "Preserves the public compatibility surface." },
  { id: "runtime-shell.platform", label: "Neutral platform shell", capability: "neutral-platform", sourcePath: "packages/protocol/src/platform/index.ts", summary: "Exposes platform-neutral protocol contracts." },
  { id: "runtime-shell.mcp", label: "MCP server shell", capability: "participant-agents", sourcePath: "packages/protocol/src/mcp/mcp.server.ts", summary: "Adapts MCP requests to protocol-owned tools." },
];

const CAPABILITY_OVERRIDES: Partial<Record<SelectedRootExport, Capability>> = {
  HydeGraphFactory: "participant-context",
  LensInferrer: "participant-context",
  createToolRegistry: "interaction-composition",
  invokeToolRuntime: "interaction-composition",
  createMcpServer: "participant-agents",
  McpAuthResolver: "participant-agents",
  Embedder: "participant-context",
  Cache: "participant-context",
  HydeCache: "participant-context",
  IntentGraphQueue: "signals",
  AgentDispatcher: "participant-agents",
  NegotiationTimeoutQueue: "negotiation",
  ChatGraphCompositeDatabase: "participant-agents",
  UserDatabase: "participant-context",
  SystemDatabase: "interaction-composition",
  OpportunityGraphDatabase: "opportunities",
  NegotiationGraphDatabase: "negotiation",
};

const HOST_REQUIREMENT_DETAILS: Readonly<Record<string, { label: string; summary: string }>> = {
  McpAuthResolver: {
    label: "Resolve authenticated principal",
    summary: "A host must resolve protocol identity; host authentication implementation is outside this atlas.",
  },
  Embedder: { label: "Embed and search vectors", summary: "A host must provide embedding and vector-search capabilities." },
  Cache: { label: "Cache protocol data", summary: "A host must provide the general protocol cache contract." },
  HydeCache: { label: "Cache HyDE documents", summary: "A host must provide the cache subset used by HyDE generation." },
  IntentGraphQueue: { label: "Queue signal processing", summary: "A host must schedule deferred signal graph work." },
  AgentDispatcher: { label: "Dispatch participant agents", summary: "A host must resolve and dispatch participant-owned agents." },
  NegotiationTimeoutQueue: { label: "Schedule negotiation timeouts", summary: "A host must schedule negotiation timeout work." },
  ChatGraphCompositeDatabase: { label: "Persist chat graph state", summary: "A host must provide the persistence contract used by the chat graph." },
  UserDatabase: { label: "Persist participant context", summary: "A host must provide participant persistence operations." },
  SystemDatabase: { label: "Persist system state", summary: "A host must provide system-level persistence operations." },
  OpportunityGraphDatabase: { label: "Persist opportunities", summary: "A host must provide the protocol opportunity persistence contract." },
  NegotiationGraphDatabase: { label: "Persist negotiations", summary: "A host must provide the protocol negotiation persistence contract." },
};

function componentId(symbol: SelectedRootExport): string {
  const slug = kebabCase(symbol);
  return HOST_REQUIREMENT_SYMBOLS.has(symbol) ? `host-requirement.${slug}` : `component.${slug}`;
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/^create-/, "")
    .toLowerCase();
}

function humanize(value: string): string {
  const words = kebabCase(value).split(" ").join("-").split("-");
  return words.map((word) => word === "mcp" ? "MCP" : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function kindForRootExport(symbol: SelectedRootExport): AtlasNodeKind {
  if (GRAPH_FACTORY_SYMBOLS.has(symbol)) return "graph-factory";
  if (AGENT_SYMBOLS.has(symbol)) return "agent";
  if (TOOL_FAMILY_SYMBOLS.has(symbol)) return "tool-family";
  if (HOST_REQUIREMENT_SYMBOLS.has(symbol)) return "host-requirement";
  return "public-symbol";
}

function sourcePathForRootExport(exportEntry: RootExport): string {
  if (!exportEntry.source.startsWith("./") || !exportEntry.source.endsWith(".js")) {
    throw new Error(`Selected root export ${exportEntry.name} has unsupported source ${exportEntry.source}.`);
  }
  return `packages/protocol/src/${exportEntry.source.slice(2, -3)}.ts`;
}

function capabilityForRootExport(symbol: SelectedRootExport, exportEntry: RootExport): Capability {
  const sourcePath = sourcePathForRootExport(exportEntry).slice("packages/protocol/src/".length);
  const classified = facadeCapabilityForSourcePath(sourcePath);
  const capability = classified ?? CAPABILITY_OVERRIDES[symbol];
  if (!capability) throw new Error(`Selected root export ${symbol} has no reviewed capability.`);
  return capability;
}

function componentForRootExport(symbol: SelectedRootExport, exportEntry: RootExport): ComponentInput {
  const kind = kindForRootExport(symbol);
  const hostDetails = HOST_REQUIREMENT_DETAILS[symbol];
  const label = hostDetails?.label ?? humanize(symbol);
  const summary = hostDetails?.summary ?? (
    kind === "graph-factory" ? `${label} composes its protocol graph.`
      : kind === "agent" ? `${label} performs a structured protocol decision.`
      : kind === "tool-family" ? `${label} exposes a capability tool family.`
      : `${label} is a selected protocol runtime surface.`
  );
  return {
    id: componentId(symbol),
    label,
    kind,
    capability: capabilityForRootExport(symbol, exportEntry),
    sourcePath: IMPLEMENTATION_PATH_BY_SYMBOL[symbol],
    symbol,
    rootExport: symbol,
    chapterIds: [],
    flowIds: [],
    summary,
  };
}

function facadeComponents(): ComponentInput[] {
  return CAPABILITY_FACADES.map((name) => {
    const relativePath = `capabilities/${name}.facade.ts`;
    const capability = facadeCapabilityForSourcePath(relativePath);
    if (!capability) throw new Error(`Cannot classify selected capability facade ${relativePath}.`);
    return {
      id: `facade.${name}`,
      label: `${humanize(name)} facade`,
      kind: "facade",
      capability,
      sourcePath: `packages/protocol/src/${relativePath}`,
      chapterIds: [],
      flowIds: [],
      summary: `The reviewed public boundary for the ${name} capability.`,
    };
  });
}

function runtimeShellComponents(): ComponentInput[] {
  return RUNTIME_SHELLS.map((shell) => ({
    ...shell,
    kind: "runtime-shell",
    chapterIds: [],
    flowIds: [],
  }));
}

function reviewedEdge(
  kind: "runtime" | "injected",
  source: SelectedRootExport,
  target: SelectedRootExport,
  label: string,
  evidencePath: string,
): AtlasEdge {
  return {
    id: `${kind}.${kebabCase(source)}.${kebabCase(target)}`,
    sourceId: componentId(source),
    targetId: componentId(target),
    kind,
    label,
    evidencePath,
    evidenceSymbol: source,
  };
}

function reviewedEdges(): AtlasEdge[] {
  const registryPath = IMPLEMENTATION_PATH_BY_SYMBOL.createToolRegistry;
  const registryTargets: SelectedRootExport[] = [
    "createChatTools", "createIntentTools", "createEnrichmentTools", "createPremiseTools",
    "createNetworkTools", "createOpportunityTools", "createNegotiationTools",
    "createQuestionerTools", "createAgentTools",
  ];
  return [
    reviewedEdge("runtime", "createMcpServer", "createToolRegistry", "builds the tool registry", IMPLEMENTATION_PATH_BY_SYMBOL.createMcpServer),
    reviewedEdge("injected", "createMcpServer", "McpAuthResolver", "requires authenticated identity", IMPLEMENTATION_PATH_BY_SYMBOL.createMcpServer),
    ...registryTargets.map((target) => reviewedEdge("runtime", "createToolRegistry", target, "registers capability tools", registryPath)),
    reviewedEdge("runtime", "ChatGraphFactory", "createChatTools", "exposes chat tools", IMPLEMENTATION_PATH_BY_SYMBOL.ChatGraphFactory),
    reviewedEdge("runtime", "IntentGraphFactory", "SemanticVerifier", "runs semantic verification", IMPLEMENTATION_PATH_BY_SYMBOL.IntentGraphFactory),
    reviewedEdge("injected", "IntentGraphFactory", "IntentGraphQueue", "accepts deferred graph scheduling", IMPLEMENTATION_PATH_BY_SYMBOL.IntentGraphFactory),
    reviewedEdge("runtime", "OpportunityGraphFactory", "HydeGraphFactory", "uses generated participant context", IMPLEMENTATION_PATH_BY_SYMBOL.OpportunityGraphFactory),
    reviewedEdge("runtime", "OpportunityGraphFactory", "OpportunityEvaluator", "evaluates candidates", IMPLEMENTATION_PATH_BY_SYMBOL.OpportunityGraphFactory),
    reviewedEdge("runtime", "OpportunityGraphFactory", "NegotiationGraphFactory", "starts negotiation", IMPLEMENTATION_PATH_BY_SYMBOL.OpportunityGraphFactory),
    reviewedEdge("injected", "OpportunityGraphFactory", "OpportunityGraphDatabase", "requires opportunity persistence", IMPLEMENTATION_PATH_BY_SYMBOL.OpportunityGraphFactory),
    reviewedEdge("runtime", "NegotiationGraphFactory", "IndexNegotiator", "runs negotiation turns", IMPLEMENTATION_PATH_BY_SYMBOL.NegotiationGraphFactory),
    reviewedEdge("injected", "NegotiationGraphFactory", "AgentDispatcher", "requires participant dispatch", IMPLEMENTATION_PATH_BY_SYMBOL.NegotiationGraphFactory),
    reviewedEdge("injected", "NegotiationGraphFactory", "NegotiationTimeoutQueue", "requires timeout scheduling", IMPLEMENTATION_PATH_BY_SYMBOL.NegotiationGraphFactory),
  ];
}

function assertProtocolPath(path: string, context: string): void {
  if (!path.startsWith("packages/protocol/")) {
    throw new Error(`${context} must begin with packages/protocol/.`);
  }
  if (path.includes("\\") || path.split("/").includes("..")) {
    throw new Error(`${context} must be a normalized packages/protocol path.`);
  }
}

async function protocolTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await protocolTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files.sort();
}

function repositoryPath(repoRoot: string, absolutePath: string): string {
  return absolutePath.slice(resolve(repoRoot).length + 1).split(sep).join("/");
}

export async function loadProtocolGeneratorInput(repoRoot: string): Promise<GeneratorInput> {
  const inventoryPath = "packages/protocol/architecture/exports.snapshot.json";
  const exportInventory = JSON.parse(await readFile(resolve(repoRoot, inventoryPath), "utf8")) as GeneratorInput["exportInventory"];
  const exportsByName = new Map(exportInventory.exports.map((entry) => [entry.name, entry]));
  const selectedComponents = ROOT_EXPORT_COMPONENTS.map((symbol) => {
    const exportEntry = exportsByName.get(symbol);
    if (!exportEntry) throw new Error(`Selected root export ${symbol} is missing from ${inventoryPath}.`);
    const rootSourcePath = sourcePathForRootExport(exportEntry);
    assertProtocolPath(rootSourcePath, `root export ${symbol} source`);
    if (!existsSync(resolve(repoRoot, rootSourcePath))) {
      throw new Error(`Selected root export ${symbol} source does not exist: ${rootSourcePath}.`);
    }
    if (HOST_REQUIREMENT_SYMBOLS.has(symbol) && exportEntry.kind !== "type") {
      throw new Error(`Host requirement ${symbol} must be a type export.`);
    }
    if (!HOST_REQUIREMENT_SYMBOLS.has(symbol) && exportEntry.kind !== "value") {
      throw new Error(`Runtime component ${symbol} must be a value export.`);
    }
    return componentForRootExport(symbol, exportEntry);
  });
  const components = [...selectedComponents, ...facadeComponents(), ...runtimeShellComponents()];
  const allTypeScriptFiles = await protocolTypeScriptFiles(resolve(repoRoot, "packages/protocol/src"));
  const productionFiles = allTypeScriptFiles.filter((path) => !path.split(sep).includes("tests") && !/\.(?:spec|test)\.ts$/.test(path));
  const testFiles = allTypeScriptFiles.filter((path) => path.split(sep).includes("tests") || /\.(?:spec|test)\.ts$/.test(path));
  const sourceEntries = await Promise.all(productionFiles.map(async (absolutePath) => {
    const sourcePath = repositoryPath(repoRoot, absolutePath);
    assertProtocolPath(sourcePath, "production sourcePath");
    return [sourcePath, await readFile(absolutePath, "utf8")] as const;
  }));
  const behaviorTestEntries = await Promise.all(testFiles.map(async (absolutePath) => {
    const sourcePath = repositoryPath(repoRoot, absolutePath);
    assertProtocolPath(sourcePath, "behavior test path");
    return [sourcePath, await readFile(absolutePath, "utf8")] as const;
  }));

  return {
    exportInventory,
    components,
    edges: reviewedEdges(),
    sourceFiles: Object.fromEntries(sourceEntries),
    behaviorTestFiles: Object.fromEntries(behaviorTestEntries),
  };
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function importedSourcePath(sourcePath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), specifier));
  return resolved.endsWith(".js") ? `${resolved.slice(0, -3)}.ts` : resolved;
}

type RuntimeImportSelection = { all: boolean; symbols: Set<string> };

function runtimeImportSelections(sourceFile: ts.SourceFile): Map<string, RuntimeImportSelection> {
  const runtimeSpecifiers = new Set(runtimeModuleSpecifiers(sourceFile));
  const selections = new Map<string, RuntimeImportSelection>();
  for (const statement of sourceFile.statements) {
    if (
      (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !runtimeSpecifiers.has(statement.moduleSpecifier.text)
    ) continue;
    const specifier = statement.moduleSpecifier.text;
    const selection = selections.get(specifier) ?? { all: false, symbols: new Set<string>() };
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause) {
        selection.all = true;
      } else if (!clause.isTypeOnly) {
        if (clause.name) selection.symbols.add("default");
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) selection.all = true;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly) selection.symbols.add((element.propertyName ?? element.name).text);
          }
        }
      }
    } else if (!statement.isTypeOnly) {
      const clause = statement.exportClause;
      if (!clause || ts.isNamespaceExport(clause)) {
        selection.all = true;
      } else {
        for (const element of clause.elements) {
          if (!element.isTypeOnly) selection.symbols.add((element.propertyName ?? element.name).text);
        }
      }
    }
    selections.set(specifier, selection);
  }
  return selections;
}

function staticEdges(components: AtlasNode[], sourceFiles: Record<string, string>): AtlasEdge[] {
  const nodesByPath = new Map<string, AtlasNode[]>();
  for (const node of components) {
    const nodes = nodesByPath.get(node.sourcePath) ?? [];
    nodes.push(node);
    nodesByPath.set(node.sourcePath, nodes);
  }
  const edges = new Map<string, AtlasEdge>();
  for (const sourceNode of components) {
    const sourceText = sourceFiles[sourceNode.sourcePath];
    if (sourceText === undefined) continue;
    const sourceFile = parseSourceFile(sourceNode.sourcePath, sourceText);
    for (const [specifier, selection] of runtimeImportSelections(sourceFile)) {
      const targetPath = importedSourcePath(sourceNode.sourcePath, specifier);
      if (!targetPath) continue;
      for (const targetNode of nodesByPath.get(targetPath) ?? []) {
        if (targetNode.id === sourceNode.id) continue;
        if (targetNode.symbol && !selection.all && !selection.symbols.has(targetNode.symbol)) continue;
        const id = `static.${sourceNode.id}.${targetNode.id}`;
        edges.set(id, {
          id,
          sourceId: sourceNode.id,
          targetId: targetNode.id,
          kind: "static",
          label: "imports at runtime",
          evidencePath: sourceNode.sourcePath,
        });
      }
    }
  }
  return [...edges.values()];
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function compareFields(...fields: string[]) {
  return (left: Record<string, unknown>, right: Record<string, unknown>): number => {
    for (const field of fields) {
      const leftValue = String(left[field] ?? "");
      const rightValue = String(right[field] ?? "");
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
    }
    return 0;
  };
}

function normalizedConfigurationExperiments(content: unknown): GeneratedConfigurationExperiment[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return [];
  return recordArray((content as Record<string, unknown>).configurationExperiments).map((experiment) => {
    const normalized = structuredClone(experiment);
    normalized.settings = recordArray(normalized.settings).map((setting) => ({
      ...setting,
      readSites: recordArray(setting.readSites).sort(compareFields("path", "symbol")),
      accessorClosure: recordArray(setting.accessorClosure).sort(compareFields("path", "symbol")),
      acceptedValues: Array.isArray(setting.acceptedValues) ? [...setting.acceptedValues].sort() : [],
    })).sort(compareFields("key", "entryAccessorSymbol", "readTiming"));
    normalized.modes = recordArray(normalized.modes).map((mode) => ({
      ...mode,
      assignments: recordArray(mode.assignments).sort(compareFields("key", "value")),
      resolvedValues: recordArray(mode.resolvedValues).sort(compareFields("key", "value")),
      prerequisites: recordArray(mode.prerequisites).sort(compareFields("kind", "key", "value", "nodeId")),
      deltas: recordArray(mode.deltas).map((delta) => ({
        ...delta,
        ...(Array.isArray(delta.settingKeys) ? { settingKeys: [...delta.settingKeys].sort() } : {}),
        ...(Array.isArray(delta.referenceChain) ? { referenceChain: recordArray(delta.referenceChain) } : {}),
      })).sort(compareFields("id", "effect", "targetKind", "targetId")),
      caveats: Array.isArray(mode.caveats) ? [...mode.caveats].sort() : [],
    })).sort(compareFields("id"));
    normalized.affectedChapterIds = Array.isArray(normalized.affectedChapterIds) ? [...normalized.affectedChapterIds].sort() : [];
    normalized.affectedStepIds = Array.isArray(normalized.affectedStepIds) ? [...normalized.affectedStepIds].sort() : [];
    return normalized as GeneratedConfigurationExperiment;
  }).sort(compareIds);
}

export function buildAtlasArtifact(input: GeneratorInput, content?: unknown): AtlasArtifact {
  const exportsByName = new Map(input.exportInventory.exports.map((entry) => [entry.name, entry]));
  const nodes: AtlasNode[] = input.components.map(({ rootExport, ...component }) => {
    const exportEntry = rootExport ? exportsByName.get(rootExport) : undefined;
    if (rootExport && !exportEntry) throw new Error(`Selected root export ${rootExport} is missing from the export inventory.`);
    return {
      ...component,
      layer: "implementation",
      ...(exportEntry ? { stability: exportEntry.stability } : {}),
      chapterIds: [...component.chapterIds].sort(),
      flowIds: [...component.flowIds].sort(),
    };
  }).sort(compareIds);
  const edges = [...input.edges.map((edge) => ({ ...edge })), ...staticEdges(nodes, input.sourceFiles)].sort(compareIds);
  return {
    schemaVersion: 2,
    nodes,
    edges,
    configurationExperiments: normalizedConfigurationExperiments(content),
  };
}

function duplicateIds(records: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of records) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function pathIssue(path: string, repoRoot: string, description: string): string | undefined {
  if (!path.startsWith("packages/protocol/")) return `${description} must begin with packages/protocol/`;
  if (path.includes("\\") || path.split("/").includes("..")) return `${description} must be normalized under packages/protocol/`;
  const packageRoot = resolve(repoRoot, "packages/protocol");
  const absolutePath = resolve(repoRoot, path);
  if (absolutePath !== packageRoot && !absolutePath.startsWith(`${packageRoot}${sep}`)) {
    return `${description} must resolve under packages/protocol/`;
  }
  if (!existsSync(absolutePath)) return `${description} does not exist: ${path}`;
  return undefined;
}

export function validateAtlasArtifact(artifact: AtlasArtifact, repoRoot: string): string[] {
  const issues: string[] = [];
  if (artifact.schemaVersion !== 2) issues.push("generated schemaVersion must be 2");
  if (!Array.isArray(artifact.configurationExperiments)) issues.push("generated configurationExperiments must be an array");
  for (const id of duplicateIds(artifact.nodes)) issues.push(`duplicate node id: ${id}`);
  for (const id of duplicateIds(artifact.edges)) issues.push(`duplicate edge id: ${id}`);
  for (const id of duplicateIds(artifact.configurationExperiments)) issues.push(`duplicate configuration experiment id: ${id}`);
  const nodeIds = new Set(artifact.nodes.map(({ id }) => id));
  for (const node of artifact.nodes) {
    const issue = pathIssue(node.sourcePath, repoRoot, `node ${node.id} sourcePath`);
    if (issue) issues.push(issue);
  }
  for (const edge of artifact.edges) {
    if (!nodeIds.has(edge.sourceId)) issues.push(`edge ${edge.id} has missing source ${edge.sourceId}`);
    if (!nodeIds.has(edge.targetId)) issues.push(`edge ${edge.id} has missing target ${edge.targetId}`);
    const issue = pathIssue(edge.evidencePath, repoRoot, `edge ${edge.id} evidencePath`);
    if (issue) issues.push(issue);
    if (edge.kind !== "static" && !edge.evidenceSymbol) issues.push(`edge ${edge.id} must name an evidenceSymbol`);
  }
  return issues;
}

type CuratedRecord = Record<string, unknown>;

function curatedRecords(value: unknown): CuratedRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is CuratedRecord => !!entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

export async function loadProtocolAtlasContent(repoRoot: string): Promise<CuratedRecord> {
  const target = globalThis as typeof globalThis & { ProtocolAtlasContent?: unknown };
  delete target.ProtocolAtlasContent;
  try {
    const contentUrl = pathToFileURL(resolve(repoRoot, "docs/protocol-atlas/atlas-content.js"));
    contentUrl.searchParams.set("build", crypto.randomUUID());
    await import(contentUrl.href);
    const content = target.ProtocolAtlasContent;
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      throw new Error("Protocol atlas curated content did not install globalThis.ProtocolAtlasContent.");
    }
    return structuredClone(content) as CuratedRecord;
  } finally {
    delete target.ProtocolAtlasContent;
  }
}

export function validateCuratedReferences(content: unknown, artifact: AtlasArtifact): string[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) return ["curated content must be an object"];

  const issues = new Set<string>();
  const root = content as CuratedRecord;
  const chapters = curatedRecords(root.chapters);
  const flows = curatedRecords(root.flows);
  const concepts = curatedRecords(root.concepts);
  const invariants = curatedRecords(root.invariants);
  const relationships = curatedRecords(root.relationships);
  const steps = flows.flatMap((flow) => curatedRecords(flow.steps));
  const idsFor = (records: CuratedRecord[]) => new Set(records.map(({ id }) => id).filter((id): id is string => typeof id === "string"));
  const knownIds = {
    node: new Set(artifact.nodes.map(({ id }) => id)),
    edge: new Set(artifact.edges.map(({ id }) => id)),
    chapter: idsFor(chapters),
    flow: idsFor(flows),
    concept: idsFor(concepts),
    invariant: idsFor(invariants),
    step: idsFor(steps),
  };

  for (const [name, records] of Object.entries({ chapter: chapters, flow: flows, concept: concepts, invariant: invariants, relationship: relationships, step: steps })) {
    for (const id of duplicateIds(records.filter((record): record is CuratedRecord & { id: string } => typeof record.id === "string") as Array<{ id: string }>)) {
      issues.add(`duplicate curated ${name} id: ${id}`);
    }
  }

  const referenceKinds: Readonly<Record<string, keyof typeof knownIds>> = {
    nodeId: "node", nodeIds: "node",
    edgeId: "edge", edgeIds: "edge",
    chapterId: "chapter", chapterIds: "chapter",
    flowId: "flow", flowIds: "flow",
    conceptId: "concept", conceptIds: "concept",
    sourceConceptId: "concept", targetConceptId: "concept",
    invariantId: "invariant", invariantIds: "invariant",
    previous: "step", next: "step", stepId: "step", stepIds: "step",
  };

  const visit = (value: unknown, location: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "sourcePath" || key === "sourcePaths") {
        const paths = Array.isArray(entry) ? entry : [entry];
        for (const path of paths) {
          if (typeof path !== "string" || !path.startsWith("packages/protocol/")) {
            issues.add("curated source paths must begin with packages/protocol/");
          } else if (path.includes("\\") || path.split("/").includes("..")) {
            issues.add("curated source paths must be normalized under packages/protocol/");
          }
        }
        continue;
      }
      const kind = referenceKinds[key];
      if (kind) {
        const references = Array.isArray(entry) ? entry : [entry];
        for (const id of references) {
          if (id !== null && (typeof id !== "string" || !knownIds[kind].has(id))) {
            issues.add(`${location}.${key} references missing ${kind} ${String(id)}`);
          }
        }
        continue;
      }
      visit(entry, `${location}.${key}`);
    }
  };
  visit(content, "content");
  return [...issues];
}

function processEnvironmentKey(node: ts.Node): string | undefined {
  if (
    ts.isPropertyAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === "process"
    && node.expression.name.text === "env"
  ) return node.name.text;
  if (
    ts.isElementAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === "process"
    && node.expression.name.text === "env"
    && node.argumentExpression
    && ts.isStringLiteral(node.argumentExpression)
  ) return node.argumentExpression.text;
  return undefined;
}

function sourceDeclaresSymbol(path: string, symbol: string, sourceFiles: Record<string, string>): boolean {
  const source = sourceFiles[path];
  if (source === undefined) return false;
  const sourceFile = parseSourceFile(path, source);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const named = node as ts.Node & { name?: ts.Node };
    if (named.name && named.name.getText(sourceFile) === symbol) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function enclosingTopLevelSymbol(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  let current: ts.Node | undefined = node.parent;
  let symbol: string | undefined;
  while (current && current !== sourceFile) {
    if ((ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current) || ts.isEnumDeclaration(current)) && current.name) symbol = current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) symbol = current.name.text;
    current = current.parent;
  }
  return symbol;
}

function environmentReadSites(sourceFiles: Record<string, string>): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  for (const [path, source] of Object.entries(sourceFiles)) {
    const sourceFile = parseSourceFile(path, source);
    const visit = (node: ts.Node): void => {
      const key = processEnvironmentKey(node);
      if (key) {
        const symbol = enclosingTopLevelSymbol(node, sourceFile);
        const sites = reads.get(key) ?? new Set<string>();
        sites.add(`${path}#${symbol ?? "<module>"}`);
        reads.set(key, sites);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return reads;
}

function enclosingCallableName(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  let current = node.parent;
  while (current) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isFunctionExpression(current)) && current.name) {
      return current.name.getText(sourceFile);
    }
    if (ts.isArrowFunction(current) && ts.isVariableDeclaration(current.parent)) return current.parent.name.getText(sourceFile);
    current = current.parent;
  }
  return undefined;
}

type SymbolLocation = { path: string; symbol: string };
type ModuleEvidence = {
  sourceFile: ts.SourceFile;
  declarations: Map<string, ts.Node>;
  reexports: Map<string, { targetPath: string; importedSymbol: string }>;
};

type EvidenceContext = {
  modules: Map<string, ModuleEvidence>;
  checker: ts.TypeChecker;
};

function symbolKey(location: SymbolLocation): string {
  return `${location.path}#${location.symbol}`;
}

function topLevelDeclarations(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>();
  const addNamed = (node: ts.Node & { name?: ts.Node }): void => {
    if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) declarations.set(node.name.text, node);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)
      || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) addNamed(statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
      }
    }
  }
  return declarations;
}

function buildModuleEvidence(sourceFiles: Record<string, string>): EvidenceContext {
  const parsed = new Map(Object.entries(sourceFiles).map(([path, source]) => [path, parseSourceFile(path, source)]));
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    skipLibCheck: true,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => parsed.get(fileName),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (fileName) => parsed.has(fileName),
    readFile: (fileName) => sourceFiles[fileName],
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => "\n",
    resolveModuleNames: (moduleNames, containingFile) => moduleNames.map((specifier) => {
      const targetPath = importedSourcePath(containingFile, specifier);
      return targetPath && parsed.has(targetPath)
        ? { resolvedFileName: targetPath, extension: ts.Extension.Ts, isExternalLibraryImport: false }
        : undefined;
    }),
  };
  const program = ts.createProgram([...parsed.keys()], compilerOptions, host);
  const checker = program.getTypeChecker();
  const modules = new Map<string, ModuleEvidence>();
  for (const path of parsed.keys()) {
    const sourceFile = program.getSourceFile(path);
    if (!sourceFile) continue;
    const reexports = new Map<string, { targetPath: string; importedSymbol: string }>();
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const targetPath = importedSourcePath(path, statement.moduleSpecifier.text);
        if (!targetPath) continue;
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly) reexports.set(element.name.text, {
            targetPath,
            importedSymbol: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
    modules.set(path, { sourceFile, declarations: topLevelDeclarations(sourceFile), reexports });
  }
  return { modules, checker };
}

function resolveExportOrigin(
  location: SymbolLocation,
  evidence: EvidenceContext,
  seen = new Set<string>(),
): SymbolLocation | undefined {
  const key = symbolKey(location);
  if (seen.has(key)) return undefined;
  seen.add(key);
  const module = evidence.modules.get(location.path);
  if (!module) return undefined;
  if (module.declarations.has(location.symbol)) return location;
  const reexport = module.reexports.get(location.symbol);
  return reexport
    ? resolveExportOrigin({ path: reexport.targetPath, symbol: reexport.importedSymbol }, evidence, seen)
    : undefined;
}

function declarationName(node: ts.Node): ts.DeclarationName | undefined {
  const name = (node as ts.NamedDeclaration).name;
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name : undefined;
}

function canonicalSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while (current && (current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    const target = checker.getAliasedSymbol(current);
    if (!target || target === current) break;
    current = target;
  }
  return current;
}

function symbolLocation(symbol: ts.Symbol | undefined, evidence: EvidenceContext): SymbolLocation | undefined {
  const canonical = canonicalSymbol(symbol, evidence.checker);
  if (!canonical) return undefined;
  for (const declaration of canonical.declarations ?? []) {
    const path = declaration.getSourceFile().fileName;
    const module = evidence.modules.get(path);
    if (!module) continue;
    for (const [name, node] of module.declarations) {
      if (node === declaration) return { path, symbol: name };
    }
  }
  return undefined;
}

function symbolAtLocation(location: SymbolLocation, evidence: EvidenceContext): ts.Symbol | undefined {
  const origin = resolveExportOrigin(location, evidence);
  if (!origin) return undefined;
  const declaration = evidence.modules.get(origin.path)?.declarations.get(origin.symbol);
  const name = declaration && declarationName(declaration);
  return name ? canonicalSymbol(evidence.checker.getSymbolAtLocation(name), evidence.checker) : undefined;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return Boolean(parent && ts.isDeclaration(parent) && (parent as ts.NamedDeclaration).name === node);
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isStatement(current)) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

function expressionOrigin(
  expression: ts.Expression,
  evidence: EvidenceContext,
  seen = new Set<ts.Symbol>(),
): SymbolLocation | undefined {
  const symbolNode = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  const symbol = evidence.checker.getSymbolAtLocation(symbolNode);
  if (!symbol || seen.has(symbol)) return undefined;
  seen.add(symbol);
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const origin = expressionOrigin(declaration.initializer, evidence, seen);
        if (origin) return origin;
      }
    }
  }
  return symbolLocation(canonicalSymbol(symbol, evidence.checker), evidence);
}

function declarationReferences(node: ts.Node, from: SymbolLocation, evidence: EvidenceContext): boolean {
  const expected = symbolAtLocation(from, evidence);
  if (!expected) return false;
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(candidate) && !isDeclarationName(candidate) && !isTypePosition(candidate)) {
      const origin = expressionOrigin(candidate, evidence);
      const actual = origin && symbolAtLocation(origin, evidence);
      if (actual === expected) {
        found = true;
        return;
      }
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function referenceHopLinked(
  from: SymbolLocation,
  to: SymbolLocation,
  evidence: EvidenceContext,
): boolean {
  if (from.path === to.path && from.symbol === to.symbol) return true;
  const toModule = evidence.modules.get(to.path);
  if (!toModule) return false;
  const reexport = toModule.reexports.get(to.symbol);
  if (reexport) {
    const reexportOrigin = resolveExportOrigin({ path: reexport.targetPath, symbol: reexport.importedSymbol }, evidence);
    const fromOrigin = resolveExportOrigin(from, evidence);
    if (reexportOrigin && fromOrigin && symbolKey(reexportOrigin) === symbolKey(fromOrigin)) return true;
  }
  const toDeclaration = toModule.declarations.get(to.symbol);
  return Boolean(toDeclaration && declarationReferences(toDeclaration, from, evidence));
}

function callTargetOrigin(
  expression: ts.LeftHandSideExpression,
  evidence: EvidenceContext,
): SymbolLocation | undefined {
  return expressionOrigin(expression, evidence);
}

function nodeIsInsideDeclaration(node: ts.Node, declaration: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === declaration) return true;
    current = current.parent;
  }
  return false;
}

function runtimeCallReferences(
  closure: Set<string>,
  evidence: EvidenceContext,
): string[] {
  const references: string[] = [];
  for (const [path, module] of evidence.modules) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const target = callTargetOrigin(node.expression, evidence);
        if (target && closure.has(symbolKey(target))) {
          const insideClosure = [...closure].some((key) => {
            const separator = key.lastIndexOf("#");
            const closurePath = key.slice(0, separator);
            const closureSymbol = key.slice(separator + 1);
            if (closurePath !== path) return false;
            const declaration = evidence.modules.get(closurePath)?.declarations.get(closureSymbol);
            return Boolean(declaration && nodeIsInsideDeclaration(node, declaration));
          });
          if (!insideClosure) references.push(`${path}#${enclosingCallableName(node, module.sourceFile) ?? "<module>"}->${target.symbol}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  return [...new Set(references)].sort();
}

function behaviorTestNames(source: string, path: string): Set<string> {
  const sourceFile = parseSourceFile(path, source);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["test", "it"].includes(node.expression.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) names.add(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function ids(records: Array<Record<string, unknown>>): string[] {
  return records.map(({ id }) => id).filter((id): id is string => typeof id === "string");
}

function sameStrings(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function validateConfigurationExperiments(
  content: unknown,
  artifact: AtlasArtifact,
  input: GeneratorInput,
  repoRoot: string,
): string[] {
  const issues: string[] = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) return ["configuration content must be an object"];
  const experiments = recordArray((content as Record<string, unknown>).configurationExperiments);
  const serializedExperiments = JSON.stringify(experiments);
  if (/"(?:generatedAt|timestamp|lineNumber|sourceLine)"/.test(serializedExperiments)) issues.push("configuration experiments must not contain timestamps or line numbers");
  if (serializedExperiments.includes(resolve(repoRoot))) issues.push("configuration experiments must not contain absolute machine paths");
  for (const id of duplicateIds(experiments.filter((entry): entry is { id: string } => typeof entry.id === "string"))) {
    issues.push(`duplicate configuration experiment id: ${id}`);
  }
  if (!sameStrings(ids(experiments), Object.keys(APPROVED_CONFIGURATION_MODE_IDS))) {
    issues.push("configuration experiment ids must exactly match the approved inventory");
  }
  const generatedIds = artifact.configurationExperiments.map(({ id }) => id);
  if (!sameStrings(ids(experiments), generatedIds)) issues.push("generated configuration experiments must exactly match curated experiment ids");

  const nodeIds = new Set(artifact.nodes.map(({ id }) => id));
  const edgeIds = new Set(artifact.edges.map(({ id }) => id));
  const root = content as Record<string, unknown>;
  const stepIds = new Set(recordArray(root.flows).flatMap((flow) => ids(recordArray(flow.steps))));
  const chapterIds = new Set(ids(recordArray(root.chapters)));
  const envReads = environmentReadSites(input.sourceFiles);
  const evidence = buildModuleEvidence(input.sourceFiles);
  const secretKey = /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/i;

  for (const experiment of experiments) {
    const experimentId = typeof experiment.id === "string" ? experiment.id : "<missing>";
    if (typeof experiment.id !== "string" || !experiment.id) issues.push("configuration experiments must have a non-empty id");
    const settings = recordArray(experiment.settings);
    const modes = recordArray(experiment.modes);
    if (!["definitive", "unresolved"].includes(String(experiment.coverage))) issues.push(`${experimentId} has unapproved coverage classification ${String(experiment.coverage)}`);
    const approvedModes = APPROVED_CONFIGURATION_MODE_IDS[experimentId];
    if (approvedModes && !sameStrings(ids(modes), approvedModes)) issues.push(`${experimentId} is missing approved mode or contains an unapproved mode`);
    for (const id of duplicateIds(settings.filter((entry): entry is { id: string } => typeof entry.id === "string").map((entry) => ({ id: entry.id })))) {
      issues.push(`duplicate configuration setting id in ${experimentId}: ${id}`);
    }
    const settingKeys = ids(settings.map((setting) => ({ id: setting.key })));
    if (new Set(settingKeys).size !== settingKeys.length) issues.push(`duplicate configuration setting key in ${experimentId}`);
    for (const id of duplicateIds(modes.filter((entry): entry is { id: string } => typeof entry.id === "string"))) {
      issues.push(`duplicate configuration mode id in ${experimentId}: ${id}`);
    }
    if (!modes.some(({ id }) => id === experiment.fallbackModeId)) issues.push(`${experimentId} fallback mode is missing: ${String(experiment.fallbackModeId)}`);
    for (const chapterId of Array.isArray(experiment.affectedChapterIds) ? experiment.affectedChapterIds : []) {
      if (typeof chapterId !== "string" || !chapterIds.has(chapterId)) issues.push(`${experimentId} references missing chapter ${String(chapterId)}`);
    }
    for (const stepId of Array.isArray(experiment.affectedStepIds) ? experiment.affectedStepIds : []) {
      if (typeof stepId !== "string" || !stepIds.has(stepId)) issues.push(`${experimentId} references missing step ${String(stepId)}`);
    }

    const settingsByKey = new Map<string, Record<string, unknown>>();
    for (const setting of settings) {
      const key = setting.key;
      if (typeof key !== "string" || !key) {
        issues.push(`${experimentId} has a setting without a key`);
        continue;
      }
      settingsByKey.set(key, setting);
      if (secretKey.test(key)) issues.push(`${experimentId} uses secret-shaped configuration key ${key}`);
      const readSites = recordArray(setting.readSites);
      const declaredSites = new Set<string>();
      for (const readSite of readSites) {
        if (typeof readSite.path !== "string") {
          issues.push(`${experimentId}.${key} read site must name a path`);
          continue;
        }
        declaredSites.add(`${readSite.path}#${String(readSite.symbol)}`);
        const pathError = pathIssue(readSite.path, repoRoot, `${experimentId}.${key} read site`);
        if (pathError) issues.push(pathError);
        if (typeof readSite.symbol !== "string" || !sourceDeclaresSymbol(readSite.path, readSite.symbol, input.sourceFiles)) issues.push(`${experimentId}.${key} read site symbol is missing: ${String(readSite.symbol)}`);
      }
      const actualSites = envReads.get(key) ?? new Set<string>();
      if (!sameStrings(declaredSites, actualSites)) issues.push(`${experimentId}.${key} readSites do not match current production reads`);
      if (typeof setting.entryAccessorSymbol !== "string" || !readSites.some((site) => sourceDeclaresSymbol(String(site.path), String(setting.entryAccessorSymbol), input.sourceFiles))) {
        issues.push(`${experimentId}.${key} entry accessor is missing: ${String(setting.entryAccessorSymbol)}`);
      }
      const closureHops = recordArray(setting.accessorClosure);
      const closureKeys = closureHops.map((hop) => `${String(hop.path)}#${String(hop.symbol)}`);
      if (new Set(closureKeys).size !== closureKeys.length) issues.push(`${experimentId}.${key} has duplicate accessor closure hops`);
      const readSiteKeys = readSites.map((site) => `${String(site.path)}#${String(site.symbol)}`);
      if (new Set(readSiteKeys).size !== readSiteKeys.length) issues.push(`${experimentId}.${key} has duplicate read sites`);
      const entrySite = readSites.find((site) => site.symbol === setting.entryAccessorSymbol);
      const connected: SymbolLocation[] = entrySite && typeof entrySite.path === "string"
        ? [{ path: entrySite.path, symbol: String(setting.entryAccessorSymbol) }]
        : [];
      const remaining = closureHops.filter((hop): hop is Record<string, unknown> & { path: string; symbol: string } => {
        if (typeof hop.path !== "string" || typeof hop.symbol !== "string" || !sourceDeclaresSymbol(hop.path, hop.symbol, input.sourceFiles)) {
          issues.push(`${experimentId}.${key} accessor closure hop is missing`);
          return false;
        }
        return true;
      });
      while (remaining.length > 0) {
        const index = remaining.findIndex((hop) => connected.some((member) =>
          referenceHopLinked(member, hop, evidence) || referenceHopLinked(hop, member, evidence)));
        if (index < 0) break;
        const [hop] = remaining.splice(index, 1);
        connected.push(hop);
      }
      if (remaining.length > 0) issues.push(`${experimentId}.${key} accessor closure is disconnected`);
    }

    for (const mode of modes) {
      const modeId = `${experimentId}.${String(mode.id)}`;
      const assignments = recordArray(mode.assignments);
      const assignmentKeys = assignments.map(({ key }) => key).filter((key): key is string => typeof key === "string");
      if (!sameStrings(assignmentKeys, settingsByKey.keys())) issues.push(`${modeId} assignments must cover every experiment setting exactly once`);
      if (new Set(assignmentKeys).size !== assignmentKeys.length) issues.push(`${modeId} has duplicate assignments`);
      const resolvedKeys = recordArray(mode.resolvedValues).map(({ key }) => key).filter((key): key is string => typeof key === "string");
      if (!sameStrings(resolvedKeys, settingsByKey.keys())) issues.push(`${modeId} resolvedValues must cover every experiment setting exactly once`);
      if (new Set(resolvedKeys).size !== resolvedKeys.length) issues.push(`${modeId} has duplicate resolved values`);
      const assignmentByKey = new Map(assignments.map((assignment) => [assignment.key, assignment.value]));
      const resolvedByKey = new Map(recordArray(mode.resolvedValues).map((resolved) => [resolved.key, resolved.value]));
      for (const assignment of assignments) {
        const setting = settingsByKey.get(String(assignment.key));
        const accepted = Array.isArray(setting?.acceptedValues) ? setting.acceptedValues : [];
        if (assignment.value !== null && (typeof assignment.value !== "string" || !accepted.includes(assignment.value))) {
          issues.push(`${modeId} has unrestricted assignment ${String(assignment.key)}=${String(assignment.value)}`);
        }
      }
      for (const prerequisite of recordArray(mode.prerequisites)) {
        if (prerequisite.kind === "setting") {
          const setting = settingsByKey.get(String(prerequisite.key));
          if (!setting || !(prerequisite.value === null || (typeof prerequisite.value === "string" && (setting.acceptedValues as unknown[])?.includes(prerequisite.value)))) {
            issues.push(`${modeId} has malformed setting prerequisite`);
          } else {
            const actual = assignmentByKey.get(prerequisite.key) ?? resolvedByKey.get(prerequisite.key);
            if (actual !== prerequisite.value) issues.push(`${modeId} setting prerequisite does not match its mode assignment`);
          }
        } else if (prerequisite.kind === "injected-capability") {
          if (typeof prerequisite.nodeId !== "string" || !nodeIds.has(prerequisite.nodeId)) issues.push(`${modeId} has missing injected capability`);
        } else issues.push(`${modeId} has malformed prerequisite`);
      }
      const deltas = recordArray(mode.deltas);
      const deltaIds = ids(deltas);
      if (new Set(deltaIds).size !== deltaIds.length) issues.push(`${modeId} has duplicate deltas`);
      const deltaTargets = deltas.map((delta) => `${String(delta.targetKind)}:${String(delta.targetId)}`);
      if (new Set(deltaTargets).size !== deltaTargets.length) issues.push(`${modeId} has duplicate delta targets`);
      for (const delta of deltas) {
        const deltaId = `${modeId}.${String(delta.id)}`;
        const targetExists = delta.targetKind === "node" ? nodeIds.has(String(delta.targetId))
          : delta.targetKind === "edge" ? edgeIds.has(String(delta.targetId))
            : delta.targetKind === "step" ? stepIds.has(String(delta.targetId)) : false;
        if (!targetExists) issues.push(`${deltaId} references missing ${String(delta.targetKind)} ${String(delta.targetId)}`);
        if (delta.effect === "unresolved") {
          if (delta.noDirectProtocolConsumer !== true) issues.push(`${deltaId} unresolved delta must assert noDirectProtocolConsumer`);
          for (const forbidden of ["consumerPath", "consumerSymbol", "referenceChain", "behaviorTest"]) {
            if (delta[forbidden] !== undefined) issues.push(`${deltaId} unresolved delta must not include ${forbidden}`);
          }
          const unresolvedSettingKeys = Array.isArray(delta.settingKeys) ? new Set(delta.settingKeys.filter((key): key is string => typeof key === "string")) : new Set(settingsByKey.keys());
          if (unresolvedSettingKeys.size === 0 || [...unresolvedSettingKeys].some((key) => !settingsByKey.has(key))) issues.push(`${deltaId} unresolved delta has malformed settingKeys`);
          const accessorClosure = new Set<string>();
          for (const setting of settings.filter((candidate) => unresolvedSettingKeys.has(String(candidate.key)))) {
            for (const site of recordArray(setting.readSites)) {
              if (typeof site.path !== "string" || typeof site.symbol !== "string") continue;
              const origin = resolveExportOrigin({ path: site.path, symbol: site.symbol }, evidence);
              if (origin) accessorClosure.add(symbolKey(origin));
            }
            for (const hop of recordArray(setting.accessorClosure)) {
              if (typeof hop.path !== "string" || typeof hop.symbol !== "string") continue;
              const origin = resolveExportOrigin({ path: hop.path, symbol: hop.symbol }, evidence);
              if (origin) accessorClosure.add(symbolKey(origin));
            }
          }
          const escapingReferences = runtimeCallReferences(accessorClosure, evidence);
          if (escapingReferences.length > 0) issues.push(`${deltaId} unresolved accessor has direct production consumer: ${escapingReferences.join(", ")}`);
          continue;
        }
        if (!["activated", "bypassed", "changed"].includes(String(delta.effect))) issues.push(`${deltaId} has invalid effect`);
        for (const pathField of ["consumerPath"] as const) {
          if (typeof delta[pathField] !== "string") issues.push(`${deltaId} must name ${pathField}`);
          else {
            const pathError = pathIssue(delta[pathField], repoRoot, `${deltaId} ${pathField}`);
            if (pathError) issues.push(pathError);
          }
        }
        if (typeof delta.consumerSymbol !== "string" || !sourceDeclaresSymbol(String(delta.consumerPath), delta.consumerSymbol, input.sourceFiles)) issues.push(`${deltaId} consumer symbol is missing`);
        const settingKeys = Array.isArray(delta.settingKeys) ? delta.settingKeys.filter((key): key is string => typeof key === "string") : [];
        if (settingKeys.length !== 1 || !settingsByKey.has(settingKeys[0])) issues.push(`${deltaId} definitive delta must name exactly one experiment settingKey`);
        const chain = recordArray(delta.referenceChain);
        if (chain.length === 0) issues.push(`${deltaId} reference chain must not be empty`);
        const locations: SymbolLocation[] = [];
        for (const hop of chain) {
          if (typeof hop.path !== "string" || typeof hop.symbol !== "string" || !sourceDeclaresSymbol(hop.path, hop.symbol, input.sourceFiles)) issues.push(`${deltaId} reference-chain hop is missing`);
          else locations.push({ path: hop.path, symbol: hop.symbol });
        }
        const setting = settingsByKey.get(settingKeys[0]);
        const first = locations[0];
        const allowedStarts = setting ? [
          ...recordArray(setting.readSites).map((site) => ({ path: String(site.path), symbol: String(site.symbol) })),
          ...recordArray(setting.accessorClosure).map((hop) => ({ path: String(hop.path), symbol: String(hop.symbol) })),
        ] : [];
        if (first && !allowedStarts.some((start) => start.path === first.path && start.symbol === first.symbol)) issues.push(`${deltaId} reference chain must start at its setting accessor`);
        const last = locations.at(-1);
        if (last && (last.path !== delta.consumerPath || last.symbol !== delta.consumerSymbol)) issues.push(`${deltaId} reference chain must end at its consumer`);
        for (let index = 1; index < locations.length; index += 1) {
          if (!referenceHopLinked(locations[index - 1], locations[index], evidence)) issues.push(`${deltaId} reference chain has no ordered link between ${symbolKey(locations[index - 1])} and ${symbolKey(locations[index])}`);
        }
        const behaviorTest = delta.behaviorTest;
        if (!behaviorTest || typeof behaviorTest !== "object" || Array.isArray(behaviorTest)) {
          issues.push(`${deltaId} definitive delta must cite a behavior test`);
        } else {
          const testRecord = behaviorTest as Record<string, unknown>;
          if (typeof testRecord.path !== "string") issues.push(`${deltaId} behavior test must name a path`);
          else {
            const pathError = pathIssue(testRecord.path, repoRoot, `${deltaId} behavior test`);
            if (pathError) issues.push(pathError);
            const source = input.behaviorTestFiles?.[testRecord.path];
            if (typeof testRecord.testName !== "string" || !source || !behaviorTestNames(source, testRecord.path).has(testRecord.testName)) issues.push(`${deltaId} behavior test name is missing: ${String(testRecord.testName)}`);
          }
        }
      }
    }
  }
  return [...new Set(issues)].sort();
}

export function serializeAtlasArtifact(artifact: AtlasArtifact): string {
  return `globalThis.ProtocolAtlasGenerated = Object.freeze(${JSON.stringify(artifact, null, 2)});\n`;
}

async function runCli(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const outputPath = resolve(repoRoot, "docs/protocol-atlas/protocol.generated.js");
  const [input, content] = await Promise.all([
    loadProtocolGeneratorInput(repoRoot),
    loadProtocolAtlasContent(repoRoot),
  ]);
  const artifact = buildAtlasArtifact(input, content);
  const issues = [
    ...validateAtlasArtifact(artifact, repoRoot),
    ...validateCuratedReferences(content, artifact),
    ...validateConfigurationExperiments(content, artifact, input, repoRoot),
  ];
  if (issues.length > 0) throw new Error(`Protocol atlas validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  const serialized = serializeAtlasArtifact(artifact);

  if (process.argv.includes("--stdout")) {
    process.stdout.write(serialized);
    return;
  }

  if (process.argv.includes("--check")) {
    const actual = existsSync(outputPath) ? await readFile(outputPath, "utf8") : "";
    if (actual !== serialized) {
      console.error("Protocol atlas artifact is stale. Run: bun run build:protocol-atlas");
      process.exitCode = 1;
      return;
    }
    const modeCount = artifact.configurationExperiments.reduce((total, experiment) => total + experiment.modes.length, 0);
    console.log(`Protocol atlas artifact is current (${artifact.nodes.length} nodes, ${artifact.edges.length} edges, ${artifact.configurationExperiments.length} experiments, ${modeCount} modes).`);
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  const modeCount = artifact.configurationExperiments.reduce((total, experiment) => total + experiment.modes.length, 0);
  console.log(`Generated protocol atlas artifact (${artifact.nodes.length} nodes, ${artifact.edges.length} edges, ${artifact.configurationExperiments.length} experiments, ${modeCount} modes).`);
}

if (import.meta.main) await runCli();
