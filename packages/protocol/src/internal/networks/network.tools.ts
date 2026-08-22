import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";
import { log } from "../shared/observability/log.js";
import { renderNetworkContext } from "../shared/network/metadata.renderer.js";

import type { DefineTool, ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { focusedNetworkId } from "../shared/agent/tool.scope.js";
import { NetworkRecommender } from "./network.recommender.js";

/** Host capabilities consumed by community discovery and membership tools. */
export type NetworkToolDeps = Pick<ToolRegistryCompositionDeps,
  "userDb" | "systemDb" | "getUserContextText" | "networkRanker" | "reportToolError"
> & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "index" | "networkMembership"> };

/**
 * Resolves the community this caller is hard-bound to, if any.
 *
 * A user-driven network-scoped chat carries `context.networkId`; a network-scoped
 * agent (personal/external API key bound to one community over MCP) instead
 * carries the focused scope envelope (`scopeType='network'`, `scopeId`) applied
 * at the MCP boundary, with `networkId` left unset. Both must clamp community
 * and roster reads/writes to the exact bound community BEFORE any graph/adapter
 * work — not only via the scoped-deps data clamp — so a foreign community is
 * denied with a stable message and never read or mutated (IND-591).
 */
function boundCommunityId(context: {
  networkId?: string;
  scopeType?: 'network' | 'intent';
  scopeId?: string;
}): string | undefined {
  return focusedNetworkId(context) ?? context.networkId;
}

// Lazy singleton — only instantiated on first onboarding ranking call so that
// importing this module does not require OPENROUTER_API_KEY at load time.
let recommender: NetworkRecommender | undefined;

const logger = log.protocol.from("ChatTools:Network");

/**
 * Creates all community (network) lifecycle and membership tools.
 *
 * ## Exposed tools
 *
 * Foreground (participant-directed):
 * - `read_networks` — list joined networks, owned networks, and public networks.
 * - `read_network_memberships` — query membership: list members, check membership, or
 *   list the user's memberships.
 * - `create_network` — create a new network; caller becomes owner.
 * - `update_network` — update settings (title, prompt, imageUrl, joinPolicy); owner-only.
 * - `delete_network` — soft-delete (owner-only; network must have no other members).
 * - `create_network_membership` — add a member (self-join or owner-invite).
 * - `delete_network_membership` — remove a member (owner-only).
 *
 * Automatic assignment of intents to networks is handled by IntentNetworkGraphFactory
 * (ambient) — these foreground tools only manage network and membership lifecycle.
 *
 * ## Scope enforcement
 *
 * In network-scoped chats, all tools validate that the requested networkId matches
 * the scoped network.  Cross-scope mutations are rejected with a clear error.
 *
 * ## Onboarding ranking
 *
 * `read_networks` includes an onboarding-only `orderedNetworkIds` list when
 * `context.isOnboarding` is true and public networks are available.  Ranking is
 * performed by `NetworkRecommender` (ambient LLM agent) or a `deps.networkRanker`
 * override, with graceful degradation if ranking fails.
 */
