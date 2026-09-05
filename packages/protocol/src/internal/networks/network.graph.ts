import { StateGraph, START, END } from "@langchain/langgraph";

import type { NetworkGraphDatabase } from "../../platform/database.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";

import { NetworkGraphState } from "./network.state.js";

const logger = protocolLogger("NetworkGraphFactory");

/**
 * Factory class to build and compile the Network (community) lifecycle graph.
 *
 * Handles create, read, update, and delete operations for networks.
 * Membership and intent–network assignment operations are delegated to
 * NetworkMembershipGraphFactory and IntentNetworkGraphFactory respectively.
 *
 * ## Ownership policy
 *
 * - `create`: the calling user becomes the sole owner.  The owner–membership
 *   write is performed atomically after the network row is created; on failure
 *   the network is soft-deleted (rollback).  Rollback failures are logged but
 *   do NOT mutate the error response — the caller always receives the first
 *   meaningful failure, not a noisy rollback message.
 * - `update`: owner-only.  Any member field may be updated in one call.
 * - `delete`: owner-only; the network must have no other members.
 *
 * ## Scope semantics (read mode)
 *
 * When `networkId` is set and `showAll` is false, only the focused network is
 * returned. This is the strict-scope invariant for network-bound agents.
 * Set `showAll: true` to bypass.
 *
 * Flow:
 * START → routerNode → {createNode | readNode | updateNode | deleteNode} → END
 */

/** The graph's channel state, as every node sees it. */
export type NetworkState = typeof NetworkGraphState.State;

/** Everything the network nodes reach for. */
export interface NetworkGraphDeps {
  database: NetworkGraphDatabase;
}

