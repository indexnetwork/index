import { StateGraph, START, END } from "@langchain/langgraph";

import { buildNetworkAssignmentDecision } from "../../shared/assignment/network-assignment.policy.js";
import type { IntentNetworkGraphDatabase } from "../ports/index.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../capabilities/participant-agents.debug.facade.js";
import { renderNetworkContext } from "../../shared/network/metadata.renderer.js";

import type { IntentIndexer } from "../ports/index.js";
import { IntentNetworkGraphState, type AssignmentResult } from "./indexer.state.js";

const logger = protocolLogger("IntentNetworkGraphFactory");

/**
 * Factory class to build and compile the Intent–Network (indexer) Graph.
 *
 * Handles CRUD for the intent_indexes junction table:
 * - create: Assign an intent to a network (direct or LLM-evaluated)
 * - read: List intent–network links (by intentId or by networkId)
 * - delete: Unassign an intent from a network
 *
 * ## Signal assignment policy
 *
 * The `IntentIndexer` is injected at construction time from the signals public
 * facade via the communities ports layer — this factory never imports signals
 * application internals directly.
 *
 * Two assignment paths:
 * 1. Direct (`skipEvaluation: true`):
 *    - Writes the link immediately with `mode: manual_override`, `score: 1`.
 * 2. Evaluated (`skipEvaluation: false`):
 *    - Loads intent + network context (indexPrompt, memberPrompt).
 *    - No-prompt fast path: if both prompts are absent, assigns with
 *      `mode: automatic, promptPresence: 'none'` without calling the LLM.
 *    - Otherwise invokes IntentIndexer to get indexScore + memberScore + reasoning.
 *    - Applies `buildNetworkAssignmentDecision` to produce the threshold/metadata.
 *    - Only writes the link when the decision's `assigned` flag is true.
 *
 * ## Membership authority for assignment
 *
 * A user may only assign their own intents.
 * The user must be a member (or owner) of the target network.
 * Assignment is rejected if membership has been revoked between intent creation
 * and assignment time (`assignIntentToNetworkIfMember` returns `membership_required`).
 *
 * Flow:
 * START → router → {
 *   create: assignNode (direct or evaluated) → END
 *   read: readNode → END
 *   delete: unassignNode → END
 * }
 *
 * IND-546: canonical home — previously network/indexer/indexer.graph.ts.
 * Signals dependency consumed via capabilities/signals.facade.ts (through ports).
 */
export class IntentNetworkGraphFactory {
  constructor(
    private database: IntentNetworkGraphDatabase,
    private intentNetworker: IntentIndexer,
  ) {}

  public createGraph() {
    const indexer = this.intentNetworker;

    const finalizeAssignment = async (
      userId: string,
      intentId: string,
      networkId: string,
      score: number,
      metadata: Parameters<IntentNetworkGraphDatabase['assignIntentToNetworkIfMember']>[4],
      successMessage: string,
    ) => {
      const outcome = await this.database.assignIntentToNetworkIfMember(
        userId,
        intentId,
        networkId,
        score,
        metadata,
      );
      if (outcome.kind === 'assigned') {
        return {
          assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
          mutationResult: { success: true, message: successMessage },
        };
      }
      if (outcome.kind === 'already_assigned') {
        return {
          assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
          mutationResult: { success: true, message: 'That intent is already in this network.' },
        };
      }
      if (outcome.kind === 'membership_required') {
        return {
          assignmentResult: { networkId, assigned: false, success: false } as AssignmentResult,
          mutationResult: { success: false, error: 'Current network membership is required to assign this intent.' },
        };
      }
      return {
        assignmentResult: { networkId, assigned: false, success: false } as AssignmentResult,
        mutationResult: { success: false, error: 'Intent is no longer available for assignment.' },
      };
    };

    // --- NODE DEFINITIONS ---

    /**
     * Assign Node: Assign an intent to a network.
     *
     * Sub-paths selected by `skipEvaluation`:
     * - true  → direct assignment (manual_override)
     * - false → evaluated assignment (automatic, with optional LLM fast-path)
     */
    const assignNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.assign", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Assign intent to network", { userId: state.userId, intentId, networkId, skipEvaluation: state.skipEvaluation });

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

