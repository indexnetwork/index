import { StateGraph, START, END } from "@langchain/langgraph";

import { PremiseGraphState } from "./premise.state.js";
import { PremiseAnalyzer } from "./premise.analyzer.js";
import type { PremiseAnalyzerOutput } from "./premise.analyzer.js";
import { PremiseIndexer } from "./premise.indexer.js";
import { PremiseDecomposer } from "./premise.decomposer.js";
import type { PremiseDecomposerOutput } from "./premise.decomposer.js";

import { buildNetworkAssignmentDecision, resolveAssignmentNetworkScope } from "../shared/assignment/network-assignment.policy.js";
import { getAbortSignalConfig } from "../shared/agent/model-signal.js";
import { scopeFromNetworkId } from "../shared/agent/tool.scope.js";
import type { PremiseGraphDatabase, PremiseAnalysis } from "../../platform/database.js";
import type { Embedder } from "../../platform/discovery/embedder.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import type { DebugMetaAgent } from "../../protocol/core.js";

const queryLog = protocolLogger("PremiseGraph:query");
const analyzeLog = protocolLogger("PremiseGraph:analyze");
const embedLog = protocolLogger("PremiseGraph:embed");
const persistLog = protocolLogger("PremiseGraph:persist");
const indexLog = protocolLogger("PremiseGraph:index");
const dedupeLog = protocolLogger("PremiseGraph:dedupe");
const decomposeLog = protocolLogger("PremiseGraph:decompose");

/**
 * Minimum cosine similarity (0-1) at which a freshly-decomposed premise is treated
 * as a near-duplicate of an existing ACTIVE premise for the same user and skipped
 * on create. Tuned high so genuine paraphrases collapse while distinct facts (e.g.
 * "I work at Google" vs "I worked at Google") still persist.
 */
const DEDUP_SIMILARITY_THRESHOLD = 0.93;

/**
 * Derive a premise provenance confidence (0-1) from the analyzer's felicity scores.
 * Averages authority, sincerity, and clarity — the dimensions that speak to how
 * trustworthy the self-assertion is. Falls back to 1.0 when no analysis is present.
 */
function deriveProvenanceConfidence(analysis: PremiseAnalysis | undefined): number {
  if (!analysis) return 1.0;
  const { felicityAuthority, felicitySincerity, felicityClarity } = analysis;
  const mean = (felicityAuthority + felicitySincerity + felicityClarity) / 3;
  if (!Number.isFinite(mean)) return 1.0;
  return Math.min(1, Math.max(0, mean));
}

/**
 * Graph factory for premise lifecycle: create, update, and query modes.
 */

/** The graph's channel state, as every node sees it. */
export type PremiseState = typeof PremiseGraphState.State;

/** Everything the premise nodes reach for. */
export interface PremiseGraphDeps {
  database: PremiseGraphDatabase;
  embedder: Embedder;
  premiseIndexer: PremiseIndexer;
  premiseAnalyzer: { invoke(premiseText: string, profileContext?: string): Promise<PremiseAnalyzerOutput> };
  /** Splits free text (decompose mode) into individual premises. */
  premiseDecomposer: {
    invoke(
      input: string,
      existingPremises?: Array<{ id: string; text: string }>,
      currentBio?: string,
    ): Promise<PremiseDecomposerOutput>;
  };
}

/**
 * Graph factory for premise lifecycle: create, update, and query modes.
 */
