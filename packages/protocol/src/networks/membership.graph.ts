import { StateGraph, START, END } from "@langchain/langgraph";

import type { NetworkMembershipGraphDatabase } from "../shared/interfaces/database.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";

import { NetworkMembershipGraphState } from "./membership.state.js";

const logger = protocolLogger("NetworkMembershipGraphFactory");

/**
 * Factory class to build and compile the Network Membership Graph.
 *
 * Handles CRUD operations for the index_members table:
 * - create: Add a member to a network (validates join policy and ownership)
 * - read: List members of a network (validates caller is member)
 * - delete: Remove a member from a network (owner-only)
 *
 * ## Membership authority policy
 *
 * Self-join (`targetUserId === userId`):
 *   - Allowed only when `joinPolicy: 'anyone'`.
 *   - Idempotent: already-a-member returns success.
 *
 * Invite others (`targetUserId !== userId`):
 *   - Caller must be a member of the network.
 *   - For `invite_only` networks, caller must also be the owner.
 *   - Idempotent: already-a-member returns success.
 *
 * Remove member:
 *   - Caller must be the network owner.
 *   - Cannot remove the owner (delete the network instead).
 *   - Cannot remove yourself via this path (use leave-network flow).
 *
 * Flow:
 * START → routerNode → {addMemberNode | listMembersNode | removeMemberNode} → END
 */

/** The graph's channel state, as every node sees it. */
export type NetworkMembershipState = typeof NetworkMembershipGraphState.State;

/** Everything the membership nodes reach for. */
export interface NetworkMembershipGraphDeps {
  database: NetworkMembershipGraphDatabase;
}

export class NetworkMembershipGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: NetworkMembershipGraphDeps;

  constructor(database: NetworkMembershipGraphDatabase) {
    this.deps = { database };
  }

  public createGraph() {
    const deps = this.deps;
    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(NetworkMembershipGraphState)
      .addNode("add_member", (state: NetworkMembershipState) => addMemberNode(state, deps))
      .addNode("list_members", (state: NetworkMembershipState) => listMembersNode(state, deps))
      .addNode("remove_member", (state: NetworkMembershipState) => removeMemberNode(state, deps))
      .addConditionalEdges(START, routeByMode, {
        add_member: "add_member",
        list_members: "list_members",
        remove_member: "remove_member",
      })
      .addEdge("add_member", END)
      .addEdge("list_members", END)
      .addEdge("remove_member", END);

    return workflow.compile();
  }
}

/**
 * Add Member Node: Add a user as a member of a network.
 *
 * Two sub-paths:
 * 1. Self-join (targetUserId === userId): only allowed for 'anyone' join policy.
 * 2. Invite others (targetUserId !== userId): caller must be a member; owner-only
 *    for invite_only networks.
 */
export async function addMemberNode(state: NetworkMembershipState, deps: NetworkMembershipGraphDeps) {
  return timed("NetworkMembershipGraph.addMember", async () => {
    logger.verbose("Add member to network", {
      userId: state.userId,
      networkId: state.networkId,
      targetUserId: state.targetUserId,
    });

    if (!state.targetUserId) {
      return { mutationResult: { success: false, error: "targetUserId is required." } };
    }

    try {
      const networkRecord = await deps.database.getNetworkWithPermissions(state.networkId);
      if (!networkRecord) {
        return { mutationResult: { success: false, error: "Network not found." } };
      }

      const joinPolicy = networkRecord.permissions.joinPolicy;
      const isSelfJoin = state.targetUserId === state.userId;

      if (isSelfJoin) {
        // Self-join: only allowed for open networks
        if (joinPolicy !== 'anyone') {
          return {
            mutationResult: {
              success: false,
              error: "This network is invite-only. You cannot join without an invitation from an existing member.",
            },
          };
        }

        const result = await deps.database.addMemberToNetwork(state.networkId, state.targetUserId, 'member');
        if (result.alreadyMember) {
          return { mutationResult: { success: true, message: "You are already a member of this network." } };
        }

        return { mutationResult: { success: true, message: `You have joined "${networkRecord.title}".` } };
      }

      // Inviting others: caller must be a member first
      const isMember = await deps.database.isNetworkMember(state.networkId, state.userId);
      if (!isMember) {
        return { mutationResult: { success: false, error: "You must be a member of that network to add others." } };
      }

      if (joinPolicy === 'invite_only') {
        const isOwner = await deps.database.isIndexOwner(state.networkId, state.userId);
        if (!isOwner) {
          return { mutationResult: { success: false, error: "Only the network owner can add members when the network is invite-only." } };
        }
      }

      const result = await deps.database.addMemberToNetwork(state.networkId, state.targetUserId, 'member');
      if (result.alreadyMember) {
        return { mutationResult: { success: true, message: "That user is already a member of this network." } };
      }

      return { mutationResult: { success: true, message: "Member added to the network." } };
    } catch (err) {
      logger.error("Add member failed", { error: err });
      return {
        mutationResult: {
          success: false,
          error: err instanceof Error ? err.message : "Failed to add member.",
        },
      };
    }
  });
}

