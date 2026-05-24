import { StateGraph, START, END } from "@langchain/langgraph";

import { IntentIndexer } from "../../intent/intent.indexer.js";
import type { IntentNetworkGraphDatabase } from "../../shared/interfaces/database.interface.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../chat/chat-streaming.types.js";
import { renderNetworkContext } from "../../shared/network/metadata.renderer.js";

import {
  IntentNetworkGraphState,
  type IntentForIndexing,
  type IndexMemberContext,
  type AssignmentResult,
} from "./indexer.state.js";

const logger = protocolLogger("IntentNetworkGraphFactory");
const QUALIFICATION_THRESHOLD = 0.7;

/**
 * Factory class to build and compile the Intent Index Graph.
 *
 * Handles CRUD for the intent_indexes junction table:
 * - create: Assign an intent to an index (direct or evaluated via IntentIndexer agent)
 * - read: List intent-index links (by intentId or by networkId)
 * - delete: Unassign an intent from an index
 *
 * The evaluate-based assignment flow is migrated from the old Index Graph.
 */
export class IntentNetworkGraphFactory {
  constructor(
    private database: IntentNetworkGraphDatabase,
    private intentNetworker: IntentIndexer,
  ) {}

  public createGraph() {
    const indexer = this.intentNetworker;

    // --- NODE DEFINITIONS ---

    /**
     * Assign Node: Assign an intent to an index.
     * Two sub-paths:
     * - Direct assignment (skipEvaluation=true): assign immediately
     * - Evaluated assignment (skipEvaluation=false): load intent + index context, evaluate via IntentIndexer
     */
    const assignNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.assign", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Assign intent to index", { userId: state.userId, intentId, networkId, skipEvaluation: state.skipEvaluation });

        const agentTimingsAccum: DebugMetaAgent[] = [];

        if (!intentId || !networkId) {
          return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Both intentId and networkId are required." } };
        }

