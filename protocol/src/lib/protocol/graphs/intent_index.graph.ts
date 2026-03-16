import { StateGraph, START, END } from "@langchain/langgraph";

import { IntentIndexer } from "../agents/intent.indexer";
import type { IntentIndexGraphDatabase } from "../interfaces/database.interface";
import { protocolLogger } from "../support/protocol.logger";
import { timed } from "../../performance";

import {
  IntentIndexGraphState,
  type IntentForIndexing,
  type IndexMemberContext,
  type AssignmentResult,
} from "../states/intent_index.state";

const logger = protocolLogger("IntentIndexGraphFactory");
const QUALIFICATION_THRESHOLD = 0.7;

/**
 * Factory class to build and compile the Intent Index Graph.
 *
 * Handles CRUD for the intent_indexes junction table:
 * - create: Assign an intent to an index (direct or evaluated via IntentIndexer agent)
 * - read: List intent-index links (by intentId or by indexId)
 * - delete: Unassign an intent from an index
 *
 * The evaluate-based assignment flow is migrated from the old Index Graph.
 */
export class IntentIndexGraphFactory {
  constructor(private database: IntentIndexGraphDatabase) {}

  public createGraph() {
    const indexer = new IntentIndexer();

    // --- NODE DEFINITIONS ---

    /**
     * Assign Node: Assign an intent to an index.
     * Two sub-paths:
     * - Direct assignment (skipEvaluation=true): assign immediately
     * - Evaluated assignment (skipEvaluation=false): load intent + index context, evaluate via IntentIndexer
     */
    const assignNode = async (state: typeof IntentIndexGraphState.State) => {
      return timed("IntentIndexGraph.assign", async () => {
        const intentId = state.intentId;
        const indexId = state.indexId;
        logger.verbose("Assign intent to index", { userId: state.userId, intentId, indexId, skipEvaluation: state.skipEvaluation });

        const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];

        if (!intentId || !indexId) {
          return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Both intentId and indexId are required." } };
        }

        try {
          // Validate ownership and membership
          const intent = await this.database.getIntent(intentId);
          if (!intent) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found." } };
          }
          if (intent.userId !== state.userId) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "You can only add your own intents to an index." } };
          }
          const isMember = await this.database.isIndexMember(indexId, state.userId);
          if (!isMember) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "You are not a member of that index." } };
          }

          // Check if already assigned
          const alreadyAssigned = await this.database.isIntentAssignedToIndex(intentId, indexId);
          if (alreadyAssigned) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: true, message: "That intent is already in this index." } };
          }

          // Direct assignment (skip evaluation)
          if (state.skipEvaluation) {
            await this.database.assignIntentToIndex(intentId, indexId, 1.0);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { indexId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent saved to the index." },
            };
          }

          // Evaluated assignment (migrated from old Index Graph)
          const intentForIndexing = await this.database.getIntentForIndexing(intentId);
          if (!intentForIndexing) {
            return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found for indexing." } };
          }

          const indexContext = await this.database.getIndexMemberContext(indexId, intentForIndexing.userId);
          if (!indexContext) {
            // No prompts or not eligible - auto-assign
            await this.database.assignIntentToIndex(intentId, indexId, 1.0);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { indexId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent assigned to index (auto-assign, no prompts)." },
            };
          }

          const hasNoPrompts = !indexContext.indexPrompt?.trim() && !indexContext.memberPrompt?.trim();
          if (hasNoPrompts) {
            await this.database.assignIntentToIndex(intentId, indexId, 1.0);
            return {
              agentTimings: agentTimingsAccum,
              assignmentResult: { indexId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: "Intent assigned to index (no prompts, auto-assign)." },
            };
          }

          // Run IntentIndexer evaluation
          const sourceName = intentForIndexing.sourceType
            ? `${intentForIndexing.sourceType}:${intentForIndexing.sourceId ?? ""}`
            : undefined;

          const _indexerStart = Date.now();
          const result = await indexer.evaluate(
            intentForIndexing.payload,
            indexContext.indexPrompt,
            indexContext.memberPrompt,
            sourceName
          );
          const _indexerMs = Date.now() - _indexerStart;
          agentTimingsAccum.push({ name: 'intent.indexer', durationMs: _indexerMs });

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
            await this.database.assignIntentToIndex(intentId, indexId, finalScore);
            return {
              agentTimings: agentTimingsAccum,
              evaluation: result,
              shouldAssign: true,
              finalScore,
              assignmentResult: { indexId, assigned: true, success: true } as AssignmentResult,
              mutationResult: { success: true, message: `Intent assigned to index (score: ${finalScore.toFixed(2)}).` },
            };
          }

          return {
            agentTimings: agentTimingsAccum,
            evaluation: result,
            shouldAssign: false,
            finalScore,
            assignmentResult: { indexId, assigned: false, success: true } as AssignmentResult,
            mutationResult: { success: false, error: `Intent did not qualify for this index (score: ${finalScore.toFixed(2)}).` },
          };
        } catch (err) {
          logger.error("Assign failed", { error: err });
          return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Failed to assign intent to index." } };
        }
      });
    };

    /**
     * Read Node: Query intent-index relationships.
     * - By intentId only: list all indexes the intent is in (owner only)
     * - By indexId only: list intents in the index (member only)
     * - By both intentId and indexId: check if specific link exists (owner only)
     */
    const readNode = async (state: typeof IntentIndexGraphState.State) => {
      return timed("IntentIndexGraph.read", async () => {
        const intentId = state.intentId;
        const indexId = state.indexId;
        logger.verbose("Read intent-index links", { userId: state.userId, intentId, indexId, queryUserId: state.queryUserId });

        try {
          // By both: check if specific intent-index link exists
          if (intentId && indexId) {
            const intent = await this.database.getIntent(intentId);
            if (!intent) {
              return { readResult: { links: [], count: 0, mode: "check_link" }, error: "Intent not found." };
            }
            if (intent.userId !== state.userId) {
              return { readResult: { links: [], count: 0, mode: "check_link" }, error: "You can only check links for your own intents." };
            }
            const isLinked = await this.database.isIntentAssignedToIndex(intentId, indexId);
            return {
              readResult: {
                links: isLinked ? [{ intentId, indexId }] : [],
                count: isLinked ? 1 : 0,
                mode: "check_link",
                note: isLinked ? "Intent is linked to this index." : "Intent is not linked to this index.",
              },
            };
          }

          // By intent only: list all indexes for this intent
          if (intentId) {
            const intent = await this.database.getIntent(intentId);
            if (!intent) {
              return { readResult: { links: [], count: 0, mode: "indexes_for_intent" }, error: "Intent not found." };
            }
            if (intent.userId !== state.userId) {
              return { readResult: { links: [], count: 0, mode: "indexes_for_intent" }, error: "You can only list indexes for your own intents." };
            }
            const indexIds = await this.database.getIndexIdsForIntent(intentId);
            return {
              readResult: {
                links: indexIds.map((id) => ({ intentId, indexId: id })),
                count: indexIds.length,
                mode: "indexes_for_intent",
                note: "To show index titles, use read_indexes.",
              },
            };
          }

          // By index: list intents in the index
          if (!indexId) {
            return {
              readResult: { links: [], count: 0, mode: "unknown" },
              error: "Provide indexId or intentId.",
            };
          }

          const isMember = await this.database.isIndexMember(indexId, state.userId);
          if (!isMember) {
            return {
              readResult: { links: [], count: 0, mode: "intents_in_index" },
              error: "Index not found or you are not a member.",
            };
          }

          // All intents or filtered by user
          if (!state.queryUserId) {
            const intents = await this.database.getIndexIntentsForMember(indexId, state.userId, { limit: 50, offset: 0 });
            return {
              readResult: {
                links: intents.map((i) => ({
                  intentId: i.id,
                  indexId,
                  intentTitle: i.payload,
                  userId: i.userId,
                  userName: i.userName,
                  createdAt: i.createdAt,
                })),
                count: intents.length,
                mode: "intents_in_index",
                note: "To show index title and full intent details, use read_indexes and read_intents.",
              },
            };
          }

          // Specific user's intents
          const intents = await this.database.getIntentsInIndexForMember(state.queryUserId, indexId);
          return {
            readResult: {
              links: intents.map((i) => ({
                intentId: i.id,
                indexId,
                intentTitle: i.payload,
                createdAt: i.createdAt,
              })),
              count: intents.length,
              mode: "intents_in_index",
              note: "To show index title and full intent details, use read_indexes and read_intents.",
            },
          };
        } catch (err) {
          logger.error("Read intent-index failed", { error: err });
          return { error: "Failed to fetch intent-index links." };
        }
      });
    };

    /**
     * Unassign Node: Remove an intent from an index.
     */
    const unassignNode = async (state: typeof IntentIndexGraphState.State) => {
      return timed("IntentIndexGraph.unassign", async () => {
        const intentId = state.intentId;
        const indexId = state.indexId;
        logger.verbose("Unassign intent from index", { userId: state.userId, intentId, indexId });

        if (!intentId || !indexId) {
          return { mutationResult: { success: false, error: "Both intentId and indexId are required." } };
        }

        try {
          const intent = await this.database.getIntent(intentId);
          if (!intent) {
            return { mutationResult: { success: false, error: "Intent not found." } };
          }
          if (intent.userId !== state.userId) {
            return { mutationResult: { success: false, error: "You can only remove your own intents from an index." } };
          }
          const isMember = await this.database.isIndexMember(indexId, state.userId);
          if (!isMember) {
            return { mutationResult: { success: false, error: "You are not a member of that index." } };
          }

          const assigned = await this.database.isIntentAssignedToIndex(intentId, indexId);
          if (!assigned) {
            return { mutationResult: { success: true, message: "That intent is not in this index." } };
          }

          await this.database.unassignIntentFromIndex(intentId, indexId);
          return { mutationResult: { success: true, message: "Intent removed from the index." } };
        } catch (err) {
          logger.error("Unassign failed", { error: err });
          return { mutationResult: { success: false, error: "Failed to remove intent from index." } };
        }
      });
    };

    // --- CONDITIONAL ROUTING ---

    const routeByMode = (state: typeof IntentIndexGraphState.State): string => {
      switch (state.operationMode) {
        case 'create': return 'assign';
        case 'read': return 'read';
        case 'delete': return 'unassign';
        default: return 'read';
      }
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(IntentIndexGraphState)
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