export class PremiseGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: PremiseGraphDeps;

  constructor(
    database: PremiseGraphDatabase,
    embedder: Embedder,
    premiseIndexer: PremiseIndexer = new PremiseIndexer(),
    premiseAnalyzer: { invoke(premiseText: string, profileContext?: string): Promise<PremiseAnalyzerOutput> } = new PremiseAnalyzer(),
    premiseDecomposer: PremiseGraphDeps['premiseDecomposer'] = new PremiseDecomposer(),
  ) {
    this.deps = { database, embedder, premiseIndexer, premiseAnalyzer, premiseDecomposer };
  }

  /**
   * Compiles and returns the premise lifecycle graph.
   *
   * @returns A compiled LangGraph graph handling create, update, and query modes.
   */
  public createGraph() {
    const deps = this.deps;
    const graph = new StateGraph(PremiseGraphState)
      .addNode("query", (state: PremiseState) => queryNode(state, deps))
      .addNode("analyze", (state: PremiseState) => analyzeNode(state, deps))
      .addNode("embed", (state: PremiseState) => embedNode(state, deps))
      .addNode("dedupe", (state: PremiseState) => dedupeNode(state, deps))
      .addNode("persist", (state: PremiseState) => persistNode(state, deps))
      .addNode("index", (state: PremiseState) => indexNode(state, deps))
      .addNode("decompose", (state: PremiseState) => decomposeNode(state, deps))
      .addConditionalEdges(START, routeByMode, {
        query: "query",
        analyze: "analyze",
        decompose: "decompose",
        end: END,
      })
      .addEdge("query", END)
      .addEdge("analyze", "embed")
      .addEdge("embed", "dedupe")
      // A near-duplicate short-circuits straight to END (no persist, no index).
      .addConditionalEdges("dedupe", (state: typeof PremiseGraphState.State) => (state.duplicateOf ? "end" : "persist"), {
        persist: "persist",
        end: END,
      })
      .addEdge("persist", "index")
      .addEdge("index", END)
      .addEdge("decompose", END);

    return graph.compile();
  }
}

export async function queryNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.query", async () => {
    queryLog.verbose('Fetching premises for user', { userId: state.userId });
    const premises = await deps.database.getPremisesForUser(state.userId, 'ACTIVE');
    return {
      readResult: {
        premises,
        count: premises.length,
      },
    };
  });
}

export async function analyzeNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.analyze", async () => {
    if (!state.assertionText) {
      return { error: "assertionText is required for create/update mode" };
    }

    analyzeLog.verbose('Analyzing assertion text', { preview: state.assertionText.substring(0, 50) });

    const start = Date.now();
    const result = await deps.premiseAnalyzer.invoke(state.assertionText);
    const timing: DebugMetaAgent = {
      name: "premise-analyzer",
      durationMs: Date.now() - start,
    };

    const analysis: PremiseAnalysis = {
      speechActType: result.speechActType,
      felicityAuthority: result.felicityAuthority,
      felicitySincerity: result.felicitySincerity,
      felicityClarity: result.felicityClarity,
      semanticEntropy: result.semanticEntropy,
    };

    return { analysis, agentTimings: [timing] };
  });
}

export async function embedNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.embed", async () => {
    if (state.error) return {};

    if (!state.assertionText) {
      return { error: "assertionText is required for embedding" };
    }

    embedLog.verbose(`Generating embedding for premise`);

    // Embedder.generate returns number[] | number[][], cast for single string input
    const embedding = await deps.embedder.generate(state.assertionText, undefined, getAbortSignalConfig()) as number[];
    return { embedding };
  });
}

export async function dedupeNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.dedupe", async () => {
    if (state.error) return {};
    if (state.operationMode === 'update') return {};
    if (!state.embedding || state.embedding.length === 0) return {};
    if (typeof deps.database.findSimilarActivePremise !== 'function') return {};

    const match = await deps.database.findSimilarActivePremise({
      userId: state.userId,
      embedding: state.embedding,
      threshold: DEDUP_SIMILARITY_THRESHOLD,
    });

    if (match) {
      dedupeLog.verbose('Skipping near-duplicate premise', {
        similarity: Number(match.similarity.toFixed(3)),
        threshold: DEDUP_SIMILARITY_THRESHOLD,
        premiseId: match.premiseId,
      });
      return { duplicateOf: match };
    }
    return {};
  });
}

