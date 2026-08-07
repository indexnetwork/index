#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";

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
export type AtlasArtifact = { schemaVersion: 1; nodes: AtlasNode[]; edges: AtlasEdge[] };
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
  const sourcePaths = [...new Set(components.map(({ sourcePath }) => sourcePath))];
  const sourceEntries = await Promise.all(sourcePaths.map(async (sourcePath) => {
    assertProtocolPath(sourcePath, "component sourcePath");
    return [sourcePath, await readFile(resolve(repoRoot, sourcePath), "utf8")] as const;
  }));

  return {
    exportInventory,
    components,
    edges: reviewedEdges(),
    sourceFiles: Object.fromEntries(sourceEntries),
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
    for (const specifier of runtimeModuleSpecifiers(sourceFile)) {
      const targetPath = importedSourcePath(sourceNode.sourcePath, specifier);
      if (!targetPath) continue;
      for (const targetNode of nodesByPath.get(targetPath) ?? []) {
        if (targetNode.id === sourceNode.id) continue;
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

export function buildAtlasArtifact(input: GeneratorInput): AtlasArtifact {
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
  return { schemaVersion: 1, nodes, edges };
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
  for (const id of duplicateIds(artifact.nodes)) issues.push(`duplicate node id: ${id}`);
  for (const id of duplicateIds(artifact.edges)) issues.push(`duplicate edge id: ${id}`);
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

export function validateCuratedReferences(content: unknown, artifact: AtlasArtifact): string[] {
  const issues: string[] = [];
  const nodeIds = new Set(artifact.nodes.map(({ id }) => id));
  const edgeIds = new Set(artifact.edges.map(({ id }) => id));
  const visit = (value: unknown, location: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      const entries = Array.isArray(entry) ? entry : [entry];
      if (key === "nodeId" || key === "nodeIds") {
        entries.forEach((id) => {
          if (typeof id !== "string" || !nodeIds.has(id)) issues.push(`${location}.${key} references missing node ${String(id)}`);
        });
      } else if (key === "edgeId" || key === "edgeIds") {
        entries.forEach((id) => {
          if (typeof id !== "string" || !edgeIds.has(id)) issues.push(`${location}.${key} references missing edge ${String(id)}`);
        });
      } else {
        visit(entry, `${location}.${key}`);
      }
    }
  };
  visit(content, "content");
  return issues;
}

export function serializeAtlasArtifact(artifact: AtlasArtifact): string {
  return `globalThis.ProtocolAtlasGenerated = Object.freeze(${JSON.stringify(artifact, null, 2)});\n`;
}

async function runCli(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const outputPath = resolve(repoRoot, "docs/protocol-atlas/protocol.generated.js");
  const input = await loadProtocolGeneratorInput(repoRoot);
  const artifact = buildAtlasArtifact(input);
  const issues = validateAtlasArtifact(artifact, repoRoot);
  if (issues.length > 0) throw new Error(`Protocol atlas validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  const serialized = serializeAtlasArtifact(artifact);

  if (process.argv.includes("--check")) {
    const actual = existsSync(outputPath) ? await readFile(outputPath, "utf8") : "";
    if (actual !== serialized) {
      console.error("Protocol atlas artifact is stale. Run: bun run build:protocol-atlas");
      process.exitCode = 1;
      return;
    }
    console.log(`Protocol atlas artifact is current (${artifact.nodes.length} nodes, ${artifact.edges.length} edges).`);
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
  console.log(`Generated protocol atlas artifact (${artifact.nodes.length} nodes, ${artifact.edges.length} edges).`);
}

if (import.meta.main) await runCli();
