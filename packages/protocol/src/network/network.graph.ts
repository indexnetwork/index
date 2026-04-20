import { StateGraph, START, END } from "@langchain/langgraph";

import { NetworkGraphDatabase } from "../shared/interfaces/database.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";

import { NetworkGraphState } from "./network.state.js";

const logger = protocolLogger("NetworkGraphFactory");

/**
 * Factory class to build and compile the Index (CRUD) Graph.
 *
 * Handles create, read, update, and delete operations for indexes.
 * Membership and intent-index assignment operations are handled by
 * separate graphs (NetworkMembershipGraph and IntentNetworkGraph).
 *
 * Flow:
 * START → routerNode → {createNode | readNode | updateNode | deleteNode} → END
 */
export class NetworkGraphFactory {
  constructor(private database: NetworkGraphDatabase) {}

  public createGraph() {
    // --- NODE DEFINITIONS ---

    /**
     * Read Node: List indexes the user belongs to and owns.
     */
    const readNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.read", async () => {
        logger.verbose("Read indexes", { userId: state.userId, networkId: state.networkId, showAll: state.showAll });

        try {
          const [allMemberships, ownedIndexes, publicIndexesResult] = await Promise.all([
            this.database.getNetworkMemberships(state.userId),
            this.database.getOwnedNetworks(state.userId),
            this.database.getPublicNetworksNotJoined(state.userId),
          ]);

          // If index-scoped and not showAll, return just that index (no public indexes in scoped view)
          const scopeToCurrentIndex = state.networkId && !state.showAll;
          if (scopeToCurrentIndex) {
            const networkId = state.networkId!;
            const isMember = await this.database.isNetworkMember(networkId, state.userId);
            if (!isMember) {
              return {
                readResult: {
                  memberOf: [],
                  owns: [],
                  stats: { memberOfCount: 0, ownsCount: 0, scopeNote: "Network not found or you are not a member." },
                },
              };
            }
            const membership = allMemberships.find((m) => m.networkId === networkId);
            const owned = ownedIndexes.find((o) => o.id === networkId);
            return {
              readResult: {
                memberOf: membership
                  ? [{
                      networkId: membership.networkId,
                      title: membership.networkTitle,
                      description: membership.networkPrompt,
                      autoAssign: membership.autoAssign,
                      isPersonal: membership.isPersonal,
                      joinedAt: membership.joinedAt,
                    }]
                  : [],
                owns: owned
                  ? [{ networkId: owned.id, title: owned.title, description: owned.prompt, memberCount: owned.memberCount, intentCount: owned.intentCount, joinPolicy: owned.permissions.joinPolicy }]
                  : [],
                stats: { memberOfCount: membership ? 1 : 0, ownsCount: owned ? 1 : 0, scopeNote: "Showing current index. Use showAll: true for all indexes." },
              },
            };
          }

          // Include public networks available to join
          const publicNetworks = publicIndexesResult.networks.map((idx) => ({
            networkId: idx.id,
            title: idx.title,
            description: idx.prompt,
            memberCount: idx.memberCount,
            owner: idx.owner,
          }));

          return {
            readResult: {
              memberOf: allMemberships.map((m) => ({
                networkId: m.networkId,
                title: m.networkTitle,
                description: m.networkPrompt,
                autoAssign: m.autoAssign,
                isPersonal: m.isPersonal,
                joinedAt: m.joinedAt,
              })),
              owns: ownedIndexes.map((o) => ({ networkId: o.id, title: o.title, description: o.prompt, memberCount: o.memberCount, intentCount: o.intentCount, joinPolicy: o.permissions.joinPolicy })),
              publicNetworks,
              stats: { memberOfCount: allMemberships.length, ownsCount: ownedIndexes.length, publicNetworksCount: publicNetworks.length },
            },
          };
        } catch (err) {
          logger.error("Read indexes failed", { error: err });
          return { error: "Failed to fetch network information." };
        }
      });
    };

    /**
     * Create Node: Create a new index and add user as owner.
     */
    const createNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.create", async () => {
        logger.verbose("Create index", { userId: state.userId, createInput: state.createInput });

        if (!state.createInput?.title?.trim()) {
          return { mutationResult: { success: false, error: "Title is required." } };
        }

        let createdNetworkId: string | undefined;
        try {
          const index = await this.database.createNetwork({
            title: state.createInput.title.trim(),
            prompt: state.createInput.prompt?.trim() || undefined,
            imageUrl: state.createInput.imageUrl ?? undefined,
            joinPolicy: state.createInput.joinPolicy,
          });
          createdNetworkId = index.id;

          const added = await this.database.addMemberToNetwork(index.id, state.userId, 'owner');
          if (!added.success) {
            logger.error("addMemberToNetwork failed; cleaning up orphaned network", { networkId: index.id });
            try { await this.database.softDeleteNetwork(index.id); } catch {}
            return { mutationResult: { success: false, error: "Failed to set you as owner. Network was not created." } };
          }

          return {
            mutationResult: {
              success: true,
              networkId: index.id,
              title: index.title,
              message: `Network "${index.title}" created. You are the owner.`,
            },
          };
        } catch (err) {
          logger.error("Create index failed", { error: err });
          if (createdNetworkId) {
            try { await this.database.softDeleteNetwork(createdNetworkId); } catch {}
          }
          return { mutationResult: { success: false, error: "Failed to create network." } };
        }
      });
    };

    /**
     * Update Node: Update index settings (owner only).
     */
    const updateNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.update", async () => {
        const networkId = state.networkId;
        logger.verbose("Update index", { userId: state.userId, networkId, updateInput: state.updateInput });

        if (!networkId) {
          return { mutationResult: { success: false, error: "networkId is required for update." } };
        }

        try {
          const isOwner = await this.database.isNetworkOwner(networkId, state.userId);
          if (!isOwner) {
            return { mutationResult: { success: false, error: "You can only modify networks you own." } };
          }

          await this.database.updateNetworkSettings(networkId, state.userId, state.updateInput ?? {});

          return {
            mutationResult: {
              success: true,
              networkId,
              message: "Network settings updated.",
            },
          };
        } catch (err) {
          logger.error("Update index failed", { error: err });
          return { mutationResult: { success: false, error: "Failed to update network." } };
        }
      });
    };

    /**
     * Delete Node: Soft-delete an index (owner only, sole member).
     */
    const deleteNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.delete", async () => {
        const networkId = state.networkId;
        logger.verbose("Delete index", { userId: state.userId, networkId });

        if (!networkId) {
          return { mutationResult: { success: false, error: "networkId is required for delete." } };
        }

        try {
          const isOwner = await this.database.isNetworkOwner(networkId, state.userId);
          if (!isOwner) {
            return { mutationResult: { success: false, error: "You can only delete networks you own." } };
          }

          const count = await this.database.getNetworkMemberCount(networkId);
          if (count > 1) {
            return { mutationResult: { success: false, error: "Cannot delete network with other members. Remove members first." } };
          }

          await this.database.softDeleteNetwork(networkId);

          return {
            mutationResult: {
              success: true,
              networkId,
              message: "Network deleted.",
            },
          };
        } catch (err) {
          logger.error("Delete index failed", { error: err });
          return { mutationResult: { success: false, error: "Failed to delete network." } };
        }
      });
    };

    // --- CONDITIONAL ROUTING ---

    const routeByMode = (state: typeof NetworkGraphState.State): string => {
      switch (state.operationMode) {
        case 'create': return 'create';
        case 'read': return 'read';
        case 'update': return 'update';
        case 'delete': return 'delete_idx';
        default: return 'read';
      }
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(NetworkGraphState)
      .addNode("read", readNode)
      .addNode("create", createNode)
      .addNode("update", updateNode)
      .addNode("delete_idx", deleteNode)
      .addConditionalEdges(START, routeByMode, {
        read: "read",
        create: "create",
        update: "update",
        delete_idx: "delete_idx",
      })
      .addEdge("read", END)
      .addEdge("create", END)
      .addEdge("update", END)
      .addEdge("delete_idx", END);

    return workflow.compile();
  }
}