          // Direct assignment (skip LLM evaluation)
          if (state.skipEvaluation) {
            const decision = buildNetworkAssignmentDecision({
              resourceType: "intent",
              mode: "manual_override",
              scope: "network",
              evaluator: "intent-network-graph",
              source: "manual-index-assignment",
              createdAt: new Date().toISOString(),
            });
            const finalized = await finalizeAssignment(
              state.userId,
              intentId,
              networkId,
              decision.finalScore,
              decision.metadata,
              'Intent saved to the network.',
            );
            return { agentTimings: agentTimingsAccum, ...finalized };
          }

          // Evaluated assignment path
          const intentForIndexing = await this.database.getIntentForIndexing(intentId);
          if (!intentForIndexing) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found for evaluation." } };
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

          // No-prompt fast path: assign without LLM
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
            const finalized = await finalizeAssignment(
              state.userId,
              intentId,
              networkId,
              decision.finalScore,
              decision.metadata,
              'Intent assigned to network (no prompts).',
            );
            return { agentTimings: agentTimingsAccum, ...finalized };
          }

          // Render network context for the evaluator
          const network = await this.database.getNetwork(networkId);
          const renderedContext = network
            ? renderNetworkContext({
                type: network.type ?? 'community',
                title: network.title,
                prompt: network.prompt,
                metadata: network.metadata ?? {},
              })
            : null;

          const sourceName = intentForIndexing.sourceType
            ? `${intentForIndexing.sourceType}:${intentForIndexing.sourceId ?? ""}`
            : undefined;

          // Run IntentIndexer evaluation (injected from signals public facade via ports)
          const _traceEmitter = requestContext.getStore()?.traceEmitter;
          const _indexerStart = Date.now();
          _traceEmitter?.({ type: "agent_start", name: "intent-networker" });
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
            _traceEmitter?.({
              type: "agent_end",
              name: "intent-networker",
              durationMs: _indexerMs,
              summary: result
                ? `Scored: index=${result.indexScore.toFixed(2)}, member=${result.memberScore.toFixed(2)}`
                : "intent-networker failed",
            });
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
            const finalized = await finalizeAssignment(
              state.userId,
              intentId,
              networkId,
              decision.finalScore,
              decision.metadata,
              `Intent assigned to network (score: ${decision.finalScore.toFixed(2)}).`,
            );
            return {
              agentTimings: agentTimingsAccum,
              evaluation: result,
              shouldAssign: finalized.assignmentResult.assigned,
              finalScore: decision.finalScore,
              ...finalized,
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
     * Read Node: Query intent–network relationships.
     *
     * Three modes (selected by which inputs are provided):
     * - Both intentId + networkId: check if the specific link exists (owner only).
     * - intentId only: list all networks the intent is linked to (owner only).
     * - networkId only: list intents in the network (member only, up to 50).
     *   Add `queryUserId` to filter to one member's intents.
     */
    const readNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.read", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Read intent–network links", { userId: state.userId, intentId, networkId, queryUserId: state.queryUserId });

        try {
          // By both: check if specific intent–network link exists
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

          // By network: list intents in the network
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

          // Specific user's intents in the network
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
          logger.error("Read intent–network failed", { error: err });
          return { error: "Failed to fetch intent–network links." };
        }
      });
    };

    /**
     * Unassign Node: Remove an intent from a network.
     * Only the intent owner may unassign, and only if they are a member/owner of the network.
     */
    const unassignNode = async (state: typeof IntentNetworkGraphState.State) => {
      return timed("IntentNetworkGraph.unassign", async () => {
        const intentId = state.intentId;
        const networkId = state.networkId;
        logger.verbose("Unassign intent from network", { userId: state.userId, intentId, networkId });

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
          return { mutationResult: { success: true, message: "Intent removed from the network." } };
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