export async function persistNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.persist", async () => {
    if (state.error) return {};

    if (state.operationMode === 'update' && !state.targetPremiseId) {
      return { error: "targetPremiseId is required for update mode" };
    }

    if (state.operationMode === 'update' && state.targetPremiseId) {
      persistLog.verbose('Updating premise', { premiseId: state.targetPremiseId });

      const updated = await deps.database.updatePremise(state.targetPremiseId, {
        assertion: {
          text: state.assertionText!,
          tier: state.tier,
        },
        analysis: state.analysis ?? undefined,
        validity: {
          validFrom: state.validFrom,
          validUntil: state.validUntil,
          volatile: state.volatile,
        },
        embedding: state.embedding,
      });
      return { premise: updated };
    }

    persistLog.verbose('Creating new premise for user', { userId: state.userId });

    // Provenance confidence: prefer an explicit caller-supplied value; otherwise
    // derive it from the deps.premiseAnalyzer's felicity scores (how authoritative, sincere,
    // and clear the assertion is) rather than a blanket 1.0, so the stored
    // provenance reflects per-premise signal quality.
    const derivedConfidence = deriveProvenanceConfidence(state.analysis);
    const premise = await deps.database.createPremise({
      userId: state.userId,
      assertion: {
        text: state.assertionText!,
        tier: state.tier,
      },
      provenance: {
        source: state.provenanceSource ?? 'explicit',
        sourceId: state.provenanceSourceId,
        confidence: state.provenanceConfidence ?? derivedConfidence,
        timestamp: new Date().toISOString(),
      },
      analysis: state.analysis ?? undefined,
      validity: {
        validFrom: state.validFrom,
        validUntil: state.validUntil,
        volatile: state.volatile,
      },
      embedding: state.embedding,
    });
    return { premise };
  });
}

export async function indexNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.index", async () => {
    if (!state.premise) return {};

    indexLog.verbose(`Scoring premise against user networks`);

    const assignmentMemberships = await deps.database.getAssignmentNetworkMembershipsForUser(state.userId);
    const requestScope = state.scopeType && state.scopeId
      ? { scopeType: state.scopeType, scopeId: state.scopeId }
      : scopeFromNetworkId(state.networkScopeId);
    const indexIds = resolveAssignmentNetworkScope({
      memberships: assignmentMemberships,
      ...requestScope,
    });
    const scope = requestScope.scopeType ? "network" : "global";
    const assignments: Array<{ networkId: string; relevancyScore: number }> = [];
    const agentTimings: DebugMetaAgent[] = [];

    for (const networkId of indexIds) {
      try {
        const assignmentContext = await deps.database.getNetworkAssignmentContext(networkId, state.userId);
        if (!assignmentContext) continue;
        const indexPrompt = assignmentContext.indexPrompt;
        const memberPrompt = assignmentContext.memberPrompt;
        const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
        let rawScores: { indexScore?: number; memberScore?: number } | undefined;
        let reason: string | undefined;

        if (hasPrompts) {
          const start = Date.now();
          const result = await deps.premiseIndexer.invoke({
            premiseText: state.assertionText!,
            indexPrompt: indexPrompt ?? "",
            memberPrompt: memberPrompt ?? undefined,
          });
          const timing: DebugMetaAgent = {
            name: "premise-indexer",
            durationMs: Date.now() - start,
          };
          rawScores = { indexScore: result.indexScore, memberScore: result.memberScore };
          reason = result.reasoning;
          agentTimings.push(timing);
        }

        const decision = buildNetworkAssignmentDecision({
          resourceType: "premise",
          mode: "automatic",
          scope,
          indexPrompt,
          memberPrompt,
          rawScores,
          evaluator: "premise-indexer",
          source: "premise-graph",
          reason,
          createdAt: new Date().toISOString(),
        });

        if (decision.assigned) {
          await deps.database.assignPremiseToNetwork(
            state.premise.id,
            networkId,
            decision.finalScore,
            decision.metadata,
          );
          assignments.push({ networkId, relevancyScore: decision.finalScore });
        }
      } catch (err) {
        indexLog.verbose('Failed to score network, skipping', { networkId, error: err });
      }
    }

    indexLog.verbose('Assigned to networks', { count: assignments.length });

    return { networkAssignments: assignments, agentTimings };
  });
}

/**
 * Decomposes free text (chat, bio, scraped content) into individual premises
 * and creates each through the normal create pipeline (analyze → embed →
 * dedupe → persist → index). Also applies any retractions and bio revision
 * the decomposer detects, offering the user's ACTIVE premises and current
 * bio (`users.intro`) so removal/denial instructions resolve to concrete
 * retractions instead of being silently dropped.
 */
