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
 * Membership and intent-network assignment operations are handled by
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
     * Read Node: List networks the user belongs to and owns.
     */
    const readNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.read", async () => {
        logger.verbose("Read networks", { userId: state.userId, networkId: state.networkId, showAll: state.showAll });

        // Shared projections for both the scoped and unscoped read paths.
        const projectMembership = (m: Awaited<ReturnType<typeof this.database.getNetworkMemberships>>[number]) => ({
          networkId: m.networkId,
          title: m.networkTitle,
          prompt: m.indexPrompt,
          autoAssign: m.autoAssign,
          isPersonal: m.isPersonal,
          joinedAt: m.joinedAt,
        });
        const projectOwned = (o: Awaited<ReturnType<typeof this.database.getOwnedIndexes>>[number]) => ({
          networkId: o.id,
          title: o.title,
          prompt: o.prompt,
          memberCount: o.memberCount,
          intentCount: o.intentCount,
          joinPolicy: o.permissions.joinPolicy,
        });

        try {
          const [allMemberships, ownedIndexes, publicIndexesResult] = await Promise.all([
            this.database.getNetworkMemberships(state.userId),
            this.database.getOwnedIndexes(state.userId),
            this.database.getPublicIndexesNotJoined(state.userId),
          ]);

          // If network-scoped and not showAll, return just that index plus the
          // user's personal network (their contacts). The personal network is part
          // of every allowed-network reach calculation for network-bound agents,
          // and a user clicked into a community-scoped
          // chat still owns their contact list — so surfacing it here keeps
          // tools that operate on the personal network (add_contact, list_contacts,
          // import_*_contacts) discoverable. Other community memberships are
          // still hidden, and `publicNetworks` is omitted.
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
            const scopedMembership = allMemberships.find((m) => m.networkId === networkId);
            const personalMembership = scopedMembership?.isPersonal
              ? undefined
              : allMemberships.find((m) => m.isPersonal);
            const scopedOwned = ownedIndexes.find((o) => o.id === networkId);
            const personalOwned = personalMembership
              ? ownedIndexes.find((o) => o.id === personalMembership.networkId)
              : undefined;
            const memberOf = [
              ...(scopedMembership ? [projectMembership(scopedMembership)] : []),
              ...(personalMembership ? [projectMembership(personalMembership)] : []),
            ];
            const owns = [
              ...(scopedOwned ? [projectOwned(scopedOwned)] : []),
              ...(personalOwned ? [projectOwned(personalOwned)] : []),
            ];
            return {
              readResult: {
                memberOf,
                owns,
                stats: {
                  memberOfCount: memberOf.length,
                  ownsCount: owns.length,
                  scopeNote: "Showing current network and your personal network. Use showAll: true for all networks.",
                },
              },
            };
          }

          // Include public networks available to join
          const publicNetworks = publicIndexesResult.networks.map((idx) => ({
            networkId: idx.id,
            title: idx.title,
            prompt: idx.prompt,
            memberCount: idx.memberCount,
            owner: idx.owner,
          }));

          return {
            readResult: {
              memberOf: allMemberships.map(projectMembership),
              owns: ownedIndexes.map(projectOwned),
              publicNetworks,
              stats: { memberOfCount: allMemberships.length, ownsCount: ownedIndexes.length, publicNetworksCount: publicNetworks.length },
            },
          };
        } catch (err) {
          logger.error("Read networks failed", { error: err });
          return { error: "Failed to fetch network information." };
        }
      });
    };

    /**
     * Create Node: Create a new index and add user as owner.
     */
    const createNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.create", async () => {
        logger.verbose("Create network", { userId: state.userId, createInput: state.createInput });

        if (!state.createInput?.title?.trim()) {
          return { mutationResult: { success: false, error: "Title is required." } };
        }

        let createdIndexId: string | undefined;
        try {
          const index = await this.database.createNetwork({
            title: state.createInput.title.trim(),
            prompt: state.createInput.prompt?.trim() || undefined,
            imageUrl: state.createInput.imageUrl ?? undefined,
            joinPolicy: state.createInput.joinPolicy,
          });
          createdIndexId = index.id;

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
          logger.error("Create network failed", { error: err });
          if (createdIndexId) {
            try { await this.database.softDeleteNetwork(createdIndexId); } catch {}
          }
          return {
            mutationResult: {
              success: false,
              error: err instanceof Error ? err.message : "Failed to create network.",
            },
          };
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
          const isOwner = await this.database.isIndexOwner(networkId, state.userId);
          if (!isOwner) {
            return { mutationResult: { success: false, error: "You can only modify networks you own." } };
          }

          await this.database.updateIndexSettings(networkId, state.userId, state.updateInput ?? {});

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
     * Delete Node: Soft-delete a network (owner only, sole member).
     */
    const deleteNode = async (state: typeof NetworkGraphState.State) => {
      return timed("NetworkGraph.delete", async () => {
        const networkId = state.networkId;
        logger.verbose("Delete network", { userId: state.userId, networkId });

        if (!networkId) {
          return { mutationResult: { success: false, error: "networkId is required for delete." } };
        }

        try {
          const isOwner = await this.database.isIndexOwner(networkId, state.userId);
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
          logger.error("Delete network failed", { error: err });
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
