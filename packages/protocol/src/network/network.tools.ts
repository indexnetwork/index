import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";

export function createNetworkTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs, userDb, systemDb } = deps;

  const readIndexes = defineTool({
    name: "read_networks",
    description:
      "Lists the authenticated user's networks (communities), including ones they own and public communities they can join.\n\n" +
      "**When to use:** To find network IDs for scoping other operations (read_intents, create_opportunities, read_network_memberships), " +
      "or to show the user which communities they belong to.\n\n" +
      "**Returns:** Up to three lists — `memberOf` (networks the user joined), `owns` (networks the user created), and `publicNetworks` " +
      "(publicly joinable communities the user is not yet a member of). Entries in `memberOf` include `isPersonal` set to `true` for the user's " +
      "personal network.\n\n" +
      "**Note:** In index-scoped chats, only the scoped network is returned.",
    querySchema: z.object({
      userId: z.string().optional().describe("Must be the current user's ID or omitted. Cannot list another user's indexes."),
    }),
    handler: async ({ context, query }) => {
      if (query.userId && query.userId.trim() !== context.userId) {
        return error("You can only list your own indexes. Omit userId to see the current user's indexes.");
      }

      const _readIndexGraphStart = Date.now();
      const _readIndexTraceEmitter = requestContext.getStore()?.traceEmitter;
      _readIndexTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        networkId: context.networkId || undefined,
        operationMode: 'read' as const,
        showAll: false, // Never allow bypass - strict scope enforcement
      });
      const _readIndexGraphMs = Date.now() - _readIndexGraphStart;
      _readIndexTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _readIndexGraphMs });

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        // When scoped, add clear metadata so model knows results are limited
        if (context.networkId) {
          return success({
            ...result.readResult,
            scopeRestriction: {
              isScoped: true,
              scopedToIndex: context.indexName ?? context.networkId,
              message: `Results are limited to "${context.indexName ?? 'this index'}" because this chat is scoped to that community. The user may belong to other communities not shown here.`,
            },
            _graphTimings: [{ name: 'index', durationMs: _readIndexGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return success({ ...result.readResult, _graphTimings: [{ name: 'index', durationMs: _readIndexGraphMs, agents: result.agentTimings ?? [] }] });
      }
      return error("Failed to fetch index information.");
    },
  });

  const readIndexMemberships = defineTool({
    name: "read_network_memberships",
    description:
      "Reads index membership information — who is in which community. Essential for understanding the social graph before " +
      "creating introductions or exploring intents.\n\n" +
      "**Usage modes:**\n" +
      "- With `networkId` only: lists ALL members of that index — returns userId, name, avatar, permissions (owner/member), intentCount, and joinedAt. " +
      "Use this to see who's in a community before browsing their intents or creating introductions.\n" +
      "- With `userId` only (or omit for self): lists all indexes that user belongs to — returns networkId, networkTitle, permissions, joinedAt.\n" +
      "- With both `networkId` and `userId`: checks whether that specific user is a member of that specific index (returns isMember boolean).\n\n" +
      "**When to use:** Before creating introductions (need to verify shared index membership), to explore community members, " +
      "or to check if a user belongs to a specific index.\n\n" +
      "**Returns:** Member list with user details, or membership list with index details, or a membership check result.\n\n" +
      "**Personal index semantics.** The personal index (`isPersonal: true` on the membership) is the user's " +
      "contact list — members of that index are the user's contacts. For another user, this tool only reveals the " +
      "indexes you already share with them.\n\n" +
      "**Shared-context pattern.** To find overlap with another user: (1) omit `userId` to read your own " +
      "memberships, (2) call this tool with the other person's actual `userId` to get the shared indexes, " +
      "(3) call read_intents for each shared network to see what each is looking for there, (4) call " +
      "read_user_profiles for the other party. That sequence gives you enough to decide whether to propose a " +
      "direct connection or an introduction.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Index UUID — lists all members of this index. Get from read_networks. In index-scoped chats, only the scoped index can be queried."),
      userId: z.string().optional().describe("User ID — lists that user's index memberships. Omit to get the current user's memberships. When combined with networkId, checks if this user is in that specific index."),
    }),
    handler: async ({ context, query }) => {
      const networkId = query.networkId?.trim() || undefined;
      const userId = query.userId?.trim() || undefined;

      if (networkId && !UUID_REGEX.test(networkId)) {
        return error("Invalid index ID format. Use the exact UUID from read_networks.");
      }

      // Mode 1: list members of an index
      if (networkId && !userId) {
        // Enforce strict scope: when chat is index-scoped, only allow querying that index
        if (context.networkId && networkId !== context.networkId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only query members of this index.`
          );
        }

        const _readMembersGraphStart = Date.now();
        const _readMembersTraceEmitter = requestContext.getStore()?.traceEmitter;
        _readMembersTraceEmitter?.({ type: "graph_start", name: "network_membership" });
        const result = await graphs.networkMembership.invoke({
          userId: context.userId,
          networkId,
          operationMode: 'read' as const,
        });
        const _readMembersGraphMs = Date.now() - _readMembersGraphStart;
        _readMembersTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _readMembersGraphMs });

        if (result.error) {
          return error(result.error);
        }
        if (result.readResult) {
          return success({ ...result.readResult, _graphTimings: [{ name: 'network_membership', durationMs: _readMembersGraphMs, agents: result.agentTimings ?? [] }] });
        }
        return error("Failed to fetch index members.");
      }

      // Mode 2: list a user's memberships (indexes they belong to)
      const targetUserId = userId || context.userId;

      // Use userDb for own memberships, but systemDb access is implicit through shared index scope
      let memberships: Awaited<ReturnType<typeof userDb.getNetworkMemberships>>;
      if (targetUserId !== context.userId) {
        // Cross-user access: systemDb will validate shared index membership
        const callerMemberships = await userDb.getNetworkMemberships();
        if (networkId) {
          // Strict scope enforcement: when chat is index-scoped, only allow querying that index
          if (context.networkId && networkId !== context.networkId) {
            return error(
              `This chat is scoped to ${context.indexName ?? 'this index'}. You can only query membership in this community.`
            );
          }

          const callerInIndex = callerMemberships.some((m) => m.networkId === networkId);
          if (!callerInIndex) {
            return error(
              "Unauthorized: you can only view another user's membership in an index you belong to. Provide your own userId or omit userId for your memberships.",
            );
          }
          // Check if target user is in the index (systemDb validates scope)
          const isMember = await systemDb.isNetworkMember(networkId, targetUserId);
          if (isMember) {
            return success({ isMember: true, userId: targetUserId, networkId });
          }
          return success({ isMember: false, userId: targetUserId, networkId, message: "User is not a member of this index." });
        } else {
          // Strict scope enforcement: when chat is index-scoped, only check the scoped index
          if (context.networkId) {
            const isMember = await systemDb.isNetworkMember(context.networkId, targetUserId);
            if (isMember) {
              return success({
                isMember: true,
                userId: targetUserId,
                networkId: context.networkId,
                scopeRestriction: {
                  isScoped: true,
                  scopedToIndex: context.indexName ?? context.networkId,
                  message: `This chat is scoped to "${context.indexName ?? 'this index'}". Only membership in this community is shown.`,
                },
              });
            }
            return success({
              isMember: false,
              userId: targetUserId,
              networkId: context.networkId,
              message: "User is not a member of this community.",
              scopeRestriction: {
                isScoped: true,
                scopedToIndex: context.indexName ?? context.networkId,
                message: `This chat is scoped to "${context.indexName ?? 'this index'}". Only membership in this community was checked.`,
              },
            });
          }

          // Unscoped chat: show overlap with shared indexes (intersection of caller and target memberships)
          const sharedIndexes: typeof callerMemberships = [];
          for (const m of callerMemberships) {
            if (await systemDb.isNetworkMember(m.networkId, targetUserId)) {
              sharedIndexes.push(m);
            }
          }
          if (sharedIndexes.length === 0) {
            return error(
              "Unauthorized: you can only view another user's memberships if you share at least one index, or request your own memberships.",
            );
          }
          // Return only the indexes that are shared
          return success({
            userId: targetUserId,
            count: sharedIndexes.length,
            memberships: sharedIndexes.map((m) => ({
              networkId: m.networkId,
              networkTitle: m.networkTitle,
            })),
            note: "Only showing shared indexes.",
          });
        }
      } else {
        // Own memberships - use userDb
        memberships = await userDb.getNetworkMemberships();

        // Strict scope enforcement: when chat is index-scoped, only return the scoped index membership
        if (context.networkId && !networkId) {
          memberships = memberships.filter((m) => m.networkId === context.networkId);
        }
      }

      // If both networkId and userId: filter to that specific membership
      if (networkId) {
        // Strict scope enforcement: when chat is index-scoped, only allow querying that index
        if (context.networkId && networkId !== context.networkId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only query membership in this community.`
          );
        }

        const callerMemberships = await userDb.getNetworkMemberships();
        const callerInIndex =
          targetUserId === context.userId ||
          callerMemberships.some((m) => m.networkId === networkId);
        if (!callerInIndex) {
          return error(
            "Unauthorized: you can only view membership in an index you belong to.",
          );
        }
        const match = memberships.find((m) => m.networkId === networkId);
        if (!match) {
          return success({ isMember: false, userId: targetUserId, networkId, message: "User is not a member of this index." });
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

      // When scoped, add clear metadata so model knows results are limited
      if (context.networkId && targetUserId === context.userId) {
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
            scopedToIndex: context.indexName ?? context.networkId,
            message: `Results are limited to "${context.indexName ?? 'this index'}" because this chat is scoped to that community. The user may belong to other communities not shown here.`,
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
    allowGuestVibeCheck: z.boolean().optional(),
  }).strict();

  const updateNetwork = defineTool({
    name: "update_network",
    description:
      "Updates settings of an existing index (community). Only the index owner can perform updates.\n\n" +
      "**Updatable fields:** title (display name), prompt (purpose description used for intent auto-assignment), " +
      "imageUrl (community avatar), joinPolicy ('anyone' for open or 'invite_only'), allowGuestVibeCheck (allow non-members to preview).\n\n" +
      "**When to use:** When an index owner wants to change their community's settings — e.g. update the purpose description, " +
      "change from invite-only to open, or update the community image.\n\n" +
      "**Important:** Changing the prompt affects how future intents are evaluated for auto-assignment to this index. " +
      "Existing intent-index links are not re-evaluated automatically.\n\n" +
      "**Returns:** Confirmation with the list of settings that were updated.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Index UUID to update. Get from read_networks. Defaults to the scoped index in index-scoped chats."),
      settings: updateNetworkSettingsSchema.describe("Object with fields to update. All fields are optional — only include the ones to change. title: display name. prompt: purpose description (used for intent auto-assignment). imageUrl: community image URL (null to remove). joinPolicy: 'anyone' or 'invite_only'. allowGuestVibeCheck: boolean."),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = (query.networkId?.trim() || context.networkId) ?? null;
      if (!effectiveIndexId || !UUID_REGEX.test(effectiveIndexId)) {
        return error("Valid networkId required.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow updating that index
      if (context.networkId && effectiveIndexId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only update this community's settings.`
        );
      }

      const _updateNetworkGraphStart = Date.now();
      const _updateNetworkTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateNetworkTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        networkId: effectiveIndexId,
        operationMode: 'update' as const,
        updateInput: query.settings,
      });
      const _updateNetworkGraphMs = Date.now() - _updateNetworkGraphStart;
      _updateNetworkTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _updateNetworkGraphMs });

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to update index.");
      }
      return success({ message: "Index updated.", settings: Object.keys(query.settings), _graphTimings: [{ name: 'index', durationMs: _updateNetworkGraphMs, agents: result.agentTimings ?? [] }] });
    },
  });

  const createNetwork = defineTool({
    name: "create_network",
    description:
      "Creates a new index (community/group). The authenticated user becomes the owner with full control over settings and membership.\n\n" +
      "**What is an index?** A shared space where members post intents (what they're looking for) and the system discovers opportunities " +
      "(complementary matches) between members. The index's prompt guides what kinds of intents belong.\n\n" +
      "**When to use:** When the user wants to create a new community — e.g. a professional network, interest group, or project team.\n\n" +
      "**Returns:** The new index's networkId (UUID) and title. Use the networkId to add members (create_network_membership), " +
      "link intents (create_intent_network), or run discovery (create_opportunities with networkId).",
    querySchema: z.object({
      title: z.string().describe("Display name of the index (e.g. 'AI Founders Berlin', 'Design Co-op'). Required."),
      prompt: z.string().optional().describe("Description of what this community is about (e.g. 'Early-stage AI/ML founders in Berlin looking for co-founders, advisors, and investors'). Used by the system to evaluate which intents belong in this index. Highly recommended for better auto-assignment."),
      imageUrl: z.string().url().optional().describe("URL for the community's avatar/image. Optional."),
      joinPolicy: z.enum(['anyone', 'invite_only']).optional().describe("'anyone' = open (any user can self-join), 'invite_only' = only the owner can add members. Defaults to 'invite_only'."),
    }),
    handler: async ({ context, query }) => {
      if (!query.title?.trim()) {
        return error("Title is required.");
      }

      const _createNetworkGraphStart = Date.now();
      const _createNetworkTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createNetworkTraceEmitter?.({ type: "graph_start", name: "index" });
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
      const _createNetworkGraphMs = Date.now() - _createNetworkGraphStart;
      _createNetworkTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _createNetworkGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            created: true,
            networkId: result.mutationResult.networkId,
            title: result.mutationResult.title,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'index', durationMs: _createNetworkGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to create index.");
      }
      return error("Failed to create index.");
    },
  });

  const deleteNetwork = defineTool({
    name: "delete_network",
    description:
      "Permanently deletes an index (community). Only the owner can delete, and the index must have no other members " +
      "(remove all members first with delete_network_membership). Personal indexes cannot be deleted.\n\n" +
      "**When to use:** When the owner wants to disband a community. This is irreversible — all intent-index links to this index are removed.\n\n" +
      "**Prerequisites:** Must be the owner. Must be the sole remaining member (remove others first).\n\n" +
      "**Returns:** Confirmation that the index was deleted.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Index UUID to delete. Get from read_networks. Defaults to the scoped index in index-scoped chats. Cannot be a personal index."),
    }),
    handler: async ({ context, query }) => {
      const networkId = query.networkId?.trim() || context.networkId;
      if (!networkId || !UUID_REGEX.test(networkId)) {
        return error("Valid networkId required.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow deleting that index
      if (context.networkId && networkId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only delete this community.`
        );
      }

      const _deleteNetworkGraphStart = Date.now();
      const _deleteNetworkTraceEmitter = requestContext.getStore()?.traceEmitter;
      _deleteNetworkTraceEmitter?.({ type: "graph_start", name: "index" });
      const result = await graphs.index.invoke({
        userId: context.userId,
        networkId,
        operationMode: 'delete' as const,
      });
      const _deleteNetworkGraphMs = Date.now() - _deleteNetworkGraphStart;
      _deleteNetworkTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _deleteNetworkGraphMs });

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to delete index.");
      }
      return success({ message: "Network deleted.", _graphTimings: [{ name: 'index', durationMs: _deleteNetworkGraphMs, agents: result.agentTimings ?? [] }] });
    },
  });

  const createNetworkMembership = defineTool({
    name: "create_network_membership",
    description:
      "Adds a user as a member of an index (community). Membership enables the user to post intents in the index and be discovered " +
      "by other members through opportunity matching.\n\n" +
      "**Usage modes:**\n" +
      "- Omit userId: self-join (only works for indexes with joinPolicy 'anyone').\n" +
      "- With userId: add another user (only the index owner can do this for 'invite_only' indexes).\n\n" +
      "**When to use:** When the user wants to join an open community, or when an index owner wants to invite someone.\n\n" +
      "**Returns:** Confirmation that the member was added (or a note that they were already a member). " +
      "After joining, the user's existing intents with autoAssign=true may be evaluated against the new index.",
    querySchema: z.object({
      userId: z.string().optional().describe("User ID to add as a member. Omit to join the index yourself. Get user IDs from read_user_profiles(query=name) or read_network_memberships."),
      networkId: z.string().optional().describe("Index UUID to add the member to. Get from read_networks. Defaults to the scoped index in index-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const networkId = query.networkId?.trim() || context.networkId;
      const targetUserId = query.userId?.trim() || context.userId;
      if (!networkId || !UUID_REGEX.test(networkId)) {
        return error("Invalid index ID format. Use the exact UUID from read_networks.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow adding to that index
      if (context.networkId && networkId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only add members to this community.`
        );
      }

      const _createMembershipGraphStart = Date.now();
      const _createMembershipTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createMembershipTraceEmitter?.({ type: "graph_start", name: "network_membership" });
      const result = await graphs.networkMembership.invoke({
        userId: context.userId,
        networkId,
        targetUserId,
        operationMode: 'create' as const,
      });
      const _createMembershipGraphMs = Date.now() - _createMembershipGraphStart;
      _createMembershipTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _createMembershipGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          const alreadyMember = result.mutationResult.message?.includes("already");
          return success({
            created: !alreadyMember,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'network_membership', durationMs: _createMembershipGraphMs, agents: result.agentTimings ?? [] }],
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
      "Removes a user from an index (community). After removal, the user's intents are unlinked from this index " +
      "and they can no longer participate in opportunity discovery within it.\n\n" +
      "**Permissions:** Only the index owner can remove members. The owner themselves cannot be removed (delete the index instead).\n\n" +
      "**When to use:** When an index owner wants to remove a member from the community. " +
      "Use read_network_memberships(networkId) first to get the userId of the member to remove.\n\n" +
      "**Returns:** Confirmation that the member was removed.",
    querySchema: z.object({
      userId: z.string().describe("User ID of the member to remove. Get from read_network_memberships(networkId). Cannot be the index owner."),
      networkId: z.string().optional().describe("Index UUID to remove the member from. Get from read_networks. Defaults to the scoped index in index-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const networkId = query.networkId?.trim() || context.networkId;
      const targetUserId = query.userId?.trim();

      if (!networkId || !UUID_REGEX.test(networkId)) {
        return error("Valid networkId required. Use the exact UUID from read_networks.");
      }
      if (!targetUserId) {
        return error("userId is required.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (context.networkId && networkId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only manage members of this community.`
        );
      }

      const _deleteMembershipGraphStart = Date.now();
      const _deleteMembershipTraceEmitter = requestContext.getStore()?.traceEmitter;
      _deleteMembershipTraceEmitter?.({ type: "graph_start", name: "network_membership" });
      const result = await graphs.networkMembership.invoke({
        userId: context.userId,
        networkId,
        targetUserId,
        operationMode: 'delete' as const,
      });
      const _deleteMembershipGraphMs = Date.now() - _deleteMembershipGraphStart;
      _deleteMembershipTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _deleteMembershipGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            removed: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'network_membership', durationMs: _deleteMembershipGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to remove member.");
      }
      return error("Failed to remove member.");
    },
  });

  return [readIndexes, readIndexMemberships, updateNetwork, createNetwork, deleteNetwork, createNetworkMembership, deleteNetworkMembership] as const;
}
