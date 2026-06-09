import { StateGraph, START, END } from "@langchain/langgraph";

import { PremiseGraphState } from "./premise.state.js";
import { PremiseAnalyzer } from "./premise.analyzer.js";
import { PremiseIndexer } from "./premise.indexer.js";

import {
  buildNetworkAssignmentDecision,
  resolveAssignmentNetworkScope,
} from "../shared/assignment/network-assignment.policy.js";
import { getAbortSignalConfig } from "../shared/agent/model-signal.js";
import type { PremiseGraphDatabase, PremiseAnalysis } from "../shared/interfaces/database.interface.js";
import type { Embedder } from "../shared/interfaces/embedder.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";

const logger = protocolLogger("PremiseGraphFactory");

/**
 * Graph factory for premise lifecycle: create, update, and query modes.
 */
export class PremiseGraphFactory {
  constructor(
    private database: PremiseGraphDatabase,
    private embedder: Embedder,
    private premiseIndexer: PremiseIndexer = new PremiseIndexer(),
  ) {}

  /**
   * Compiles and returns the premise lifecycle graph.
   *
   * @returns A compiled LangGraph graph handling create, update, and query modes.
   */
  public createGraph() {
    const analyzer = new PremiseAnalyzer();
    const indexer = this.premiseIndexer;

    const queryNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.query", async () => {
        logger.verbose(`[PremiseGraph.query] Fetching premises for user ${state.userId}`);
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

        logger.verbose(`[PremiseGraph.analyze] Analyzing: "${state.assertionText.substring(0, 50)}..."`);

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

        logger.verbose(`[PremiseGraph.embed] Generating embedding for premise`);

        // Embedder.generate returns number[] | number[][], cast for single string input
        const embedding = await this.embedder.generate(state.assertionText, undefined, getAbortSignalConfig()) as number[];
        return { embedding };
      });
    };

    const persistNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.persist", async () => {
        if (state.error) return {};

        if (state.operationMode === 'update' && !state.targetPremiseId) {
          return { error: "targetPremiseId is required for update mode" };
        }

        if (state.operationMode === 'update' && state.targetPremiseId) {
          logger.verbose(`[PremiseGraph.persist] Updating premise ${state.targetPremiseId}`);

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

        logger.verbose(`[PremiseGraph.persist] Creating new premise for user ${state.userId}`);

        const premise = await this.database.createPremise({
          userId: state.userId,
          assertion: {
            text: state.assertionText!,
            tier: state.tier,
          },
          provenance: {
            source: state.provenanceSource ?? 'explicit',
            sourceId: state.provenanceSourceId,
            confidence: state.provenanceConfidence ?? 1.0,
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

        logger.verbose(`[PremiseGraph.index] Scoring premise against user networks`);

        const membershipNetworkIds = await this.database.getAssignmentNetworkIdsForUser(state.userId);
        const indexIds = resolveAssignmentNetworkScope({
          memberships: membershipNetworkIds,
          networkScopeId: state.networkScopeId,
        });
        const scope = state.networkScopeId ? "network" : "global";
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
            logger.verbose(`[PremiseGraph.index] Failed to score network ${networkId}, skipping: ${err}`);
          }
        }

        logger.verbose(`[PremiseGraph.index] Assigned to ${assignments.length} networks`);

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
      .addNode("persist", persistNode)
      .addNode("index", indexNode)
      .addConditionalEdges(START, routeByMode, {
        query: "query",
        analyze: "analyze",
        end: END,
      })
      .addEdge("query", END)
      .addEdge("analyze", "embed")
      .addEdge("embed", "persist")
      .addEdge("persist", "index")
      .addEdge("index", END);

    return graph.compile();
  }
}
