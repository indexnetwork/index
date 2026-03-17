import { z } from "zod";

import type { ExecutionResult, VerifiedIntent } from "../states/intent.state";
import { protocolLogger } from "../support/protocol.logger";

import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";

const logger = protocolLogger("ChatTools:Intent");

/**
 * Sanitize JSON string for use inside a markdown code fence (```). Escapes backticks
 * so embedded ``` cannot close the fence prematurely.
 */
function sanitizeJsonForCodeFence(json: string): string {
  return json.replace(/`/g, "\\u0060");
}

/** When context is index-scoped, verifies the caller is still a member of that index. Returns error message or null. */
async function ensureScopedMembership(
  context: { indexId?: string; indexName?: string; userId: string },
  systemDb: ToolDeps['systemDb']
): Promise<string | null> {
  if (!context.indexId) return null;
  const isMember = await systemDb.isIndexMember(context.indexId, context.userId);
  if (!isMember) {
    return `This chat is scoped to ${context.indexName ?? 'this index'}. You are no longer a member of this community.`;
  }
  return null;
}

export function createIntentTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs } = deps;

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  const readIntents = defineTool({
    name: "read_intents",
    description:
      "Reads intents (what people are looking for). No indexId: returns the user's own active intents. With indexId: returns all intents in that index; add userId to filter to one user. To find other members' intents, use read_index_memberships first, then read_intents per index.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID — filters intents to this index. Defaults to current index when scoped."),
      userId: z.string().optional().describe("User ID — filters to this user's intents. Combined with indexId: that user's intents in that index."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100)."),
      page: z.number().int().min(1).optional().describe("Page number (1-based)."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      // Strict scope enforcement: when chat is index-scoped, only allow querying that index
      if (context.indexId && query.indexId?.trim() && query.indexId.trim() !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read intents from this community.`
        );
      }

      const effectiveIndexId = context.indexId || query.indexId?.trim() || undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format.");
      }

      const queryUserId = query.userId?.trim() || undefined;

      // When scoped, reading another user's intents is restricted to the scoped index
      if (context.indexId && queryUserId && queryUserId !== context.userId) {
        // Verify target user is a member of the scoped index
        const db = deps.systemDb;
        const isInScopedIndex = await db.isIndexMember(context.indexId, queryUserId);
        if (!isInScopedIndex) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read intents from members of this community.`
          );
        }
      }

      if (!effectiveIndexId && queryUserId && queryUserId !== context.userId) {
        return error("Cannot read another user's global intents. Use indexId to scope to a shared index.");
      }

      // Verify the caller is a member of the index they're querying (unscoped chat only - scoped is already validated)
      if (!context.indexId && effectiveIndexId) {
        const db = deps.systemDb;
        const callerIsMember = await db.isIndexMember(effectiveIndexId, context.userId);
        if (!callerIsMember) {
          return error(
            "You can only read intents from indexes you are a member of."
          );
        }
      }

      // When scoped, we should NOT return all user intents across indexes - only those in the scoped index
      const allUserIntents = !context.indexId && !effectiveIndexId && (!queryUserId || queryUserId === context.userId);

      const _readIntentGraphStart = Date.now();
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        indexId: effectiveIndexId,
        operationMode: 'read' as const,
        queryUserId,
        allUserIntents,
      });
      const _readIntentGraphMs = Date.now() - _readIntentGraphStart;

      if (result.readResult) {
        if (result.readResult.count === 0 && result.readResult.message && /not a member|Index not found/i.test(result.readResult.message)) {
          return error(result.readResult.message);
        }

        const shouldPaginate = query.limit !== undefined || query.page !== undefined;
        if (shouldPaginate && Array.isArray(result.readResult.intents)) {
          const limit = query.limit ?? 20;
          const page = query.page ?? 1;
          const offset = (page - 1) * limit;
          const pagedIntents = result.readResult.intents.slice(offset, offset + limit);
          return success({
            ...result.readResult,
            count: pagedIntents.length,
            totalCount: result.readResult.intents.length,
            limit,
            page,
            totalPages: Math.ceil(result.readResult.intents.length / limit),
            intents: pagedIntents,
            _graphTimings: [{ name: 'intent', durationMs: _readIntentGraphMs, agents: result.agentTimings ?? [] }],
          });
        }

        return success({ ...result.readResult, _graphTimings: [{ name: 'intent', durationMs: _readIntentGraphMs, agents: result.agentTimings ?? [] }] });
      }
      return error("Failed to fetch intents.");
    },
  });

  const createIntent = defineTool({
    name: "create_intent",
    description:
      "Proposes a new intent for the user to approve. Returns a proposal widget (intent_proposal code block) that you MUST include verbatim in your response. The user will see an interactive card and can approve or skip. Pass a clear, concept-based description. The orchestrator should handle URL scraping and vagueness checks BEFORE calling this tool.",
    querySchema: z.object({
      description: z.string().describe("The intent in conceptual terms (scrape URLs and check specificity before calling)"),
      indexId: z.string().optional().describe("Index UUID to link the intent to. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      if (!query.description?.trim()) {
        return error("Description is required.");
      }

      // Strict scope enforcement
      if (context.indexId && query.indexId?.trim() && query.indexId.trim() !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only create intents in this community.`
        );
      }

      const effectiveIndexId = context.indexId || query.indexId?.trim() || undefined;

      // Fetch profile (the intent graph needs it for inference)
      const _profileGraphStart1 = Date.now();
      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const _profileGraphMs1 = Date.now() - _profileGraphStart1;
      const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

      // Run inference + verification only (propose mode — no DB persistence)
      const _intentGraphStart1 = Date.now();
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile,
        inputContent: query.description,
        operationMode: 'propose' as const,
        ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
      });
      const _intentGraphMs1 = Date.now() - _intentGraphStart1;
      logger.debug("Intent graph propose response", { result });

      const verified = result.verifiedIntents || [];
      
      // Extract trace from graph and convert to debugSteps
      const trace = Array.isArray(result.trace) ? result.trace : [];
      const debugSteps = trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
        step: t.node,
        detail: t.detail,
        ...(t.data ? { data: t.data } : {}),
      }));
      
      if (verified.length === 0) {
        // Build a descriptive rejection reason from the trace so the ReACT agent
        // can retry with a better description or ask the user for clarification.
        // When inference produces 0 intents, propose mode exits before verification
        // runs — so we check inference trace first.
        const verificationTrace = debugSteps.find((s: { step: string; detail?: string }) => s.step === "verification");

        if (!verificationTrace) {
          const inferenceHint =
            debugSteps.find((s: { step: string; detail?: string }) => s.step === "inference")?.detail
            ?? "no intents extracted";
          return error(
            `No actionable intent was extracted (${inferenceHint}). ` +
            `Please retry with a more specific goal (what kind, what for, and/or timeframe), ` +
            `or ask the user to clarify.`,
            debugSteps,
          );
        }

        const rejectionHint =
          verificationTrace.detail ?? "all candidate intents were filtered as invalid or too vague";
        return error(
          `Intent verification failed (${rejectionHint}). ` +
          `The description may be too vague or was classified as a statement rather than a goal. ` +
          `Either retry with a more specific description (e.g. include what kind, what for, or a timeframe) ` +
          `or ask the user to clarify what exactly they are looking for.`,
          debugSteps,
        );
      }

      // Build intent_proposal code fences for each verified intent
      const proposalBlocks = verified.map((v: VerifiedIntent) => {
        const proposalId = crypto.randomUUID();
        const data = {
          proposalId,
          description: v.description,
          ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
          confidence: v.score != null ? Math.round(v.score * 100) / 100 : null,
          speechActType: v.verification?.classification ?? null,
        };
        return (
          "```intent_proposal\n" +
          sanitizeJsonForCodeFence(JSON.stringify(data)) +
          "\n```"
        );
      });

      const blocksText = proposalBlocks.join("\n\n");

      return success({
        proposed: true,
        count: verified.length,
        message: `IMPORTANT: Include the following \`\`\`intent_proposal code blocks EXACTLY as-is in your response (they render as interactive cards for the user to approve or skip):\n\n${blocksText}`,
        debugSteps,
        _graphTimings: [
          { name: 'profile', durationMs: _profileGraphMs1, agents: profileResult.agentTimings ?? [] },
          { name: 'intent', durationMs: _intentGraphMs1, agents: result.agentTimings ?? [] },
        ],
      });
    },
  });

  const updateIntent = defineTool({
    name: "update_intent",
    description: "Updates an existing intent's description. Requires intentId from read_intents. When chat is index-scoped, can only update intents linked to that index.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID from read_intents"),
      newDescription: z.string().describe("New description for the intent"),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }

      // Strict scope enforcement: when chat is index-scoped, verify intent is linked to that index
      if (context.indexId) {
        const db = deps.userDb;
        const intentIndexes = await db.getIndexIdsForIntent(intentId);
        if (!intentIndexes.includes(context.indexId)) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only update intents linked to this community.`
          );
        }
      }

      const _profileGraphStart2 = Date.now();
      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const _profileGraphMs2 = Date.now() - _profileGraphStart2;
      const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

      const _intentGraphStart2 = Date.now();
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile,
        operationMode: 'update' as const,
        inputContent: query.newDescription,
        targetIntentIds: [intentId],
        ...(context.indexId && { indexId: context.indexId }),
      });
      const _intentGraphMs2 = Date.now() - _intentGraphStart2;

      if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
        return error("Failed to update intent.");
      }
      return success({
        message: "Intent updated.",
        _graphTimings: [
          { name: 'profile', durationMs: _profileGraphMs2, agents: profileResult.agentTimings ?? [] },
          { name: 'intent', durationMs: _intentGraphMs2, agents: result.agentTimings ?? [] },
        ],
      });
    },
  });

  const deleteIntent = defineTool({
    name: "delete_intent",
    description: "Deletes (archives) an intent. Requires intentId from read_intents. When chat is index-scoped, can only delete intents linked to that index.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID from read_intents"),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }

      // Strict scope enforcement: when chat is index-scoped, verify intent is linked to that index
      if (context.indexId) {
        const db = deps.userDb;
        const intentIndexes = await db.getIndexIdsForIntent(intentId);
        if (!intentIndexes.includes(context.indexId)) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only delete intents linked to this community.`
          );
        }
      }

      const _deleteIntentGraphStart = Date.now();
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        operationMode: 'delete' as const,
        targetIntentIds: [intentId],
        ...(context.indexId && { indexId: context.indexId }),
      });
      const _deleteIntentGraphMs = Date.now() - _deleteIntentGraphStart;

      if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
        return error("Failed to delete intent.");
      }
      return success({
        message: "Intent archived.",
        _graphTimings: [{ name: 'intent', durationMs: _deleteIntentGraphMs, agents: result.agentTimings ?? [] }],
      });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT–INDEX JUNCTION (link / list / unlink)
  // ─────────────────────────────────────────────────────────────────────────────

  const createIntentIndex = defineTool({
    name: "create_intent_index",
    description: "Links an intent to an index. Requires intentId and indexId. When chat is index-scoped, can only link to the scoped index.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID from read_intents"),
      indexId: z.string().optional().describe("Index UUID from read_indexes. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      const indexId = query.indexId?.trim() || context.indexId || "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(indexId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow linking to that index
      if (context.indexId && indexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only link intents to this community.`
        );
      }

      const _createIntentIndexGraphStart = Date.now();
      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        indexId,
        intentId,
        operationMode: 'create' as const,
        skipEvaluation: true,
      });
      const _createIntentIndexGraphMs = Date.now() - _createIntentIndexGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            created: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'intent_index', durationMs: _createIntentIndexGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to link intent to index.");
      }
      return error("Failed to link intent to index.");
    },
  });

  const readIntentIndexes = defineTool({
    name: "read_intent_indexes",
    description:
      "Reads intent-index links. Pass indexId to list intents in that index (add userId to filter). Pass intentId to check if it's linked to an index. When chat is index-scoped, only the scoped index can be queried.",
    querySchema: z.object({
      intentId: z.string().optional().describe("Intent UUID — checks if linked to the current/specified index."),
      indexId: z.string().optional().describe("Index UUID — returns intents in this index. Defaults to current index when scoped."),
      userId: z.string().optional().describe("Filter by user when listing by index."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() || undefined;
      let indexId = query.indexId?.trim() || context.indexId || undefined;
      const queryUserId = query.userId?.trim() || undefined;

      if (intentId && !UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }
      if (indexId && !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format.");
      }
      if (!intentId && !indexId) {
        return error("Provide indexId or intentId.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow querying that index
      if (context.indexId && indexId && indexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read intent links from this community.`
        );
      }

      // When only intentId is provided, enforce scope - don't reveal all linked indexes
      if (intentId && !indexId) {
        if (context.indexId) {
          // When scoped, only check if intent is linked to the scoped index
          indexId = context.indexId;
        } else {
          // When unscoped, still don't reveal all indexes - require explicit indexId
          return error(
            "Please provide an indexId to check if the intent is linked to a specific index. Listing all linked indexes is not supported."
          );
        }
      }

      const _readIntentIndexGraphStart = Date.now();
      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        indexId,
        intentId,
        operationMode: 'read' as const,
        queryUserId,
      });
      const _readIntentIndexGraphMs = Date.now() - _readIntentIndexGraphStart;

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        return success({ ...result.readResult, _graphTimings: [{ name: 'intent_index', durationMs: _readIntentIndexGraphMs, agents: result.agentTimings ?? [] }] });
      }
      return error("Failed to fetch intent-index links.");
    },
  });

  const deleteIntentIndex = defineTool({
    name: "delete_intent_index",
    description: "Unlinks an intent from an index. Does not delete the intent itself. When chat is index-scoped, can only unlink from the scoped index.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID"),
      indexId: z.string().optional().describe("Index UUID. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      const indexId = query.indexId?.trim() || context.indexId || "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(indexId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow unlinking from that index
      if (context.indexId && indexId !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only unlink intents from this community.`
        );
      }

      const _deleteIntentIndexGraphStart = Date.now();
      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        indexId,
        intentId,
        operationMode: 'delete' as const,
      });
      const _deleteIntentIndexGraphMs = Date.now() - _deleteIntentIndexGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            deleted: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'intent_index', durationMs: _deleteIntentIndexGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to unlink.");
      }
      return error("Failed to unlink intent from index.");
    },
  });

  return [readIntents, createIntent, updateIntent, deleteIntent, createIntentIndex, readIntentIndexes, deleteIntentIndex] as const;
}