export class NetworkGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: NetworkGraphDeps;

  constructor(database: NetworkGraphDatabase) {
    this.deps = { database };
  }

  public createGraph() {
    const deps = this.deps;
    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(NetworkGraphState)
      .addNode("read", (state: NetworkState) => readNode(state, deps))
      .addNode("create", (state: NetworkState) => createNode(state, deps))
      .addNode("update", (state: NetworkState) => updateNode(state, deps))
      .addNode("delete_idx", (state: NetworkState) => deleteNode(state, deps))
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

/**
 * Read Node: List networks the user belongs to and owns.
 */
export async function readNode(state: NetworkState, deps: NetworkGraphDeps) {
  return timed("NetworkGraph.read", async () => {
    logger.verbose("Read networks", { userId: state.userId, networkId: state.networkId, showAll: state.showAll });

    // Shared projections for both the scoped and unscoped read paths.
    const projectMembership = (m: Awaited<ReturnType<typeof deps.database.getNetworkMemberships>>[number]) => ({
      networkId: m.networkId,
      title: m.networkTitle,
      prompt: m.networkPrompt,
      autoAssign: m.autoAssign,
      joinedAt: m.joinedAt,
    });
    const projectOwned = (o: Awaited<ReturnType<typeof deps.database.getOwnedNetworks>>[number]) => ({
      networkId: o.id,
      title: o.title,
      prompt: o.prompt,
      memberCount: o.memberCount,
      intentCount: o.intentCount,
      joinPolicy: o.permissions.joinPolicy,
    });

    try {
      const [allMemberships, ownedNetworks, publicNetworksResult] = await Promise.all([
        deps.database.getNetworkMemberships(state.userId),
        deps.database.getOwnedNetworks(state.userId),
        deps.database.getPublicNetworksNotJoined(state.userId),
      ]);

      // If network-scoped and not showAll, return just that network.
      const scopeToCurrentNetwork = state.networkId && !state.showAll;
      if (scopeToCurrentNetwork) {
        const networkId = state.networkId!;
        const isMember = await deps.database.isNetworkMember(networkId, state.userId);
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
        const scopedOwned = ownedNetworks.find((o) => o.id === networkId);
        const memberOf = [
          ...(scopedMembership ? [projectMembership(scopedMembership)] : []),
        ];
        const owns = [
          ...(scopedOwned ? [projectOwned(scopedOwned)] : []),
        ];
        return {
          readResult: {
            memberOf,
            owns,
            stats: {
              memberOfCount: memberOf.length,
              ownsCount: owns.length,
              scopeNote: "Showing the current network. Use showAll: true for all networks.",
            },
          },
        };
      }

      // Include public networks available to join
      const publicNetworks = publicNetworksResult.networks.map((idx) => ({
        networkId: idx.id,
        title: idx.title,
        prompt: idx.prompt,
        memberCount: idx.memberCount,
        owner: idx.owner,
      }));

      return {
        readResult: {
          memberOf: allMemberships.map(projectMembership),
          owns: ownedNetworks.map(projectOwned),
          publicNetworks,
          stats: { memberOfCount: allMemberships.length, ownsCount: ownedNetworks.length, publicNetworksCount: publicNetworks.length },
        },
      };
    } catch (err) {
      logger.error("Read networks failed", { error: err });
      return { error: "Failed to fetch network information." };
    }
  });
}

/**
 * Create Node: Create a new network and add user as owner.
 *
 * Atomicity contract:
 * 1. Create the network row.
 * 2. Add the calling user as owner.
 * 3. On step-2 failure: soft-delete the network (rollback).
 * 4. Rollback failures are logged at error level but never override the
 *    primary failure message returned to the caller.
 */
export async function createNode(state: NetworkState, deps: NetworkGraphDeps) {
  return timed("NetworkGraph.create", async () => {
    logger.verbose("Create network", { userId: state.userId, createInput: state.createInput });

    if (!state.createInput?.title?.trim()) {
      return { mutationResult: { success: false, error: "Title is required." } };
    }

    let createdNetworkId: string | undefined;
    try {
      const network = await deps.database.createNetwork({
        title: state.createInput.title.trim(),
        prompt: state.createInput.prompt?.trim() || undefined,
        imageUrl: state.createInput.imageUrl ?? undefined,
        joinPolicy: state.createInput.joinPolicy,
      });
      createdNetworkId = network.id;

      const added = await deps.database.addMemberToNetwork(network.id, state.userId, 'owner');
      if (!added.success) {
        logger.error("addMemberToNetwork failed; cleaning up orphaned network", { networkId: network.id });
        try {
          await deps.database.softDeleteNetwork(network.id);
        } catch (rollbackError) {
          logger.error("Network create rollback failed", {
            networkId: network.id,
            rollbackFor: "owner_membership",
            rollbackErrorKind: rollbackError instanceof Error ? "error" : "non_error",
          });
        }
        return { mutationResult: { success: false, error: "Failed to set you as owner. Network was not created." } };
      }

      return {
        mutationResult: {
          success: true,
          networkId: network.id,
          title: network.title,
          message: `Network "${network.title}" created. You are the owner.`,
        },
      };
    } catch (err) {
      logger.error("Create network failed", { error: err });
      if (createdNetworkId) {
        try {
          await deps.database.softDeleteNetwork(createdNetworkId);
        } catch (rollbackError) {
          logger.error("Network create rollback failed", {
            networkId: createdNetworkId,
            rollbackFor: "create_operation",
            rollbackErrorKind: rollbackError instanceof Error ? "error" : "non_error",
          });
        }
      }
      return {
        mutationResult: {
          success: false,
          error: err instanceof Error ? err.message : "Failed to create network.",
        },
      };
    }
  });
}

/**
 * Update Node: Update network settings (owner only).
 */
export async function updateNode(state: NetworkState, deps: NetworkGraphDeps) {
  return timed("NetworkGraph.update", async () => {
    const networkId = state.networkId;
    logger.verbose("Update network", { userId: state.userId, networkId, updateInput: state.updateInput });

    if (!networkId) {
      return { mutationResult: { success: false, error: "networkId is required for update." } };
    }

    try {
      const isOwner = await deps.database.isNetworkOwner(networkId, state.userId);
      if (!isOwner) {
        return { mutationResult: { success: false, error: "You can only modify networks you own." } };
      }

      await deps.database.updateNetworkSettings(networkId, state.userId, state.updateInput ?? {});

      return {
        mutationResult: {
          success: true,
          networkId,
          message: "Network settings updated.",
        },
      };
    } catch (err) {
      logger.error("Update network failed", { error: err });
      return { mutationResult: { success: false, error: "Failed to update network." } };
    }
  });
}

/**
 * Delete Node: Soft-delete a network (owner only, sole member).
 */
export async function deleteNode(state: NetworkState, deps: NetworkGraphDeps) {
  return timed("NetworkGraph.delete", async () => {
    const networkId = state.networkId;
    logger.verbose("Delete network", { userId: state.userId, networkId });

    if (!networkId) {
      return { mutationResult: { success: false, error: "networkId is required for delete." } };
    }

    try {
      const isOwner = await deps.database.isNetworkOwner(networkId, state.userId);
      if (!isOwner) {
        return { mutationResult: { success: false, error: "You can only delete networks you own." } };
      }

      const count = await deps.database.getNetworkMemberCount(networkId);
      if (count > 1) {
        return { mutationResult: { success: false, error: "Cannot delete network with other members. Remove members first." } };
      }

      await deps.database.softDeleteNetwork(networkId);

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
}

export function routeByMode(state: NetworkState): string {
  switch (state.operationMode) {
    case 'create': return 'create';
    case 'read': return 'read';
    case 'update': return 'update';
    case 'delete': return 'delete_idx';
    default: return 'read';
  }
}