export function createNetworkTools(defineTool: DefineTool, deps: NetworkToolDeps) {
  const { graphs, userDb, systemDb } = deps;

  const enrichWithContext = (networks: Array<Record<string, unknown>>) =>
    networks.map((n) => ({
      ...n,
      renderedContext: renderNetworkContext({
        title: (n.title as string) ?? '',
        prompt: n.prompt as string | undefined,
      }),
    }));

  const readIndexes = defineTool({
    name: "read_networks",
    description:
      "Lists the authenticated user's networks (communities), including ones they own and public communities they can join.\n\n" +
      "**When to use:** To find network IDs for scoping other operations (read_intents, list_opportunities, read_network_memberships), " +
      "or to show the user which communities they belong to.\n\n" +
      "**Returns:** Up to three lists — `memberOf` (networks the user joined), `owns` (networks the user created), and `publicNetworks` " +
      "**Note:** In network-scoped chats, only the scoped network is returned. During onboarding, `orderedNetworkIds` " +
      "may be returned alongside `publicNetworks` \u2014 a ranked array of network IDs ordered by relevance to the user's profile (omitted when ranking is unavailable or fails).",
    querySchema: z.object({
      userId: z.string().optional().describe("Must be the current user's ID or omitted. Cannot list another user's networks."),
    }),
    handler: async ({ context, query }) => {
      if (query.userId && query.userId.trim() !== context.userId) {
        return error("You can only list your own networks. Omit userId to see the current user's networks.");
      }

      const boundNetworkId = boundCommunityId(context);
      const _readGraphStart = Date.now();
      const _readTraceEmitter = requestContext.getStore()?.traceEmitter;
      _readTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        networkId: boundNetworkId || undefined,
        operationMode: 'read' as const,
        showAll: false, // Never allow bypass — strict scope enforcement
      });
      const _readGraphMs = Date.now() - _readGraphStart;
      _readTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _readGraphMs });

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        const rr = result.readResult as Record<string, unknown>;
        const enriched = {
          ...rr,
          ...(Array.isArray(rr.memberOf) ? { memberOf: enrichWithContext(rr.memberOf as Array<Record<string, unknown>>) } : {}),
          ...(Array.isArray(rr.owns) ? { owns: enrichWithContext(rr.owns as Array<Record<string, unknown>>) } : {}),
          ...(Array.isArray(rr.publicNetworks) ? { publicNetworks: enrichWithContext(rr.publicNetworks as Array<Record<string, unknown>>) } : {}),
        };

        // When scoped, add clear metadata so model knows results are limited
        if (boundNetworkId) {
          return success({
            ...enriched,
            scopeRestriction: {
              isScoped: true,
              scopedToNetwork: context.indexName ?? boundNetworkId,
              message: `Results are limited to "${context.indexName ?? 'this network'}" because this chat is scoped to that community. The user may belong to other communities not shown here.`,
            },
            _graphTimings: [{ name: 'index', durationMs: _readGraphMs, agents: result.agentTimings ?? [] }],
          });
        }

        // Onboarding-only: rank public networks by relevance to the user's global
        // user_context paragraph.  Guard: only when isOnboarding, not scoped, there
        // are public networks to rank, and a user_context is available.
        let orderedNetworkIds: string[] | undefined;
        const userContext = deps.getUserContextText ? await deps.getUserContextText(context.userId) : "";
        if (
          context.isOnboarding &&
          userContext &&
          Array.isArray(enriched.publicNetworks) &&
          (enriched.publicNetworks as Array<Record<string, unknown>>).length > 0
        ) {
          // Cap at 50 to bound LLM context window usage.
          const publicNetworksForRanking = (enriched.publicNetworks as Array<Record<string, unknown>>)
            .slice(0, 50)
            .map((n) => ({
              networkId: n.networkId as string,
              renderedContext: (n.renderedContext as string) ?? `## ${n.title as string}`,
            }));
          const rankFn = deps.networkRanker ?? (async (input) => {
            try {
              recommender ??= new NetworkRecommender();
              return await recommender.invoke(input);
            } catch (err) {
              logger.warn("read_networks: NetworkRecommender unavailable, skipping ranking", { error: err });
              return null;
            }
          });
          const rankingResult = await rankFn({
            userContext,
            networks: publicNetworksForRanking,
          }).catch((err: unknown) => {
            logger.warn("read_networks: networkRanker threw, skipping ranking", { error: err });
            deps.reportToolError?.(err, { operation: "network-ranking", toolName: "read_networks", userId: context.userId });
            return null;
          });
          if (rankingResult) {
            // Normalize LLM output against the ranked slice (top 50): keep only IDs
            // from the input set, de-dupe preserving order, then append any omitted IDs.
            const inputIds = publicNetworksForRanking.map((n) => n.networkId);
            const inputIdSet = new Set(inputIds);
            const seen = new Set<string>();
            const normalized: string[] = [];
            for (const id of rankingResult.rankedNetworkIds) {
              if (inputIdSet.has(id) && !seen.has(id)) {
                normalized.push(id);
                seen.add(id);
              }
            }
            for (const id of inputIds) {
              if (!seen.has(id)) normalized.push(id);
            }
            orderedNetworkIds = normalized;
          }
        }

        return success({
          ...enriched,
          ...(orderedNetworkIds !== undefined ? { orderedNetworkIds } : {}),
          _graphTimings: [{ name: 'index', durationMs: _readGraphMs, agents: result.agentTimings ?? [] }],
        });
      }
      return error("Failed to fetch network information.");
    },
  });

  const readIndexMemberships = defineTool({
    name: "read_network_memberships",
    description:
      "Reads network membership information — who is in which community. Essential for understanding the social graph before " +
      "creating introductions or exploring intents.\n\n" +
      "**Usage modes:**\n" +
      "- With `networkId` only: lists ALL members of that network — returns userId, name, avatar, permissions (owner/member), intentCount, and joinedAt. " +
      "Use this to see who's in a community before browsing their intents or creating introductions.\n" +
      "- With `userId` only (or omit for self): lists all networks that user belongs to — returns networkId, networkTitle, permissions, joinedAt.\n" +
      "- With both `networkId` and `userId`: checks whether that specific user is a member of that specific network (returns isMember boolean).\n\n" +
      "**When to use:** Before creating introductions (need to verify shared network membership), to explore community members, " +
      "or to check if a user belongs to a specific network.\n\n" +
      "**Returns:** Member list with user details, or membership list with network details, or a membership check result.\n\n" +
      "**Shared-context pattern.** To find overlap with another user: (1) omit `userId` to read your own " +
      "memberships, (2) call this tool with the other person's actual `userId` to get the shared networks, " +
      "(3) call read_intents for each shared network to see what each is looking for there, (4) call " +
      "read_user_contexts for the other party. That sequence gives you enough to decide whether to propose a " +
      "direct connection or an introduction.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Network UUID — lists all members of this network. Get from read_networks. In network-scoped chats, only the scoped network can be queried."),
      userId: z.string().optional().describe("User ID — lists that user's network memberships. Omit to get the current user's memberships. When combined with networkId, checks if this user is in that specific network."),
    }),
    handler: async ({ context, query }) => {
      const networkId = query.networkId?.trim() || undefined;
      const userId = query.userId?.trim() || undefined;
      const boundNetworkId = boundCommunityId(context);

      if (networkId && !UUID_REGEX.test(networkId)) {
        return error("Invalid network ID format. Use the exact UUID from read_networks.");
      }

      // Mode 1: list members of a network
      if (networkId && !userId) {
        // Enforce strict scope: when chat is network-scoped, only allow querying that network
        if (boundNetworkId && networkId !== boundNetworkId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this network'}. You can only query members of this network.`
          );
        }

        const _readMembersStart = Date.now();
        const _readMembersTraceEmitter = requestContext.getStore()?.traceEmitter;
        _readMembersTraceEmitter?.({ type: "graph_start", name: "network_membership" });
        const result = await graphs.networkMembership.invoke({
          userId: context.userId,
          networkId,
          operationMode: 'read' as const,
        });
        const _readMembersMs = Date.now() - _readMembersStart;
        _readMembersTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _readMembersMs });

        if (result.error) {
          return error(result.error);
        }
        if (result.readResult) {
          return success({ ...result.readResult, _graphTimings: [{ name: 'network_membership', durationMs: _readMembersMs, agents: result.agentTimings ?? [] }] });
        }
        return error("Failed to fetch network members.");
      }

      // Mode 2: list a user's memberships (networks they belong to)
      const targetUserId = userId || context.userId;

      let memberships: Awaited<ReturnType<typeof userDb.getNetworkMemberships>>;
      if (targetUserId !== context.userId) {
        // Cross-user access: validate shared membership scope
        const callerMemberships = await userDb.getNetworkMemberships();
        if (networkId) {
          if (boundNetworkId && networkId !== boundNetworkId) {
            return error(
              `This chat is scoped to ${context.indexName ?? 'this network'}. You can only query membership in this community.`
            );
          }

          const callerInNetwork = callerMemberships.some((m) => m.networkId === networkId);
          if (!callerInNetwork) {
            return error(
              "Unauthorized: you can only view another user's membership in a network you belong to. Provide your own userId or omit userId for your memberships.",
            );
          }
          const isMember = await systemDb.isNetworkMember(networkId, targetUserId);
          if (isMember) {
            return success({ isMember: true, userId: targetUserId, networkId });
          }
          return success({ isMember: false, userId: targetUserId, networkId, message: "User is not a member of this network." });
        } else {
          // Strict scope enforcement: when chat is network-scoped, only check the scoped network
          if (boundNetworkId) {
            const isMember = await systemDb.isNetworkMember(boundNetworkId, targetUserId);
            if (isMember) {
              return success({
                isMember: true,
                userId: targetUserId,
                networkId: boundNetworkId,
                scopeRestriction: {
                  isScoped: true,
                  scopedToNetwork: context.indexName ?? boundNetworkId,
                  message: `This chat is scoped to "${context.indexName ?? 'this network'}". Only membership in this community is shown.`,
                },
              });
            }
            return success({
              isMember: false,
              userId: targetUserId,
              networkId: boundNetworkId,
              message: "User is not a member of this community.",
              scopeRestriction: {
                isScoped: true,
                scopedToNetwork: context.indexName ?? boundNetworkId,
                message: `This chat is scoped to "${context.indexName ?? 'this network'}". Only membership in this community was checked.`,
              },
            });
          }

          // Unscoped chat: show overlap with shared networks (effective-scope intersection)
          const sharedNetworks: typeof callerMemberships = [];
          for (const m of callerMemberships) {
            if (await systemDb.isNetworkMember(m.networkId, targetUserId)) {
              sharedNetworks.push(m);
            }
          }
          if (sharedNetworks.length === 0) {
            return error(
              "Unauthorized: you can only view another user's memberships if you share at least one network, or request your own memberships.",
            );
          }
          return success({
            userId: targetUserId,
            count: sharedNetworks.length,
            memberships: sharedNetworks.map((m) => ({
              networkId: m.networkId,
              networkTitle: m.networkTitle,
            })),
            note: "Only showing shared networks.",
          });
        }
      } else {
        // Own memberships — use userDb
        memberships = await userDb.getNetworkMemberships();

        // Strict scope: when chat is network-scoped, only return the scoped network membership
        if (boundNetworkId && !networkId) {
          memberships = memberships.filter((m) => m.networkId === boundNetworkId);
        }
      }

      // If both networkId and userId: filter to that specific membership
      if (networkId) {
        if (boundNetworkId && networkId !== boundNetworkId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this network'}. You can only query membership in this community.`
          );
        }

        const callerMemberships = await userDb.getNetworkMemberships();
        const callerInNetwork =
          targetUserId === context.userId ||
          callerMemberships.some((m) => m.networkId === networkId);
        if (!callerInNetwork) {
          return error(
            "Unauthorized: you can only view membership in a network you belong to.",
          );
        }
        const match = memberships.find((m) => m.networkId === networkId);
        if (!match) {
          return success({ isMember: false, userId: targetUserId, networkId, message: "User is not a member of this network." });
        }
        return success({
          isMember: true,
          userId: targetUserId,
          networkId,
          networkTitle: match.networkTitle,
          permissions: match.permissions,
          joinedAt: match.joinedAt,
        });
      }

      // Own memberships in scoped chat
      if (boundNetworkId && targetUserId === context.userId) {
        return success({
          userId: targetUserId,
          count: memberships.length,
          memberships: memberships.map((m) => ({
            networkId: m.networkId,
            networkTitle: m.networkTitle,
            permissions: m.permissions,
            joinedAt: m.joinedAt,
          })),
          scopeRestriction: {
            isScoped: true,
            scopedToNetwork: context.indexName ?? boundNetworkId,
            message: `Results are limited to "${context.indexName ?? 'this network'}" because this chat is scoped to that community. The user may belong to other communities not shown here.`,
          },
        });
      }

      return success({
        userId: targetUserId,
        count: memberships.length,
        memberships: memberships.map((m) => ({
          networkId: m.networkId,
          networkTitle: m.networkTitle,
          permissions: m.permissions,
          joinedAt: m.joinedAt,
        })),
      });
    },
  });

  const updateNetworkSettingsSchema = z.object({
    title: z.string().optional(),
    prompt: z.string().nullable().optional(),
    imageUrl: z.string().url().nullable().optional(),
    joinPolicy: z.enum(['anyone', 'invite_only']).optional(),
  }).strict();

  const updateNetwork = defineTool({
    name: "update_network",
    description:
      "Updates settings of an existing network (community). Only the network owner can perform updates.\n\n" +
      "**Updatable fields:** title (display name), prompt (purpose description used for intent auto-assignment), " +
      "imageUrl (community avatar), joinPolicy ('anyone' for open or 'invite_only').\n\n" +
      "**When to use:** When a network owner wants to change their community's settings — e.g. update the purpose description, " +
      "change from invite-only to open, or update the community image.\n\n" +
      "**Important:** Changing the prompt affects how future intents are evaluated for auto-assignment to this network. " +
      "Existing intent-network links are not re-evaluated automatically.\n\n" +
      "**Returns:** Confirmation with the list of settings that were updated.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Network UUID to update. Get from read_networks. Defaults to the scoped network in network-scoped chats."),
      settings: updateNetworkSettingsSchema.describe("Object with fields to update. All fields are optional — only include the ones to change. title: display name. prompt: purpose description (used for intent auto-assignment). imageUrl: community image URL (null to remove). joinPolicy: 'anyone' or 'invite_only'."),
    }),
    handler: async ({ context, query }) => {
      const boundNetworkId = boundCommunityId(context);
      const effectiveNetworkId = (query.networkId?.trim() || boundNetworkId) ?? null;
      if (!effectiveNetworkId || !UUID_REGEX.test(effectiveNetworkId)) {
        return error("Valid networkId required.");
      }

      if (boundNetworkId && effectiveNetworkId !== boundNetworkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this network'}. You can only update this community's settings.`
        );
      }

      const _updateStart = Date.now();
      const _updateTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        networkId: effectiveNetworkId,
        operationMode: 'update' as const,
        updateInput: query.settings,
      });
      const _updateMs = Date.now() - _updateStart;
      _updateTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _updateMs });

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to update network.");
      }
      return success({ message: "Network updated.", settings: Object.keys(query.settings), _graphTimings: [{ name: 'index', durationMs: _updateMs, agents: result.agentTimings ?? [] }] });
    },
  });

  const createNetwork = defineTool({
    name: "create_network",
    description:
      "Creates a new network (community/group). The authenticated user becomes the owner with full control over settings and membership.\n\n" +
      "**What is a network?** A shared space where members post intents (what they're looking for) and the system discovers opportunities " +
      "(complementary matches) between members. The network's prompt guides what kinds of intents belong.\n\n" +
      "**When to use:** When the user wants to create a new community — e.g. a professional network, interest group, or project team.\n\n" +
      "**Returns:** The new network's networkId (UUID) and title. Use the networkId to add members (create_network_membership), " +
      "link intents (create_intent_index). Approved signals are matched in the background; use list_opportunities only to review persisted opportunities.",
    querySchema: z.object({
      title: z.string().describe("Display name of the network (e.g. 'AI Founders Berlin', 'Design Co-op'). Required."),
      prompt: z.string().optional().describe("Description of what this community is about. Used by the system to evaluate which intents belong in this network. Highly recommended for better auto-assignment."),
      imageUrl: z.string().url().optional().describe("URL for the community's avatar/image. Optional."),
      joinPolicy: z.enum(['anyone', 'invite_only']).optional().describe("'anyone' = open (any user can self-join), 'invite_only' = only the owner can add members. Defaults to 'invite_only'."),
    }),
    handler: async ({ context, query }) => {
      if (!query.title?.trim()) {
        return error("Title is required.");
      }

      const _createStart = Date.now();
      const _createTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        operationMode: 'create' as const,
        createInput: {
          title: query.title.trim(),
          prompt: query.prompt?.trim() || undefined,
          imageUrl: query.imageUrl || undefined,
          joinPolicy: query.joinPolicy,
        },
      });
      const _createMs = Date.now() - _createStart;
      _createTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _createMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            created: true,
            networkId: result.mutationResult.networkId,
            title: result.mutationResult.title,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'index', durationMs: _createMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to create network.");
      }
      return error("Failed to create network.");
    },
  });

  const deleteNetwork = defineTool({
    name: "delete_network",
    description:
      "Permanently deletes a network (community). Only the owner can delete, and the network must have no other members " +
      "(remove all members first with delete_network_membership).\n\n" +
      "**When to use:** When the owner wants to disband a community. This is irreversible — all intent–network links to this network are removed.\n\n" +
      "**Prerequisites:** Must be the owner. Must be the sole remaining member (remove others first).\n\n" +
      "**Returns:** Confirmation that the network was deleted.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Network UUID to delete. Get from read_networks. Defaults to the scoped network in network-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const boundNetworkId = boundCommunityId(context);
      const networkId = query.networkId?.trim() || boundNetworkId;
      if (!networkId || !UUID_REGEX.test(networkId)) {
        return error("Valid networkId required.");
      }

      if (boundNetworkId && networkId !== boundNetworkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this network'}. You can only delete this community.`
        );
      }

      const _deleteStart = Date.now();
      const _deleteTraceEmitter = requestContext.getStore()?.traceEmitter;
      _deleteTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        networkId,
        operationMode: 'delete' as const,
      });
      const _deleteMs = Date.now() - _deleteStart;
      _deleteTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _deleteMs });

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to delete network.");
      }
      return success({ message: "Network deleted.", _graphTimings: [{ name: 'index', durationMs: _deleteMs, agents: result.agentTimings ?? [] }] });
    },
  });

  const createNetworkMembership = defineTool({
    name: "create_network_membership",
    description:
      "Adds a user as a member of a network (community). Membership enables the user to post intents in the network and be discovered " +
      "by other members through opportunity matching.\n\n" +
      "**Usage modes:**\n" +
      "- Omit userId: self-join (only works for networks with joinPolicy 'anyone').\n" +
      "- With userId: add another user (only the network owner can do this for 'invite_only' networks).\n\n" +
      "**When to use:** When the user wants to join an open community, or when a network owner wants to invite someone.\n\n" +
      "**Returns:** Confirmation that the member was added (or a note that they were already a member). " +
      "After joining, the user's existing intents with autoAssign=true may be evaluated against the new network.",
    querySchema: z.object({
      userId: z.string().optional().describe("User ID to add as a member. Omit to join the network yourself. Get user IDs from read_user_contexts(query=name) or read_network_memberships."),
      networkId: z.string().optional().describe("Network UUID to add the member to. Get from read_networks. Defaults to the scoped network in network-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const boundNetworkId = boundCommunityId(context);
      const networkId = query.networkId?.trim() || boundNetworkId;
      const targetUserId = query.userId?.trim() || context.userId;
      if (!networkId || !UUID_REGEX.test(networkId)) {
        return error("Invalid network ID format. Use the exact UUID from read_networks.");
      }

      if (boundNetworkId && networkId !== boundNetworkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this network'}. You can only add members to this community.`
        );
      }

      const _createMemberStart = Date.now();
      const _createMemberTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createMemberTraceEmitter?.({ type: "graph_start", name: "network_membership" });
      const result = await graphs.networkMembership.invoke({
        userId: context.userId,
        networkId,
        targetUserId,
        operationMode: 'create' as const,
      });
      const _createMemberMs = Date.now() - _createMemberStart;
      _createMemberTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _createMemberMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          const alreadyMember = result.mutationResult.message?.includes("already");
          return success({
            created: !alreadyMember,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'network_membership', durationMs: _createMemberMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to add member.");
      }
      return error("Failed to add member.");
    },
  });

  const deleteNetworkMembership = defineTool({
    name: "delete_network_membership",
    description:
      "Removes a user from a network (community). After removal, the user's intents are unlinked from this network " +
      "and their approved signals are no longer eligible for background matching within it.\n\n" +
      "**Permissions:** Only the network owner can remove members. The owner themselves cannot be removed (delete the network instead).\n\n" +
      "**When to use:** When a network owner wants to remove a member from the community. " +
      "Use read_network_memberships(networkId) first to get the userId of the member to remove.\n\n" +
      "**Returns:** Confirmation that the member was removed.",
    querySchema: z.object({
      userId: z.string().describe("User ID of the member to remove. Get from read_network_memberships(networkId). Cannot be the network owner."),
      networkId: z.string().optional().describe("Network UUID to remove the member from. Get from read_networks. Defaults to the scoped network in network-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const boundNetworkId = boundCommunityId(context);
      const networkId = query.networkId?.trim() || boundNetworkId;
      const targetUserId = query.userId?.trim();

      if (!networkId || !UUID_REGEX.test(networkId)) {
        return error("Valid networkId required. Use the exact UUID from read_networks.");
      }
      if (!targetUserId) {
        return error("userId is required.");
      }

      if (boundNetworkId && networkId !== boundNetworkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this network'}. You can only manage members of this community.`
        );
      }

      const _deleteMemberStart = Date.now();
      const _deleteMemberTraceEmitter = requestContext.getStore()?.traceEmitter;
      _deleteMemberTraceEmitter?.({ type: "graph_start", name: "network_membership" });
      const result = await graphs.networkMembership.invoke({
        userId: context.userId,
        networkId,
        targetUserId,
        operationMode: 'delete' as const,
      });
      const _deleteMemberMs = Date.now() - _deleteMemberStart;
      _deleteMemberTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _deleteMemberMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            removed: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'network_membership', durationMs: _deleteMemberMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to remove member.");
      }
      return error("Failed to remove member.");
    },
  });

  return [readIndexes, readIndexMemberships, updateNetwork, createNetwork, deleteNetwork, createNetworkMembership, deleteNetworkMembership] as const;
}