export async function decomposeNode(state: PremiseState, deps: PremiseGraphDeps) {
  return timed("PremiseGraph.decompose", async () => {
    if (!state.input) {
      return { error: "input is required for decompose mode" };
    }

    decomposeLog.verbose('Decomposing input into premises', {
      userId: state.userId,
      inputLength: state.input.length,
    });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    const activePremises = await deps.database.getPremisesForUser(state.userId, 'ACTIVE');
    const existingPremises = activePremises.map((p) => ({ id: p.id, text: p.assertion.text }));

    const user = await deps.database.getUser(state.userId);
    const currentBio = user?.intro ?? '';

    const decomposeStart = Date.now();
    const result = await deps.premiseDecomposer.invoke(state.input, existingPremises, currentBio);
    agentTimingsAccum.push({ name: "premise.decomposer", durationMs: Date.now() - decomposeStart });

    // Apply retractions FIRST so a premise that is simultaneously disavowed and
    // re-asserted in corrected form does not dedupe the new create against the
    // stale active row.
    for (const premiseId of result.retractedPremiseIds ?? []) {
      try {
        await deps.database.updatePremise(premiseId, { status: 'RETRACTED', retractedAt: new Date() });
      } catch (err) {
        decomposeLog.warn("Premise retraction failed", {
          premiseId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Apply the bio revision (before the no-new-premises early return: a pure
    // removal instruction extracts zero premises but still rewrites the bio).
    const revisedBio = result.revisedBio?.trim();
    if (revisedBio && revisedBio !== currentBio.trim()) {
      try {
        await deps.database.updateUser(state.userId, { intro: revisedBio });
      } catch (err) {
        decomposeLog.warn("Bio revision failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.premises.length === 0) {
      return { agentTimings: agentTimingsAccum };
    }

    decomposeLog.verbose('Creating premises', { count: result.premises.length, userId: state.userId });

    for (const p of result.premises) {
      try {
        // Contextual premises carry an LLM-inferred validity window and are
        // volatile (auto-retract on expiry); assertive premises do not expire.
        const isContextual = p.tier === 'contextual';
        const validUntil = isContextual && p.validityDays
          ? new Date(Date.now() + p.validityDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined;

        const timings = await createOne(
          {
            ...state,
            assertionText: p.text,
            tier: p.tier,
            operationMode: 'create',
            volatile: isContextual,
            validFrom: undefined,
            validUntil,
            targetPremiseId: undefined,
            analysis: undefined,
            embedding: undefined,
            premise: undefined,
            duplicateOf: undefined,
            networkAssignments: [],
            error: undefined,
          },
          deps,
        );
        agentTimingsAccum.push(...timings);
      } catch (err) {
        decomposeLog.warn("Premise creation failed", {
          text: p.text.substring(0, 60),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { agentTimings: agentTimingsAccum };
  });
}

/**
 * Runs one premise through the create pipeline (analyze → embed → dedupe →
 * persist → index) by calling the same node functions the graph itself
 * uses, so decompose mode never duplicates the create logic.
 */
async function createOne(state: PremiseState, deps: PremiseGraphDeps): Promise<DebugMetaAgent[]> {
  const timings: DebugMetaAgent[] = [];

  const analyzeResult = await analyzeNode(state, deps);
  timings.push(...(analyzeResult.agentTimings ?? []));
  let s = { ...state, ...analyzeResult };
  if (s.error) return timings;

  s = { ...s, ...(await embedNode(s, deps)) };
  if (s.error) return timings;

  s = { ...s, ...(await dedupeNode(s, deps)) };
  if (s.duplicateOf) return timings;

  s = { ...s, ...(await persistNode(s, deps)) };
  if (!s.premise) return timings;

  const indexResult = await indexNode(s, deps);
  timings.push(...(indexResult.agentTimings ?? []));
  return timings;
}

export function routeByMode(state: PremiseState) {
  if (state.error) return "end";
  if (state.operationMode === 'query') return "query";
  if (state.operationMode === 'decompose') return "decompose";
  return "analyze";
}

