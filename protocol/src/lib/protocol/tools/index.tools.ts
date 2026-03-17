import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";

export function createIndexTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs, userDb, systemDb } = deps;

  const readIndexes = defineTool({
    name: "read_indexes",
    description: "Lists indexes the user is a member of and indexes they own. Optional userId (omit for current user). When chat is index-scoped, returns only that index.",
    querySchema: z.object({
      userId: z.string().optional().describe("Omit for current user."),
    }),
    handler: async ({ context, query }) => {
      if (query.userId && query.userId.trim() !== context.userId) {
        return error("You can only list your own indexes. Omit userId to see the current user's indexes.");
      }

      const _readIndexGraphStart = Date.now();
      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId: context.indexId || undefined,
        operationMode: 'read' as const,
        showAll: false, // Never allow bypass - strict scope enforcement
      });
      const _readIndexGraphMs = Date.now() - _readIndexGraphStart;

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        // When scoped, add clear metadata so model knows results are limited
        if (context.indexId) {
          return success({
            ...result.readResult,
            _scopeRestriction: {
              isScoped: true,
              scopedToIndex: context.indexName ?? context.indexId,
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
    name: "read_index_memberships",
    description:
      "Reads index membership data. Two modes: (1) Pass indexId to list all members of that index (returns userId, name, avatar, permissions, intentCount, joinedAt). (2) Pass userId (or omit for current user) to list all indexes that user belongs to (returns indexId, indexTitle, permissions, joinedAt). Pass both to check whether a specific user is in a specific index. When chat is index-scoped, only that index can be queried.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID — when provided, lists members of this index."),
      userId: z.string().optional().describe("User ID — when provided, lists that user's index memberships. Omit to default to current user."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim() || undefined;
      const userId = query.userId?.trim() || undefined;

      if (indexId && !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      // Mode 1: list members of an index
      if (indexId && !userId) {
        // Enforce strict scope: when chat is index-scoped, only allow querying that index
        if (context.indexId && indexId !== context.indexId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only query members of this index.`
          );
        }

        const _readMembersGraphStart = Date.now();
        const result = await graphs.indexMembership.invoke({
          userId: context.userId,
          indexId,
          operationMode: 'read' as const,
        });
        const _readMembersGraphMs = Date.now() - _readMembersGraphStart;

        if (result.error) {
          return error(result.error);
        }
        if (result.readResult) {
          return success({ ...result.readResult, _graphTimings: [{ name: 'index_membership', durationMs: _readMembersGraphMs, agents: result.agentTimings ?? [] }] });
        }
        return error("Failed to fetch index members.");
      }

      // Mode 2: list a user's memberships (indexes they belong to)
      const targetUserId = userId || context.userId;

      // Use userDb for own memberships, but systemDb access is implicit through shared index scope
      let memberships: Awaited<ReturnType<typeof userDb.getIndexMemberships>>;
      if (targetUserId !== context.userId) {
        // Cross-user access: systemDb will validate shared index membership
        const callerMemberships = await userDb.getIndexMemberships();
        if (indexId) {
          // Strict scope enforcement: when chat is index-scoped, only allow querying that index
          if (context.indexId && indexId !== context.indexId) {
            return error(
              `This chat is scoped to ${context.indexName ?? 'this index'}. You can only query membership in this community.`
            );
          }

          const callerInIndex = callerMemberships.some((m) => m.indexId === indexId);
          if (!callerInIndex) {
            return error(
              "Unauthorized: you can only view another user's membership in an index you belong to. Provide your own userId or omit userId for your memberships.",
            );
          }
          // Check if target user is in the index (systemDb validates scope)
          const isMember = await systemDb.isIndexMember(indexId, targetUserId);
          if (isMember) {
            return success({ isMember: true, userId: targetUserId, indexId });
          }
          return success({ isMember: false, userId: targetUserId, indexId, message: "User is not a member of this index." });
        } else {
          // Strict scope enforcement: when chat is index-scoped, only check the scoped index
          if (context.indexId) {
            const isMember = await systemDb.isIndexMember(context.indexId, targetUserId);
            if (isMember) {
              return success({
                isMember: true,
                userId: targetUserId,
                indexId: context.indexId,
                _scopeRestriction: {
                  isScoped: true,
                  scopedToIndex: context.indexName ?? context.indexId,
                  message: `This chat is scoped to "${context.indexName ?? 'this index'}". Only membership in this community is shown.`,
                },
              });
            }
            return success({
              isMember: false,
              userId: targetUserId,
              indexId: context.indexId,
              message: "User is not a member of this community.",
              _scopeRestriction: {
                isScoped: true,
                scopedToIndex: context.indexName ?? context.indexId,
                message: `This chat is scoped to "${context.indexName ?? 'this index'}". Only membership in this community was checked.`,
              },
            });
          }

          // Unscoped chat: show overlap with shared indexes (intersection of caller and target memberships)
          const sharedIndexes: typeof callerMemberships = [];
          for (const m of callerMemberships) {
            if (await systemDb.isIndexMember(m.indexId, targetUserId)) {
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
              indexId: m.indexId,
              indexTitle: m.indexTitle,
            })),
            note: "Only showing shared indexes.",
          });
        }
      } else {
        // Own memberships - use userDb
        memberships = await userDb.getIndexMemberships();

        // Strict scope enforcement: when chat is index-scoped, only return the scoped index membership
        if (context.indexId && !indexId) {
          memberships = memberships.filter((m) => m.indexId === context.indexId);
        }
      }

      // If both indexId and userId: filter to that specific membership
      if (indexId) {
        // Strict scope enforcement: when chat is index-scoped, only allow querying that index
        if (context.indexId && indexId !== context.indexId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only query membership in this community.`
          );
        }

        const callerMemberships = await userDb.getIndexMemberships();
        const callerInIndex =
          targetUserId === context.userId ||
          callerMemberships.some((m) => m.indexId === indexId);
        if (!callerInIndex) {
          return error(
            "Unauthorized: you can only view membership in an index you belong to.",
          );
        }
        const match = memberships.find((m) => m.indexId === indexId);
        if (!match) {
          return success({ isMember: false, userId: targetUserId, indexId, message: "User is not a member of this index." });
        }
        return success({
          isMember: true,
          userId: targetUserId,
          indexId,
          indexTitle: match.indexTitle,
          permissions: match.permissions,
          joinedAt: match.joinedAt,
        });
      }

      // When scoped, add clear metadata so model knows results are limited
      if (context.indexId && targetUserId === context.userId) {
        return success({
          userId: targetUserId,
          count: memberships.length,
          memberships: memberships.map((m) => ({
            indexId: m.indexId,
            indexTitle: m.indexTitle,
            permissions: m.permissions,
            joinedAt: m.joinedAt,
          })),
          _scopeRestriction: {
            isScoped: true,
            scopedToIndex: context.indexName ?? context.indexId,
            message: `Results are limited to "${context.indexName ?? 'this index'}" because this chat is scoped to that community. The user may belong to other communities not shown here.`,
          },
        });
      }

      return success({
        userId: targetUserId,
        count: memberships.length,
        memberships: memberships.map((m) => ({
          indexId: m.indexId,
          indexTitle: m.indexTitle,
          permissions: m.permissions,
          joinedAt: m.joinedAt,
        })),
      });
    },
  });

  const updateIndexSettingsSchema = z.object({
    title: z.string().optional(),
    prompt: z.string().nullable().optional(),
    imageUrl: z.string().url().nullable().optional(),
    joinPolicy: z.enum(['anyone', 'invite_only']).optional(),
    allowGuestVibeCheck: z.boolean().optional(),
  }).strict();

  const updateIndex = defineTool({
    name: "update_index",
    description: "Updates an index (owner only). Pass indexId or omit when index-scoped.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID; defaults to current index when scoped."),
      settings: updateIndexSettingsSchema.describe("Fields to update: title?, prompt?, imageUrl?, joinPolicy?, allowGuestVibeCheck?"),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = (query.indexId?.trim() || context.indexId) ?? null;
      if (!effectiveIndexId || !UUID_REGEX.test(effectiveIndexId)) {
        return error("Valid indexId required.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow updating that index
      if (context.indexId && effectiveIndexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only update this community's settings.`
        );
      }

      const _updateIndexGraphStart = Date.now();
      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId: effectiveIndexId,
        operationMode: 'update' as const,
        updateInput: query.settings,
      });
      const _updateIndexGraphMs = Date.now() - _updateIndexGraphStart;

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to update index.");
      }
      return success({ message: "Index updated.", settings: Object.keys(query.settings), _graphTimings: [{ name: 'index', durationMs: _updateIndexGraphMs, agents: result.agentTimings ?? [] }] });
    },
  });

  const createIndex = defineTool({
    name: "create_index",
    description: "Creates a new index (community). You become the owner. Pass title; optional prompt, imageUrl, and joinPolicy ('anyone' | 'invite_only').",
    querySchema: z.object({
      title: z.string().describe("Display name of the index"),
      prompt: z.string().optional().describe("What the community is about"),
      imageUrl: z.string().url().optional().describe("URL of the index image (optional)"),
      joinPolicy: z.enum(['anyone', 'invite_only']).optional().describe("Who can join; default invite_only"),
    }),
    handler: async ({ context, query }) => {
      if (!query.title?.trim()) {
        return error("Title is required.");
      }

      const _createIndexGraphStart = Date.now();
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
      const _createIndexGraphMs = Date.now() - _createIndexGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            created: true,
            indexId: result.mutationResult.indexId,
            title: result.mutationResult.title,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'index', durationMs: _createIndexGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to create index.");
      }
      return error("Failed to create index.");
    },
  });

  const deleteIndex = defineTool({
    name: "delete_index",
    description: "Deletes an index (owner only, must be sole member). When chat is index-scoped, can only delete that index.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID from read_indexes. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim() || context.indexId;
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Valid indexId required.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow deleting that index
      if (context.indexId && indexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only delete this community.`
        );
      }

      const _deleteIndexGraphStart = Date.now();
      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId,
        operationMode: 'delete' as const,
      });
      const _deleteIndexGraphMs = Date.now() - _deleteIndexGraphStart;

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to delete index.");
      }
      return success({ message: "Index deleted.", _graphTimings: [{ name: 'index', durationMs: _deleteIndexGraphMs, agents: result.agentTimings ?? [] }] });
    },
  });

  const createIndexMembership = defineTool({
    name: "create_index_membership",
    description: "Adds a user as a member of an index. Omit userId to join the index yourself (self-join works only for public indexes with joinPolicy 'anyone'). For invite_only indexes only the owner can add members.",
    querySchema: z.object({
      userId: z.string().optional().describe("User ID to add as a member. Omit to join the index yourself."),
      indexId: z.string().optional().describe("Index UUID from read_indexes. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim() || context.indexId;
      const targetUserId = query.userId?.trim() || context.userId;
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow adding to that index
      if (context.indexId && indexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only add members to this community.`
        );
      }

      const _createMembershipGraphStart = Date.now();
      const result = await graphs.indexMembership.invoke({
        userId: context.userId,
        indexId,
        targetUserId,
        operationMode: 'create' as const,
      });
      const _createMembershipGraphMs = Date.now() - _createMembershipGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          const alreadyMember = result.mutationResult.message?.includes("already");
          return success({
            created: !alreadyMember,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'index_membership', durationMs: _createMembershipGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to add member.");
      }
      return error("Failed to add member.");
    },
  });

  const deleteIndexMembership = defineTool({
    name: "delete_index_membership",
    description: "Removes a user from an index. Only the index owner can remove members. Cannot remove the owner themselves.",
    querySchema: z.object({
      userId: z.string().describe("User ID to remove from the index"),
      indexId: z.string().optional().describe("Index UUID. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim() || context.indexId;
      const targetUserId = query.userId?.trim();

      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Valid indexId required. Use the exact UUID from read_indexes.");
      }
      if (!targetUserId) {
        return error("userId is required.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (context.indexId && indexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only manage members of this community.`
        );
      }

      const _deleteMembershipGraphStart = Date.now();
      const result = await graphs.indexMembership.invoke({
        userId: context.userId,
        indexId,
        targetUserId,
        operationMode: 'delete' as const,
      });
      const _deleteMembershipGraphMs = Date.now() - _deleteMembershipGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            removed: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'index_membership', durationMs: _deleteMembershipGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to remove member.");
      }
      return error("Failed to remove member.");
    },
  });

  return [readIndexes, readIndexMemberships, updateIndex, createIndex, deleteIndex, createIndexMembership, deleteIndexMembership] as const;
}