/**
 * List Members Node: List all members of a network.
 * Validates that the caller is a member before returning results.
 */
export async function listMembersNode(state: NetworkMembershipState, deps: NetworkMembershipGraphDeps) {
  return timed("NetworkMembershipGraph.listMembers", async () => {
    logger.verbose("List network members", {
      userId: state.userId,
      networkId: state.networkId,
    });

    try {
      const isMember = await deps.database.isNetworkMember(state.networkId, state.userId);
      if (!isMember) {
        return {
          readResult: {
            networkId: state.networkId,
            count: 0,
            members: [],
          },
          error: "Network not found or you are not a member.",
        };
      }

      const members = await deps.database.getNetworkMembersForMember(state.networkId, state.userId);
      return {
        readResult: {
          networkId: state.networkId,
          count: members.length,
          members: members.map((m) => ({
            userId: m.userId,
            name: m.name,
            avatar: m.avatar,
            permissions: m.permissions,
            intentCount: m.intentCount,
            joinedAt: m.joinedAt,
          })),
        },
      };
    } catch (err) {
      logger.error("List members failed", { error: err });
      if (err instanceof Error && err.message === "Access denied: Not a member of this network") {
        return { error: "You must be a member of that network." };
      }
      return { error: "Failed to fetch network members." };
    }
  });
}

/**
 * Remove Member Node: Remove a member from a network (owner only).
 *
 * The owner themselves cannot be removed via this path.  To transfer or
 * remove the owner, delete the network or promote another member first.
 */
export async function removeMemberNode(state: NetworkMembershipState, deps: NetworkMembershipGraphDeps) {
  return timed("NetworkMembershipGraph.removeMember", async () => {
    logger.verbose("Remove member from network", {
      userId: state.userId,
      networkId: state.networkId,
      targetUserId: state.targetUserId,
    });

    if (!state.targetUserId) {
      return { mutationResult: { success: false, error: "targetUserId is required." } };
    }

    // Cannot remove yourself via this flow
    if (state.targetUserId === state.userId) {
      return { mutationResult: { success: false, error: "You cannot remove yourself. Use 'leave network' instead." } };
    }

    try {
      const isOwner = await deps.database.isIndexOwner(state.networkId, state.userId);
      if (!isOwner) {
        return { mutationResult: { success: false, error: "Only the network owner can remove members." } };
      }

      const result = await deps.database.removeMemberFromIndex(state.networkId, state.targetUserId);

      if (result.wasOwner) {
        return { mutationResult: { success: false, error: "Cannot remove the network owner." } };
      }
      if (result.notMember) {
        return { mutationResult: { success: false, error: "User is not a member of this network." } };
      }
      if (!result.success) {
        return { mutationResult: { success: false, error: "Failed to remove member." } };
      }

      return {
        mutationResult: {
          success: true,
          message: "Member removed from the network.",
        },
      };
    } catch (err) {
      logger.error("Remove member failed", { error: err });
      return { mutationResult: { success: false, error: "Failed to remove member." } };
    }
  });
}

export function routeByMode(state: NetworkMembershipState): string {
  switch (state.operationMode) {
    case 'create': return 'add_member';
    case 'read': return 'list_members';
    case 'delete': return 'remove_member';
    default: return 'list_members';
  }
}

