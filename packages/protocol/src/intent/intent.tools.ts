import { z } from "zod";

import type { ExecutionResult, VerifiedIntent } from "./intent.state.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";

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
  context: { networkId?: string; indexName?: string; userId: string },
  systemDb: ToolDeps['systemDb']
): Promise<string | null> {
  if (!context.networkId) return null;
  const isMember = await systemDb.isNetworkMember(context.networkId, context.userId);
  if (!isMember) {
    return `This chat is scoped to ${context.indexName ?? 'this index'}. You are no longer a member of this community.`;
  }
  return null;
}

export function createIntentTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs, userDb } = deps;

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  const readIntents = defineTool({
    name: "read_intents",
    description:
      "Retrieves intents (signals of interest/need, e.g. 'Looking for a React developer in Berlin'). " +
      "Intents are the core unit of discovery — they represent what users are seeking and drive semantic matching for opportunities.\n\n" +
      "**Usage modes:**\n" +
      "- No parameters: returns the authenticated user's own active intents across all indexes.\n" +
      "- With networkId: returns all intents in that index (community). Add userId to filter to one member's intents.\n" +
      "- With userId alone: only works for the current user (cannot read another user's global intents without an index scope).\n\n" +
      "**Workflow:** To explore what members of an index are looking for, first call read_network_memberships(networkId) to list members, " +
      "then read_intents(networkId) to see all intents in that community. " +
      "Each intent includes: id, description (payload), summary, confidence (0-1), inferenceType (explicit/implicit), status, and linked indexes.\n\n" +
      "**Returns:** Paginated list of intents with count. Use the intent IDs in subsequent calls to update_intent, delete_intent, or create_intent_network.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Index UUID — filters intents to this index (community). When in an index-scoped chat, defaults to the scoped index. Get index IDs from read_networks."),
      userId: z.string().optional().describe("User ID — filters to this user's intents. Must be combined with networkId when looking up another user. Omit to get the current user's intents."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100). Defaults to returning all results if omitted."),
      page: z.number().int().min(1).optional().describe("Page number (1-based). Only used when limit is also provided."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      // Strict scope enforcement: when chat is index-scoped, only allow querying that index
      if (context.networkId && query.networkId?.trim() && query.networkId.trim() !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read intents from this community.`
        );
      }

      const effectiveIndexId = context.networkId || query.networkId?.trim() || undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid network ID format.");
      }

      const queryUserId = query.userId?.trim() || undefined;

      // When scoped, reading another user's intents is restricted to the scoped index
      if (context.networkId && queryUserId && queryUserId !== context.userId) {
        // Verify target user is a member of the scoped index
        const db = deps.systemDb;
        const isInScopedIndex = await db.isNetworkMember(context.networkId, queryUserId);
        if (!isInScopedIndex) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read intents from members of this community.`
          );
        }
      }

      if (!effectiveIndexId && queryUserId && queryUserId !== context.userId) {
        return error("Cannot read another user's global intents. Use networkId to scope to a shared network.");
      }

      // Verify the caller is a member of the index they're querying (unscoped chat only - scoped is already validated)
      if (!context.networkId && effectiveIndexId) {
        const db = deps.systemDb;
        const callerIsMember = await db.isNetworkMember(effectiveIndexId, context.userId);
        if (!callerIsMember) {
          return error(
            "You can only read intents from indexes you are a member of."
          );
        }
      }

      // When scoped, we should NOT return all user intents across indexes - only those in the scoped index
      const allUserIntents = !context.networkId && !effectiveIndexId && (!queryUserId || queryUserId === context.userId);

      const _readIntentGraphStart = Date.now();
      const _readIntentTraceEmitter = requestContext.getStore()?.traceEmitter;
      _readIntentTraceEmitter?.({ type: "graph_start", name: "intent" });
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        networkId: effectiveIndexId,
        operationMode: 'read' as const,
        queryUserId,
        allUserIntents,
      });
      const _readIntentGraphMs = Date.now() - _readIntentGraphStart;
      _readIntentTraceEmitter?.({ type: "graph_end", name: "intent", durationMs: _readIntentGraphMs });

      if (result.readResult) {
        if (result.readResult.count === 0 && result.readResult.message && /not a member|Network not found/i.test(result.readResult.message)) {
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
      "Creates a new intent (signal of interest/need) for the authenticated user. Intents drive the discovery engine — once created, " +
      "the system automatically evaluates them against indexes the user belongs to, links them to relevant communities, and begins " +
      "searching for matching opportunities (complementary intents from other users).\n\n" +
      "**What to pass:** A clear, concept-based description of what the user is looking for (e.g. 'Looking for an AI/ML co-founder in Berlin', " +
      "'Need a designer for a mobile app project'). If the user provided a URL, scrape it with scrape_url first and synthesize the content into a description.\n\n" +
      "**What happens:** The system runs inference (extracting structured intents), verification (checking specificity and speech-act type), " +
      "and returns a proposal widget. The proposal is NOT yet persisted — the user must approve it first.\n\n" +
      "**Returns:** An intent_proposal code block that MUST be included verbatim in the response. The frontend renders it as an interactive " +
      "card the user can approve or skip. On approval, the intent is persisted, indexed, and discovery begins.\n\n" +
      "**Next steps after approval:** The intent is automatically linked to relevant indexes. Call create_opportunities(searchQuery) to explicitly trigger discovery, " +
      "or wait for background processing to find matches.\n\n" +
      "**Specificity gate.** Before calling this tool, judge whether the description is concrete enough to be " +
      "useful for matching. If the user says \"find a job\", \"meet people\", or \"learn something\", that's too " +
      "vague — FIRST call read_user_profiles() + read_intents() to understand their context, THEN propose a " +
      "refined version (\"Based on your background in X, did you mean 'Y'?\") and wait for confirmation before " +
      "calling create_intent. Specific asks (\"senior UX design role at a tech company in Berlin\") can go " +
      "directly to create_intent.\n\n" +
      "**URL handling.** If the user pastes a URL describing the intent (e.g. a job posting), call scrape_url " +
      "first with objective=\"Extract key details for an intent\", synthesize a conceptual description from the " +
      "content, then call create_intent with the synthesis. Exception: profile URLs (LinkedIn, GitHub, X) passed " +
      "to create_user_profile are handled by that tool directly — do not scrape first.\n\n" +
      "**Proposal card contract.** The response contains an ```intent_proposal code block. Include that block " +
      "VERBATIM in your reply to the user — do not summarize it, do not write an intent_proposal block yourself. " +
      "Only this tool returns valid blocks (they embed a proposalId the UI needs to persist the intent on approval).",
    querySchema: z.object({
      description: z.string().describe("A clear, specific description of what the user is looking for. Should be concept-based, not a raw URL. If the user shared a URL, scrape it first with scrape_url and pass the synthesized content here. Vague descriptions will be rejected — include what kind, what for, and/or timeframe."),
      networkId: z.string().optional().describe("Index UUID to link the intent to upon creation. Defaults to the scoped index in index-scoped chats. Get index IDs from read_networks. If omitted, the system auto-assigns to relevant indexes based on their prompts."),
      autoApprove: z.boolean().optional().describe("When true, automatically persists all verified intents without returning proposal cards for manual approval. MCP agents SHOULD set this to true since there is no UI for card-based approval. Web chat agents should omit or set to false to get interactive proposal cards."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      if (!query.description?.trim()) {
        return error("Description is required.");
      }

      // Strict scope enforcement
      if (context.networkId && query.networkId?.trim() && query.networkId.trim() !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only create intents in this community.`
        );
      }

      const effectiveIndexId = context.networkId || query.networkId?.trim() || undefined;

      // Fetch profile (the intent graph needs it for inference)
      const _profileGraphStart1 = Date.now();
      const _createIntentProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createIntentProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const _profileGraphMs1 = Date.now() - _profileGraphStart1;
      _createIntentProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _profileGraphMs1 });
      const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

      // Run inference + verification only (propose mode — no DB persistence)
      const _intentGraphStart1 = Date.now();
      const _createIntentTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createIntentTraceEmitter?.({ type: "graph_start", name: "intent" });
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile,
        inputContent: query.description,
        operationMode: 'propose' as const,
        ...(effectiveIndexId ? { networkId: effectiveIndexId } : {}),
      });
      const _intentGraphMs1 = Date.now() - _intentGraphStart1;
      _createIntentTraceEmitter?.({ type: "graph_end", name: "intent", durationMs: _intentGraphMs1 });
      logger.debug("Intent graph propose response", { result });

      const verified = result.verifiedIntents || [];

      // MCP contexts have no interactive UI for proposal cards — default to auto-approve
      const shouldAutoApprove = query.autoApprove ?? context.isMcp ?? false;
      
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

      // ── Auto-approve path (for MCP agents or explicit opt-in) ──
      if (shouldAutoApprove) {
        const createdIntents: Array<{ description: string; confidence: number | null; speechActType: string | null }> = [];
        const createTimings: Array<{ name: string; durationMs: number; agents: unknown[] }> = [];

        for (const v of verified as VerifiedIntent[]) {
          const _createGraphStart = Date.now();
          const _createTraceEmitter = requestContext.getStore()?.traceEmitter;
          _createTraceEmitter?.({ type: "graph_start", name: "intent" });
          const createResult = await graphs.intent.invoke({
            userId: context.userId,
            userProfile,
            inputContent: v.description,
            operationMode: 'create' as const,
            ...(effectiveIndexId ? { networkId: effectiveIndexId } : {}),
          });
          const _createGraphMs = Date.now() - _createGraphStart;
          _createTraceEmitter?.({ type: "graph_end", name: "intent", durationMs: _createGraphMs });

          createTimings.push({ name: 'intent-create', durationMs: _createGraphMs, agents: createResult.agentTimings ?? [] });

          const succeeded = createResult.executionResults?.some((r: ExecutionResult) => r.success);
          if (succeeded) {
            createdIntents.push({
              description: v.description,
              confidence: v.score != null ? Math.round(v.score * 100) / 100 : null,
              speechActType: v.verification?.classification ?? null,
            });
          }
        }

        return success({
          created: createdIntents.length > 0,
          count: createdIntents.length,
          intents: createdIntents,
          message: createdIntents.length > 0
            ? `Created ${createdIntents.length} intent${createdIntents.length > 1 ? 's' : ''} successfully. The system will automatically index them and begin searching for matching opportunities.`
            : 'Intent creation failed — the intents could not be persisted.',
          debugSteps,
          _graphTimings: [
            { name: 'profile', durationMs: _profileGraphMs1, agents: profileResult.agentTimings ?? [] },
            { name: 'intent-propose', durationMs: _intentGraphMs1, agents: result.agentTimings ?? [] },
            ...createTimings,
          ],
        });
      }

      // ── Proposal path (for web chat with interactive cards) ──
      // Build intent_proposal code fences for each verified intent
      const proposalBlocks = verified.map((v: VerifiedIntent) => {
        const proposalId = crypto.randomUUID();
        const data = {
          proposalId,
          description: v.description,
          ...(effectiveIndexId ? { networkId: effectiveIndexId } : {}),
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
    description:
      "Updates an existing intent's description. After updating, the system re-processes the intent through inference and verification, " +
      "re-evaluates its index assignments, and triggers fresh opportunity discovery with the new description.\n\n" +
      "**When to use:** When the user wants to refine or change what they're looking for — e.g. narrowing scope, adding specificity, " +
      "or pivoting to a different need. Prefer updating over delete+create to preserve the intent's history and existing index links.\n\n" +
      "**Returns:** Confirmation of update. The intent's embeddings and index relevancy scores are recalculated automatically.",
    querySchema: z.object({
      intentId: z.string().describe("The UUID of the intent to update. Get this from read_intents results."),
      description: z.string().describe("The updated description of what the user is looking for. Same guidelines as create_intent — should be clear and specific."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }

      // Ownership guard: caller must own the intent
      const intent = await deps.systemDb.getIntent(intentId);
      if (!intent || intent.userId !== context.userId) {
        return error("Intent not found or you can only update your own intents.");
      }
      if (intent.archivedAt) {
        return error("This intent is archived and cannot be updated. Create a new intent instead.");
      }

      // Strict scope enforcement: when chat is index-scoped, verify intent is linked to that index
      if (context.networkId) {
        const db = deps.userDb;
        const intentNetworks = await db.getNetworkIdsForIntent(intentId);
        if (!intentNetworks.includes(context.networkId)) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only update intents linked to this community.`
          );
        }
      }

      const _profileGraphStart2 = Date.now();
      const _updateIntentProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateIntentProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const _profileGraphMs2 = Date.now() - _profileGraphStart2;
      _updateIntentProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _profileGraphMs2 });
      const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

      const _intentGraphStart2 = Date.now();
      const _updateIntentTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateIntentTraceEmitter?.({ type: "graph_start", name: "intent" });
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile,
        operationMode: 'update' as const,
        inputContent: query.description,
        targetIntentIds: [intentId],
        ...(context.networkId && { networkId: context.networkId }),
      });
      const _intentGraphMs2 = Date.now() - _intentGraphStart2;
      _updateIntentTraceEmitter?.({ type: "graph_end", name: "intent", durationMs: _intentGraphMs2 });

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
    description:
      "Archives (soft-deletes) an intent, removing it from active discovery. The intent is not permanently deleted — it is marked as archived " +
      "and no longer participates in opportunity matching or index evaluation.\n\n" +
      "**When to use:** When the user's need has been fulfilled, is no longer relevant, or was created by mistake. " +
      "If the user wants to change the description instead, use update_intent to preserve history.\n\n" +
      "**Returns:** Confirmation that the intent was archived. Previously created opportunities from this intent remain but won't generate new ones.",
    querySchema: z.object({
      intentId: z.string().describe("The UUID of the intent to archive. Get this from read_intents results."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }

      // Ownership guard: caller must own the intent
      const intent = await deps.systemDb.getIntent(intentId);
      if (!intent || intent.userId !== context.userId) {
        return error("Intent not found or you can only delete your own intents.");
      }

      // Strict scope enforcement: when chat is index-scoped, verify intent is linked to that index
      if (context.networkId) {
        const db = deps.userDb;
        const intentNetworks = await db.getNetworkIdsForIntent(intentId);
        if (!intentNetworks.includes(context.networkId)) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only delete intents linked to this community.`
          );
        }
      }

      const _deleteIntentGraphStart = Date.now();
      const _deleteIntentTraceEmitter = requestContext.getStore()?.traceEmitter;
      _deleteIntentTraceEmitter?.({ type: "graph_start", name: "intent" });
      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        operationMode: 'delete' as const,
        targetIntentIds: [intentId],
        ...(context.networkId && { networkId: context.networkId }),
      });
      const _deleteIntentGraphMs = Date.now() - _deleteIntentGraphStart;
      _deleteIntentTraceEmitter?.({ type: "graph_end", name: "intent", durationMs: _deleteIntentGraphMs });

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
  // INTENT–NETWORK JUNCTION (link / list / unlink)
  // ─────────────────────────────────────────────────────────────────────────────

  const createIntentNetwork = defineTool({
    name: "create_intent_network",
    description:
      "Manually links an intent to an index (community), making it visible to other members and eligible for opportunity discovery within that index. " +
      "Normally intents are auto-assigned to relevant indexes on creation, but use this to explicitly add an intent to an additional index.\n\n" +
      "**When to use:** When the user wants to share an existing intent with a specific community they belong to, " +
      "or when auto-assignment missed an index the user considers relevant.\n\n" +
      "**Returns:** Confirmation that the link was created. The intent will now appear in that index's intent list and participate in discovery within that community.",
    querySchema: z.object({
      intentId: z.string().describe("The UUID of the intent to link. Get this from read_intents results."),
      networkId: z.string().optional().describe("The UUID of the index to link the intent to. Get this from read_networks. Defaults to the scoped index in index-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      const networkId = query.networkId?.trim() || context.networkId || "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(networkId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow linking to that index
      if (context.networkId && networkId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only link intents to this community.`
        );
      }

      const _createIntentNetworkGraphStart = Date.now();
      const _createIntentNetworkTraceEmitter = requestContext.getStore()?.traceEmitter;
      _createIntentNetworkTraceEmitter?.({ type: "graph_start", name: "intent_network" });
      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        networkId,
        intentId,
        operationMode: 'create' as const,
        skipEvaluation: true,
      });
      const _createIntentNetworkGraphMs = Date.now() - _createIntentNetworkGraphStart;
      _createIntentNetworkTraceEmitter?.({ type: "graph_end", name: "intent_network", durationMs: _createIntentNetworkGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          const alreadyExisted = result.mutationResult.message?.includes('already in this network') ?? false;
          return success({
            created: !alreadyExisted,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'intent_network', durationMs: _createIntentNetworkGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to link intent to network.");
      }
      return error("Failed to link intent to network.");
    },
  });

  const readIntentNetworks = defineTool({
    name: "read_intent_networks",
    description:
      "Reads the many-to-many links between intents and indexes. Use this to understand which intents are shared in which communities, " +
      "and which indexes a specific intent belongs to.\n\n" +
      "**Usage modes:**\n" +
      "- With networkId: lists all intents linked to that index. Add userId to filter to one member's intents in that index.\n" +
      "- With intentId + networkId: checks whether a specific intent is linked to a specific index.\n" +
      "- intentId alone requires a networkId (the system won't reveal all indexes an intent is in).\n\n" +
      "**When to use:** To audit which intents are active in a community, verify an intent's index assignment before unlinking, " +
      "or check if a newly created intent was auto-assigned to the expected index.\n\n" +
      "**Returns:** List of intent-index links with relevancy scores (0-1, how well the intent fits the index's purpose).",
    querySchema: z.object({
      intentId: z.string().optional().describe("Intent UUID — check if this specific intent is linked to the specified index. Must be combined with networkId."),
      networkId: z.string().optional().describe("Index UUID — list all intents linked to this index. Get this from read_networks. Defaults to scoped index in index-scoped chats."),
      userId: z.string().optional().describe("Filter results to this user's intents within the specified index. Omit to see all members' intents."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() || undefined;
      let networkId = query.networkId?.trim() || context.networkId || undefined;
      const queryUserId = query.userId?.trim() || undefined;

      if (intentId && !UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }
      if (networkId && !UUID_REGEX.test(networkId)) {
        return error("Invalid network ID format.");
      }
      if (!intentId && !networkId) {
        return error("Provide networkId or intentId.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow querying that index
      if (context.networkId && networkId && networkId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only read intent links from this community.`
        );
      }

      // When only intentId is provided, enforce scope - don't reveal all linked indexes
      if (intentId && !networkId) {
        if (context.networkId) {
          // When scoped, only check if intent is linked to the scoped index
          networkId = context.networkId;
        } else {
          // When unscoped, still don't reveal all indexes - require explicit networkId
          return error(
            "Please provide a networkId to check if the intent is linked to a specific network. Listing all linked networks is not supported."
          );
        }
      }

      const _readIntentNetworkGraphStart = Date.now();
      const _readIntentNetworkTraceEmitter = requestContext.getStore()?.traceEmitter;
      _readIntentNetworkTraceEmitter?.({ type: "graph_start", name: "intent_network" });
      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        networkId,
        intentId,
        operationMode: 'read' as const,
        queryUserId,
      });
      const _readIntentNetworkGraphMs = Date.now() - _readIntentNetworkGraphStart;
      _readIntentNetworkTraceEmitter?.({ type: "graph_end", name: "intent_network", durationMs: _readIntentNetworkGraphMs });

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        return success({ ...result.readResult, _graphTimings: [{ name: 'intent_network', durationMs: _readIntentNetworkGraphMs, agents: result.agentTimings ?? [] }] });
      }
      return error("Failed to fetch intent-network links.");
    },
  });

  const deleteIntentNetwork = defineTool({
    name: "delete_intent_network",
    description:
      "Removes the link between an intent and an index. The intent itself is NOT deleted — it just stops being visible in that community " +
      "and no longer participates in opportunity discovery within that index. The intent may still be linked to other indexes.\n\n" +
      "**When to use:** When the user wants to withdraw an intent from a specific community without archiving it entirely. " +
      "Use read_intent_networks first to verify the link exists.\n\n" +
      "**Returns:** Confirmation that the link was removed. To fully remove an intent, use delete_intent instead.",
    querySchema: z.object({
      intentId: z.string().describe("The UUID of the intent to unlink. Get this from read_intents or read_intent_networks."),
      networkId: z.string().optional().describe("The UUID of the index to unlink from. Get this from read_networks. Defaults to the scoped index in index-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const intentId = query.intentId?.trim() ?? "";
      const networkId = query.networkId?.trim() || context.networkId || "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(networkId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      // Strict scope enforcement: when chat is index-scoped, only allow unlinking from that index
      if (context.networkId && networkId !== context.networkId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only unlink intents from this community.`
        );
      }

      const _deleteIntentNetworkGraphStart = Date.now();
      const _deleteIntentNetworkTraceEmitter = requestContext.getStore()?.traceEmitter;
      _deleteIntentNetworkTraceEmitter?.({ type: "graph_start", name: "intent_network" });
      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        networkId,
        intentId,
        operationMode: 'delete' as const,
      });
      const _deleteIntentNetworkGraphMs = Date.now() - _deleteIntentNetworkGraphStart;
      _deleteIntentNetworkTraceEmitter?.({ type: "graph_end", name: "intent_network", durationMs: _deleteIntentNetworkGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            deleted: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'intent_network', durationMs: _deleteIntentNetworkGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to unlink.");
      }
      return error("Failed to unlink intent from network.");
    },
  });

  const searchIntents = defineTool({
    name: "search_intents",
    description:
      "Text-searches the authenticated user's own active signals by description. Case-insensitive substring " +
      "match over the signal's payload and summary. Use when the user references a past signal they wrote " +
      '("find my signal about React mentorship") or wants to audit what they\'ve posted.\n\n' +
      "For discovery of OTHER users' signals that match a query, use create_opportunities(searchQuery=...) " +
      "instead — that runs semantic matching across the user's networks.\n\n" +
      "**Returns:** `intents: [{ id, payload, summary, createdAt }]`, most recent first, up to `limit` (default 25).",
    querySchema: z.object({
      query: z.string().min(1).describe("Text to match against payload and summary (case-insensitive)."),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Maximum intents to return (default 25, max 100)."),
    }),
    handler: async ({ context, query }) => {
      const rows = await userDb.searchOwnIntents(query.query, query.limit ?? 25);
      logger.verbose("search_intents", { userId: context.userId, query: query.query, matched: rows.length });
      return success({ intents: rows });
    },
  });

  return [readIntents, createIntent, updateIntent, deleteIntent, createIntentNetwork, readIntentNetworks, deleteIntentNetwork, searchIntents] as const;
}