        try {
          // Validate ownership and membership
          const intent = await this.database.getIntent(intentId);
          if (!intent) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found." } };
          }
          if (intent.userId !== state.userId) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "You can only add your own intents to a network." } };
          }
          const [isMember, isOwner] = await Promise.all([
            this.database.isNetworkMember(networkId, state.userId),
            this.database.isIndexOwner(networkId, state.userId),
          ]);
          if (!isMember && !isOwner) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "You are not a member of that network." } };
          }

          // Check if already assigned
          const alreadyAssigned = await this.database.isIntentAssignedToIndex(intentId, networkId);
          if (alreadyAssigned) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: true, message: "That intent is already in this network." } };
          }

          // Direct assignment (skip evaluation)
          if (state.skipEvaluation) {
            await this.database.assignIntentToNetwork(intentId, networkId, 1.0);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent saved to the network." },
            };
          }

          // Evaluated assignment (migrated from old Index Graph)
          const intentForIndexing = await this.database.getIntentForIndexing(intentId);
          if (!intentForIndexing) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found for networking." } };
          }

          const indexContext = await this.database.getNetworkMemberContext(networkId, intentForIndexing.userId);
          if (!indexContext) {
            // No prompts or not eligible - auto-assign
            await this.database.assignIntentToNetwork(intentId, networkId, 1.0);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent assigned to network (auto-assign, no prompts)." },
            };
          }

          const hasNoPrompts = !indexContext.indexPrompt?.trim() && !indexContext.memberPrompt?.trim();
          if (hasNoPrompts) {
            await this.database.assignIntentToNetwork(intentId, networkId, 1.0);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent assigned to network (no prompts, auto-assign)." },
            };
          }

          // Run IntentIndexer evaluation
          const sourceName = intentForIndexing.sourceType
            ? `${intentForIndexing.sourceType}:${intentForIndexing.sourceId ?? ""}`
            : undefined;

          // Render network context (type, metadata) for the evaluator
          const network = await this.database.getNetwork(networkId);
          const renderedContext = network
            ? renderNetworkContext({
                type: network.type ?? 'community',
                title: network.title,
                prompt: network.prompt,
                metadata: network.metadata ?? {},
              })
            : null;

          const _traceEmitterIndexer = requestContext.getStore()?.traceEmitter;
          const _indexerStart = Date.now();
          _traceEmitterIndexer?.({ type: "agent_start", name: "intent-indexer" });
          let result: Awaited<ReturnType<typeof indexer.evaluate>> | null = null;
          try {
            result = await indexer.evaluate(
              intentForIndexing.payload,
              indexContext.indexPrompt,
              indexContext.memberPrompt,
              sourceName,
              renderedContext
            );
          } finally {
            const _indexerMs = Date.now() - _indexerStart;
            agentTimingsAccum.push({ name: 'intent.indexer', durationMs: _indexerMs });
            _traceEmitterIndexer?.({ type: "agent_end", name: "intent-indexer", durationMs: _indexerMs, summary: result ? `Scored: index=${result.indexScore.toFixed(2)}, member=${result.memberScore.toFixed(2)}` : "intent-indexer failed" });
          }

          if (!result) {
            return {
              agentTimings: agentTimingsAccum,
              evaluation: null,
              shouldAssign: false,
              finalScore: 0,
              mutationResult: { success: false, error: "Evaluation returned no result." },
            };
          }

          const { indexScore, memberScore } = result;
          const ip = indexContext.indexPrompt?.trim();
          const mp = indexContext.memberPrompt?.trim();

          let shouldAssign = false;
          let finalScore = 0;

          if (ip && mp) {
            if (indexScore > QUALIFICATION_THRESHOLD && memberScore > QUALIFICATION_THRESHOLD) {
              shouldAssign = true;
              finalScore = indexScore * 0.6 + memberScore * 0.4;
            }
          } else if (ip) {
            if (indexScore > QUALIFICATION_THRESHOLD) {
              shouldAssign = true;
              finalScore = indexScore;
            }
          } else if (mp) {
            if (memberScore > QUALIFICATION_THRESHOLD) {
              shouldAssign = true;
              finalScore = memberScore;
            }
          } else {
            shouldAssign = true;
            finalScore = 1.0;
          }

          if (shouldAssign) {
            await this.database.assignIntentToNetwork(intentId, networkId, finalScore);
            return {
              agentTimings: agentTimingsAccum,
              evaluation: result,
              shouldAssign: true,
              finalScore,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: `Intent assigned to network (score: ${finalScore.toFixed(2)}).` },
            };
          }

          return {
            agentTimings: agentTimingsAccum,
            evaluation: result,
            shouldAssign: false,
            finalScore,
            assignmentResult: { networkId, assigned: false, success: true } as AssignmentResult,
            mutationResult: { success: false, error: `Intent did not qualify for this network (score: ${finalScore.toFixed(2)}).` },
          };
        } catch (err) {
          logger.error("Assign failed", { error: err });
          return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Failed to assign intent to network." } };
        }
      });
    };

    /**
     * Read Node: Query intent-index relationships.
     * - By intentId only: list all indexes the intent is in (owner only)
     * - By networkId only: list intents in the index (member only)
     * - By both intentId and networkId: check if specific link exists (owner only)
     */
    const readNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.read", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Read intent-index links", { userId: state.userId, intentId, networkId, queryUserId: state.queryUserId });

        try {
          // By both: check if specific intent-index link exists
          if (intentId && networkId) {
            const intent = await this.database.getIntent(intentId);
            if (!intent) {
              return { readResult: { links: [], count: 0, mode: "check_link" }, error: "Intent not found." };
            }
            if (intent.userId !== state.userId) {
              return { readResult: { links: [], count: 0, mode: "check_link" }, error: "You can only check links for your own intents." };
            }
            const isLinked = await this.database.isIntentAssignedToIndex(intentId, networkId);
            return {
              readResult: {
                links: isLinked ? [{ intentId, networkId }] : [],
                count: isLinked ? 1 : 0,
                mode: "check_link",
                note: isLinked ? "Intent is linked to this network." : "Intent is not linked to this network.",
              },
            };
          }

          // By intent only: list all indexes for this intent
          if (intentId) {
            const intent = await this.database.getIntent(intentId);
            if (!intent) {
              return { readResult: { links: [], count: 0, mode: "networks_for_intent" }, error: "Intent not found." };
            }
            if (intent.userId !== state.userId) {
              return { readResult: { links: [], count: 0, mode: "networks_for_intent" }, error: "You can only list networks for your own intents." };
            }
            const networkIds = await this.database.getNetworkIdsForIntent(intentId);
            return {
              readResult: {
                links: networkIds.map((id) => ({ intentId, networkId: id })),
                count: networkIds.length,
                mode: "networks_for_intent",
                note: "To show network titles, use read_networks.",
              },
            };
          }

          // By index: list intents in the index
          if (!networkId) {
            return {
              readResult: { links: [], count: 0, mode: "unknown" },
              error: "Provide networkId or intentId.",
            };
          }

          const [isMember, isOwner] = await Promise.all([
            this.database.isNetworkMember(networkId, state.userId),
            this.database.isIndexOwner(networkId, state.userId),
          ]);
          if (!isMember && !isOwner) {
            return {
              readResult: { links: [], count: 0, mode: "intents_in_network" },
              error: "Network not found or you are not a member.",
            };
          }

          // All intents or filtered by user
          if (!state.queryUserId) {
            const intents = await this.database.getNetworkIntentsForMember(networkId, state.userId, { limit: 50, offset: 0 });
            return {
              readResult: {
                links: intents.map((i) => ({
                  intentId: i.id,
                  networkId,
                  intentTitle: i.payload,
                  userId: i.userId,
                  userName: i.userName,
                  createdAt: i.createdAt,
                  relevancyScore: i.relevancyScore,
                })),
                count: intents.length,
                mode: "intents_in_network",
                note: "To show network title and full intent details, use read_networks and read_intents.",
              },
            };
          }

          // Specific user's intents
          const intents = await this.database.getIntentsInIndexForMember(state.queryUserId, networkId);
          return {
            readResult: {
              links: intents.map((i) => ({
                intentId: i.id,
                networkId,
                intentTitle: i.payload,
                createdAt: i.createdAt,
                relevancyScore: i.relevancyScore,
              })),
              count: intents.length,
              mode: "intents_in_network",
              note: "To show network title and full intent details, use read_networks and read_intents.",
            },
          };
        } catch (err) {
          logger.error("Read intent-index failed", { error: err });
          return { error: "Failed to fetch intent-network links." };
        }
      });
    };

    /**
     * Unassign Node: Remove an intent from an index.
     */
    const unassignNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.unassign", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Unassign intent from index", { userId: state.userId, intentId, networkId });

        if (!intentId || !networkId) {
          return { mutationResult: { success: false, error: "Both intentId and networkId are required." } };
        }

        try {
          const intent = await this.database.getIntent(intentId);
          if (!intent) {
            return { mutationResult: { success: false, error: "Intent not found." } };
          }
          if (intent.userId !== state.userId) {
            return { mutationResult: { success: false, error: "You can only remove your own intents from a network." } };
          }
          const [isMember, isOwner] = await Promise.all([
            this.database.isNetworkMember(networkId, state.userId),
            this.database.isIndexOwner(networkId, state.userId),
          ]);
          if (!isMember && !isOwner) {
            return { mutationResult: { success: false, error: "You are not a member of that network." } };
          }

          const assigned = await this.database.isIntentAssignedToIndex(intentId, networkId);
          if (!assigned) {
            return { mutationResult: { success: true, message: "That intent is not in this network." } };
          }

          await this.database.unassignIntentFromIndex(intentId, networkId);
          return { mutationResult: { success: true, message: "Intent removed from the index." } };
        } catch (err) {
          logger.error("Unassign failed", { error: err });
          return { mutationResult: { success: false, error: "Failed to remove intent from network." } };
        }
      });
    };

    // --- CONDITIONAL ROUTING ---

    const routeByMode = (state: typeof IntentNetworkGraphState.State): string => {
      switch (state.operationMode) {
        case 'create': return 'assign';
        case 'read': return 'read';
        case 'delete': return 'unassign';
        default: return 'read';
      }
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(IntentNetworkGraphState)
      .addNode("assign", assignNode)
      .addNode("read", readNode)
      .addNode("unassign", unassignNode)
      .addConditionalEdges(START, routeByMode, {
        assign: "assign",
        read: "read",
        unassign: "unassign",
      })
      .addEdge("assign", END)
      .addEdge("read", END)
      .addEdge("unassign", END);

    return workflow.compile();
  }
}
