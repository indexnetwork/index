import { StateGraph, START, END } from "@langchain/langgraph";

import { buildManualAssignmentMetadata } from "../shared/assignment/network-assignment.policy.js";
import type { IntentNetworkGraphDatabase } from "../../platform/database.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import type { DebugMetaAgent } from "../../protocol/core.js";

import { IntentNetworkGraphState, type AssignmentResult } from "./indexer.state.js";

const logger = protocolLogger("IntentNetworkGraphFactory");

/**
 * Factory class to build and compile the Intent–Network (indexer) Graph.
 *
 * Handles CRUD for the intent_networks junction table:
 * - create: Link an intent to a network
 * - read: List intent–network links (by intentId or by networkId)
 * - delete: Unlink an intent from a network
 *
 * ## Signal assignment policy
 *
 * There is none to apply: a link exists because its owner asked for it. The
 * assign node writes the row at score 1 with `mode: manual_override`.
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
 *   create: assignNode → END
 *   read: readNode → END
 *   delete: unassignNode → END
 * }
 */

/** The graph's channel state, as every node sees it. */
export type IntentNetworkState = typeof IntentNetworkGraphState.State;

/** Everything the intent-network nodes reach for. */
export interface IntentNetworkGraphDeps {
  database: IntentNetworkGraphDatabase;
}

export class IntentNetworkGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: IntentNetworkGraphDeps;

  constructor(database: IntentNetworkGraphDatabase) {
    this.deps = { database };
  }

  public createGraph() {
    const deps = this.deps;
    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(IntentNetworkGraphState)
      .addNode("assign", (state: IntentNetworkState) => assignNode(state, deps))
      .addNode("read", (state: IntentNetworkState) => readNode(state, deps))
      .addNode("unassign", (state: IntentNetworkState) => unassignNode(state, deps))
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

/**
 * Persist an intent→network assignment, honouring membership, and shape the tool result.
 */
export async function finalizeAssignment(
  deps: IntentNetworkGraphDeps,
  userId: string,
  intentId: string,
  networkId: string,
  score: number,
  metadata: Parameters<IntentNetworkGraphDatabase['assignIntentToNetworkIfMember']>[4],
  successMessage: string,
) {
  const outcome = await deps.database.assignIntentToNetworkIfMember(
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
}

export async function assignNode(state: IntentNetworkState, deps: IntentNetworkGraphDeps) {
  return timed("IntentNetworkGraph.assign", async () => {
    const intentId = state.intentId;
    const networkId = state.networkId;
    logger.verbose("Assign intent to network", { userId: state.userId, intentId, networkId });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    if (!intentId || !networkId) {
      return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Both intentId and networkId are required." } };
    }

    try {
      // Validate ownership and membership
      const intent = await deps.database.getIntent(intentId);
      if (!intent) {
        return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Intent not found." } };
      }
      if (intent.userId !== state.userId) {
        return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "You can only add your own intents to a network." } };
      }
      const [isMember, isOwner] = await Promise.all([
        deps.database.isNetworkMember(networkId, state.userId),
        deps.database.isNetworkOwner(networkId, state.userId),
      ]);
      if (!isMember && !isOwner) {
        return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "You are not a member of that network." } };
      }

      // Check if already assigned
      const alreadyAssigned = await deps.database.isIntentAssignedToNetwork(intentId, networkId);
      if (alreadyAssigned) {
        return { agentTimings: agentTimingsAccum, mutationResult: { success: true, message: "That intent is already in this network." } };
      }

      const assignment = buildManualAssignmentMetadata({
        resourceType: "intent",
        source: "intent-network-graph",
        createdAt: new Date().toISOString(),
      });
      const finalized = await finalizeAssignment(
        deps,
        state.userId,
        intentId,
        networkId,
        assignment.finalScore,
        assignment.metadata,
        'Intent saved to the network.',
      );
      return { agentTimings: agentTimingsAccum, ...finalized };
    } catch (err) {
      logger.error("Assign failed", { error: err });
      return { agentTimings: agentTimingsAccum, mutationResult: { success: false, error: "Failed to assign intent to network." } };
    }
  });
}

