import { StateGraph, START, END } from "@langchain/langgraph";

import { PremiseGraphState } from "./premise.state.js";
import { PremiseAnalyzer } from "./premise.analyzer.js";
import { PremiseIndexer } from "./premise.indexer.js";

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
  ) {}

  /**
   * Compiles and returns the premise lifecycle graph.
   *
   * @returns A compiled LangGraph graph handling create, update, and query modes.
   */
  public createGraph() {
    const analyzer = new PremiseAnalyzer();
    const indexer = new PremiseIndexer();

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

        const indexIds = await this.database.getUserIndexIds(state.userId);
        const assignments: Array<{ networkId: string; relevancyScore: number }> = [];

        for (const networkId of indexIds) {
          try {
            const network = await this.database.getNetwork(networkId);
            if (!network || !network.prompt) continue;

            const memberContext = await this.database.getNetworkMemberContext(networkId, state.userId);

            const start = Date.now();
            const result = await indexer.invoke({
              premiseText: state.assertionText!,
              indexPrompt: network.prompt,
              memberPrompt: memberContext?.memberPrompt ?? undefined,
            });
            const timing: DebugMetaAgent = {
              name: "premise-indexer",
              durationMs: Date.now() - start,
            };

            const score = Math.max(result.indexScore, result.memberScore);
            if (score >= 0.5) {
              await this.database.assignPremiseToNetwork(state.premise.id, networkId, score);
              assignments.push({ networkId, relevancyScore: score });
            }
          } catch (err) {
            logger.verbose(`[PremiseGraph.index] Failed to score network ${networkId}, skipping: ${err}`);
          }
        }

        logger.verbose(`[PremiseGraph.index] Assigned to ${assignments.length} networks`);

        return { networkAssignments: assignments };
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
