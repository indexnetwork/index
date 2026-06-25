import { StateGraph, START, END } from "@langchain/langgraph";
import type { NetworkMembershipGraphDatabase } from "../../shared/interfaces/database.interface.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { timed } from "../../shared/observability/performance.js";
import { NetworkMembershipGraphState } from "./membership.state.js";

const logger = protocolLogger("NetworkMembershipGraphFactory");

/**
 * Factory class to build and compile the Network Membership Graph.
 *
 * Handles CRUD operations for the index_members table:
 * - create: Add a member to an index (validates join policy and ownership)
 * - read: List members of an index (validates caller is member)
 * - delete: Remove a member from an index (future, validates ownership)
 */
export class NetworkMembershipGraphFactory {
  constructor(private database: NetworkMembershipGraphDatabase) {}

  public createGraph() {
    // --- NODE DEFINITIONS ---

    /**
     * Add Member Node: Add a user as a member of an index.
     * Handles two cases:
     * 1. Self-join (targetUserId === userId): Only allowed for public networks (joinPolicy 'anyone')
     * 2. Invite others (targetUserId !== userId): Requires caller to be member; owner-only for invite_only
     */
    const addMemberNode = async (state: typeof NetworkMembershipGraphState.State) => {
      return timed("NetworkMembershipGraph.addMember", async () => {
        logger.verbose("Add member to index", {
          userId: state.userId,
          networkId: state.networkId,
          targetUserId: state.targetUserId,
        });

        if (!state.targetUserId) {
          return { mutationResult: { success: false, error: "targetUserId is required." } };
        }

        try {
          const indexRecord = await this.database.getNetworkWithPermissions(state.networkId);
          if (!indexRecord) {
            return { mutationResult: { success: false, error: "Index not found." } };
          }

          const joinPolicy = indexRecord.permissions.joinPolicy;
          const isSelfJoin = state.targetUserId === state.userId;

          if (isSelfJoin) {
            // Self-join: only allowed for public networks
            if (joinPolicy !== 'anyone') {
              return {
                mutationResult: {
                  success: false,
                  error: "This network is invite-only. You cannot join without an invitation from an existing member.",
                },
              };
            }

            const result = await this.database.addMemberToNetwork(state.networkId, state.targetUserId, 'member');
            if (result.alreadyMember) {
              return { mutationResult: { success: true, message: "You are already a member of this network." } };
            }

            return { mutationResult: { success: true, message: `You have joined "${indexRecord.title}".` } };
          }

          // Inviting others: must be a member first
          const isMember = await this.database.isNetworkMember(state.networkId, state.userId);
          if (!isMember) {
            return { mutationResult: { success: false, error: "You must be a member of that network to add others." } };
          }

          if (joinPolicy === 'invite_only') {
            const isOwner = await this.database.isIndexOwner(state.networkId, state.userId);
            if (!isOwner) {
              return { mutationResult: { success: false, error: "Only the network owner can add members when the network is invite-only." } };
            }
          }

          const result = await this.database.addMemberToNetwork(state.networkId, state.targetUserId, 'member');
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
    };

    /**
     * List Members Node: List all members of a network.
     * Validates caller is a member.
     */
    const listMembersNode = async (state: typeof NetworkMembershipGraphState.State) => {
      return timed("NetworkMembershipGraph.listMembers", async () => {
        logger.verbose("List network members", {
          userId: state.userId,
          networkId: state.networkId,
        });

        try {
          const isMember = await this.database.isNetworkMember(state.networkId, state.userId);
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

          const members = await this.database.getNetworkMembersForMember(state.networkId, state.userId);
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
    };

    /**
     * Remove Member Node: Remove a member from a network (owner only).
     */
    const removeMemberNode = async (state: typeof NetworkMembershipGraphState.State) => {
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
          const isOwner = await this.database.isIndexOwner(state.networkId, state.userId);
          if (!isOwner) {
            return { mutationResult: { success: false, error: "Only the network owner can remove members." } };
          }

          const result = await this.database.removeMemberFromIndex(state.networkId, state.targetUserId);

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
              message: "Member removed from the index.",
            },
          };
        } catch (err) {
          logger.error("Remove member failed", { error: err });
          return { mutationResult: { success: false, error: "Failed to remove member." } };
        }
      });
    };

    // --- CONDITIONAL ROUTING ---

    const routeByMode = (state: typeof NetworkMembershipGraphState.State): string => {
      switch (state.operationMode) {
        case 'create': return 'add_member';
        case 'read': return 'list_members';
        case 'delete': return 'remove_member';
        default: return 'list_members';
      }
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(NetworkMembershipGraphState)
      .addNode("add_member", addMemberNode)
      .addNode("list_members", listMembersNode)
      .addNode("remove_member", removeMemberNode)
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