/**
 * Read Node: Query intent–network relationships.
 *
 * Three modes (selected by which inputs are provided):
 * - Both intentId + networkId: check if the specific link exists (owner only).
 * - intentId only: list all networks the intent is linked to (owner only).
 * - networkId only: list intents in the network (member only, up to 50).
 *   Add `queryUserId` to filter to one member's intents.
 */
export async function readNode(state: IntentNetworkState, deps: IntentNetworkGraphDeps) {
  return timed("IntentNetworkGraph.read", async () => {
    const intentId = state.intentId;
    const networkId = state.networkId;
    logger.verbose("Read intent–network links", { userId: state.userId, intentId, networkId, queryUserId: state.queryUserId });

    try {
      // By both: check if specific intent–network link exists
      if (intentId && networkId) {
        const intent = await deps.database.getIntent(intentId);
        if (!intent) {
          return { readResult: { links: [], count: 0, mode: "check_link" }, error: "Intent not found." };
        }
        if (intent.userId !== state.userId) {
          return { readResult: { links: [], count: 0, mode: "check_link" }, error: "You can only check links for your own intents." };
        }
        const isLinked = await deps.database.isIntentAssignedToNetwork(intentId, networkId);
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
        const intent = await deps.database.getIntent(intentId);
        if (!intent) {
          return { readResult: { links: [], count: 0, mode: "networks_for_intent" }, error: "Intent not found." };
        }
        if (intent.userId !== state.userId) {
          return { readResult: { links: [], count: 0, mode: "networks_for_intent" }, error: "You can only list networks for your own intents." };
        }
        const networkIds = await deps.database.getNetworkIdsForIntent(intentId);
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
        deps.database.isNetworkMember(networkId, state.userId),
        deps.database.isNetworkOwner(networkId, state.userId),
      ]);
      if (!isMember && !isOwner) {
        return {
          readResult: { links: [], count: 0, mode: "intents_in_network" },
          error: "Network not found or you are not a member.",
        };
      }

      if (!state.queryUserId) {
        const intents = await deps.database.getNetworkIntentsForMember(networkId, state.userId, { limit: 50, offset: 0 });
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
      const intents = await deps.database.getIntentsInNetworkForMember(state.queryUserId, networkId);
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
}

/**
 * Unassign Node: Remove an intent from a network.
 * Only the intent owner may unassign, and only if they are a member/owner of the network.
 */
export async function unassignNode(state: IntentNetworkState, deps: IntentNetworkGraphDeps) {
  return timed("IntentNetworkGraph.unassign", async () => {
    const intentId = state.intentId;
    const networkId = state.networkId;
    logger.verbose("Unassign intent from network", { userId: state.userId, intentId, networkId });

    if (!intentId || !networkId) {
      return { mutationResult: { success: false, error: "Both intentId and networkId are required." } };
    }

    try {
      const intent = await deps.database.getIntent(intentId);
      if (!intent) {
        return { mutationResult: { success: false, error: "Intent not found." } };
      }
      if (intent.userId !== state.userId) {
        return { mutationResult: { success: false, error: "You can only remove your own intents from a network." } };
      }
      const [isMember, isOwner] = await Promise.all([
        deps.database.isNetworkMember(networkId, state.userId),
        deps.database.isNetworkOwner(networkId, state.userId),
      ]);
      if (!isMember && !isOwner) {
        return { mutationResult: { success: false, error: "You are not a member of that network." } };
      }

      const assigned = await deps.database.isIntentAssignedToNetwork(intentId, networkId);
      if (!assigned) {
        return { mutationResult: { success: true, message: "That intent is not in this network." } };
      }

      await deps.database.unassignIntentFromNetwork(intentId, networkId);
      return { mutationResult: { success: true, message: "Intent removed from the network." } };
    } catch (err) {
      logger.error("Unassign failed", { error: err });
      return { mutationResult: { success: false, error: "Failed to remove intent from network." } };
    }
  });
}

export function routeByMode(state: IntentNetworkState): string {
  switch (state.operationMode) {
    case 'create': return 'assign';
    case 'read': return 'read';
    case 'delete': return 'unassign';
    default: return 'read';
  }
}
