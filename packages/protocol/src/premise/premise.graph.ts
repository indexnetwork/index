import { StateGraph, START, END } from "@langchain/langgraph";

import { PremiseGraphState } from "./premise.state.js";
import { PremiseAnalyzer } from "./premise.analyzer.js";
import type { PremiseAnalyzerOutput } from "./premise.analyzer.js";
import { PremiseIndexer } from "./premise.indexer.js";

import { buildNetworkAssignmentDecision, resolveAssignmentNetworkScope } from "../shared/assignment/network-assignment.policy.js";
import { getAbortSignalConfig } from "../shared/agent/model-signal.js";
import { scopeFromNetworkId } from "../shared/agent/tool.scope.js";
import type { PremiseGraphDatabase, PremiseAnalysis } from "../shared/interfaces/database.interface.js";
import type { Embedder } from "../shared/interfaces/embedder.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";

const logger = protocolLogger("PremiseGraphFactory");
const queryLog = protocolLogger("PremiseGraph:query");
const analyzeLog = protocolLogger("PremiseGraph:analyze");
const embedLog = protocolLogger("PremiseGraph:embed");
const persistLog = protocolLogger("PremiseGraph:persist");
const indexLog = protocolLogger("PremiseGraph:index");
const dedupeLog = protocolLogger("PremiseGraph:dedupe");

/**
 * Minimum cosine similarity (0-1) at which a freshly-decomposed premise is treated
 * as a near-duplicate of an existing ACTIVE premise for the same user and skipped
 * on create. Tuned high so genuine paraphrases collapse while distinct facts (e.g.
 * "I work at Google" vs "I worked at Google") still persist. Override with
 * PREMISE_DEDUP_SIMILARITY.
 */
const DEDUP_SIMILARITY_THRESHOLD = (() => {
  const raw = Number(process.env.PREMISE_DEDUP_SIMILARITY);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.93;
})();

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
export class PremiseGraphFactory {
  constructor(
    private database: PremiseGraphDatabase,
    private embedder: Embedder,
    private premiseIndexer: PremiseIndexer = new PremiseIndexer(),
    private premiseAnalyzer: { invoke(premiseText: string, profileContext?: string): Promise<PremiseAnalyzerOutput> } = new PremiseAnalyzer(),
  ) {}

  /**
   * Compiles and returns the premise lifecycle graph.
   *
   * @returns A compiled LangGraph graph handling create, update, and query modes.
   */
  public createGraph() {
    const analyzer = this.premiseAnalyzer;
    const indexer = this.premiseIndexer;

    const queryNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.query", async () => {
        queryLog.verbose('Fetching premises for user', { userId: state.userId });
        const premises = await this.database.getPremisesForUser(state.userId, 'ACTIVE');
        return {
          readResult: {
            premises,
            count: premises.length,
          },
        };
      });
    };

    const analyzeNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.analyze", async () => {
        if (!state.assertionText) {
          return { error: "assertionText is required for create/update mode" };
        }

        analyzeLog.verbose('Analyzing assertion text', { preview: state.assertionText.substring(0, 50) });

        const start = Date.now();
        const result = await analyzer.invoke(state.assertionText);
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
    };

    const embedNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.embed", async () => {
        if (state.error) return {};

        if (!state.assertionText) {
          return { error: "assertionText is required for embedding" };
        }

        embedLog.verbose(`Generating embedding for premise`);

        // Embedder.generate returns number[] | number[][], cast for single string input
        const embedding = await this.embedder.generate(state.assertionText, undefined, getAbortSignalConfig()) as number[];
        return { embedding };
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Dedupe (create mode only)
    // Skips persisting a near-duplicate of an existing ACTIVE premise for the same
    // user. Re-running similar input (e.g. repeated enrichment) therefore does not
    // accumulate near-identical premises. No-op for update mode, when no embedding
    // is available, or when the adapter does not implement findSimilarActivePremise.
    // ─────────────────────────────────────────────────────────
    const dedupeNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.dedupe", async () => {
        if (state.error) return {};
        if (state.operationMode === 'update') return {};
        if (!state.embedding || state.embedding.length === 0) return {};
        if (typeof this.database.findSimilarActivePremise !== 'function') return {};

        const match = await this.database.findSimilarActivePremise({
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
    };

    const persistNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.persist", async () => {
        if (state.error) return {};

        if (state.operationMode === 'update' && !state.targetPremiseId) {
          return { error: "targetPremiseId is required for update mode" };
        }

        if (state.operationMode === 'update' && state.targetPremiseId) {
          persistLog.verbose('Updating premise', { premiseId: state.targetPremiseId });

          const updated = await this.database.updatePremise(state.targetPremiseId, {
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
        // derive it from the analyzer's felicity scores (how authoritative, sincere,
        // and clear the assertion is) rather than a blanket 1.0, so the stored
        // provenance reflects per-premise signal quality.
        const derivedConfidence = deriveProvenanceConfidence(state.analysis);
        const premise = await this.database.createPremise({
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
    };

    const indexNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.index", async () => {
        if (!state.premise) return {};

        indexLog.verbose(`Scoring premise against user networks`);

        const assignmentMemberships = await this.database.getAssignmentNetworkMembershipsForUser(state.userId);
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
            const assignmentContext = await this.database.getNetworkAssignmentContext(networkId, state.userId);
            if (!assignmentContext) continue;
            const indexPrompt = assignmentContext.indexPrompt;
            const memberPrompt = assignmentContext.memberPrompt;
            const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
            let rawScores: { indexScore?: number; memberScore?: number } | undefined;
            let reason: string | undefined;

            if (hasPrompts) {
              const start = Date.now();
              const result = await indexer.invoke({
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
              await this.database.assignPremiseToNetwork(
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
    };

    const routeByMode = (state: typeof PremiseGraphState.State) => {
      if (state.error) return "end";
      if (state.operationMode === 'query') return "query";
      return "analyze";
    };

    const graph = new StateGraph(PremiseGraphState)
      .addNode("query", queryNode)
      .addNode("analyze", analyzeNode)
      .addNode("embed", embedNode)
      .addNode("dedupe", dedupeNode)
      .addNode("persist", persistNode)
      .addNode("index", indexNode)
      .addConditionalEdges(START, routeByMode, {
        query: "query",
        analyze: "analyze",
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
      .addEdge("index", END);

    return graph.compile();
  }
}
