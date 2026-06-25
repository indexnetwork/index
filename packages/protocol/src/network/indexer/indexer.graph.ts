import { StateGraph, START, END } from "@langchain/langgraph";

import { IntentIndexer } from "../../intent/intent.indexer.js";
import { buildNetworkAssignmentDecision } from "../../shared/assignment/network-assignment.policy.js";
import type { IntentNetworkGraphDatabase } from "../../shared/interfaces/database.interface.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../chat/chat-streaming.types.js";
import { renderNetworkContext } from "../../shared/network/metadata.renderer.js";

import { IntentNetworkGraphState, type AssignmentResult } from "./indexer.state.js";

const logger = protocolLogger("IntentNetworkGraphFactory");

/**
 * Factory class to build and compile the Intent Index Graph.
 *
 * Handles CRUD for the intent_indexes junction table:
 * - create: Assign an intent to an index (direct or evaluated via IntentIndexer agent)
 * - read: List intent-network links (by intentId or by networkId)
 * - delete: Unassign an intent from an index
 *
 * The evaluate-based assignment flow is migrated from the old Network Graph.
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
            const decision = buildNetworkAssignmentDecision({
              resourceType: "intent",
              mode: "manual_override",
              scope: "network",
              evaluator: "intent-network-graph",
              source: "manual-index-assignment",
              createdAt: new Date().toISOString(),
            });
            await this.database.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent saved to the network." },
            };
          }

          // Evaluated assignment (migrated from old Network Graph)
          const intentForIndexing = await this.database.getIntentForIndexing(intentId);
          if (!intentForIndexing) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found for networking." } };
          }

          const indexContext = await this.database.getNetworkAssignmentContext(networkId, intentForIndexing.userId);
          if (!indexContext) {
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { networkId, assigned: false, success: false } as AssignmentResult,
              mutationResult: { success: false, error: "Network assignment context not found." },
            };
          }
          const indexPrompt = indexContext.indexPrompt ?? null;
          const memberPrompt = indexContext.memberPrompt ?? null;
          const hasNoPrompts = !indexPrompt?.trim() && !memberPrompt?.trim();
          if (hasNoPrompts) {
            const decision = buildNetworkAssignmentDecision({
              resourceType: "intent",
              mode: "automatic",
              scope: "network",
              indexPrompt,
              memberPrompt,
              evaluator: "intent-networker",
              source: "intent-network-graph",
              createdAt: new Date().toISOString(),
            });
            await this.database.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent assigned to network (no prompts)." },
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
          _traceEmitterIndexer?.({ type: "agent_start", name: "intent-networker" });
          let result: Awaited<ReturnType<typeof indexer.evaluate>> | null = null;
          try {
            result = await indexer.evaluate(
              intentForIndexing.payload,
              indexPrompt,
              memberPrompt,
              sourceName,
              renderedContext
            );
          } finally {
            const _indexerMs = Date.now() - _indexerStart;
            agentTimingsAccum.push({ name: 'intent.indexer', durationMs: _indexerMs });
            _traceEmitterIndexer?.({ type: "agent_end", name: "intent-networker", durationMs: _indexerMs, summary: result ? `Scored: index=${result.indexScore.toFixed(2)}, member=${result.memberScore.toFixed(2)}` : "intent-networker failed" });
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

          const decision = buildNetworkAssignmentDecision({
            resourceType: "intent",
            mode: "automatic",
            scope: "network",
            indexPrompt,
            memberPrompt,
            rawScores: { indexScore: result.indexScore, memberScore: result.memberScore },
            evaluator: "intent-networker",
            source: "intent-network-graph",
            reason: result.reasoning,
            createdAt: new Date().toISOString(),
          });

          if (decision.assigned) {
            await this.database.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
            return {
              agentTimings: agentTimingsAccum,
              evaluation: result,
              shouldAssign: true,
              finalScore: decision.finalScore,
              assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: `Intent assigned to network (score: ${decision.finalScore.toFixed(2)}).` },
            };
          }

          return {
            agentTimings: agentTimingsAccum,
            evaluation: result,
            shouldAssign: false,
            finalScore: decision.finalScore,
            assignmentResult: { networkId, assigned: false, success: true } as AssignmentResult,
            mutationResult: { success: false, error: `Intent did not qualify for this network (score: ${decision.finalScore.toFixed(2)}).` },
          };
        } catch (err) {
          logger.error("Assign failed", { error: err });
          return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Failed to assign intent to network." } };
        }
      });
    };

    /**
     * Read Node: Query intent-network relationships.
     * - By intentId only: list all networks the intent is in (owner only)
     * - By networkId only: list intents in the index (member only)
     * - By both intentId and networkId: check if specific link exists (owner only)
     */
    const readNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.read", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Read intent-network links", { userId: state.userId, intentId, networkId, queryUserId: state.queryUserId });

        try {
          // By both: check if specific intent-network link exists
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

          // By intent only: list all networks for this intent
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
          logger.error("Read intent-network failed", { error: err });
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
