import { z } from "zod";

import type { ExecutionResult, IntentValidationFailure } from "./graph/intent.graph.state.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { traceGraph } from "../shared/observability/trace.js";

import type { DefineTool, ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import type { UserRecord } from "../../platform/database.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { deriveAllowedNetworkIds, focusedIntentId, focusedNetworkId, focusedNetworkLabel, type ToolScopeEnvelope } from "../shared/agent/tool.scope.js";

/** Host capabilities consumed by signal and intent tools. */
export type IntentToolDeps = Pick<ToolRegistryCompositionDeps, "userDb" | "systemDb">
  & { graphs: Pick<ToolRegistryCompositionDeps["graphs"], "intent" | "intentNetwork"> };

const logger = protocolLogger("ChatTools:Intent");

/** When context is network-scoped, verifies the caller is still a member of that network. Returns error message or null. */
async function ensureScopedMembership(
  context: ToolScopeEnvelope & { networkName?: string; userId: string },
  systemDb: IntentToolDeps['systemDb']
): Promise<string | null> {
  const scopedNetworkId = focusedNetworkId(context);
  if (!scopedNetworkId) return null;
  const isMember = await systemDb.isNetworkMember(scopedNetworkId, context.userId);
  if (!isMember) {
    return `This chat is scoped to ${focusedNetworkLabel(context)}. You are no longer a member of this community.`;
  }
  return null;
}

/**
 * Build the approved identity context used to infer an intent. This deliberately
 * reads the current user record directly: public-profile research is only a
 * prefill mechanism.
 */
function buildApprovedIdentitySnapshot(user: UserRecord | null | undefined): string {
  const name = user?.name?.trim() ?? "";
  const bio = user?.intro?.trim();
  const location = user?.location?.trim() ?? "";
  if (!user || (!name && !bio && !location)) return "";

  return JSON.stringify({
    userId: user.id,
    identity: {
      name,
      bio: bio ?? "",
      location,
    },
    narrative: { context: bio },
    attributes: { skills: [], interests: [] },
  });
}

type IntentUpdateGraphResult = {
  executionResults?: ExecutionResult[];
  validationFailures?: IntentValidationFailure[];
  trace?: Array<{ node: string; detail?: string; data?: Record<string, unknown> }>;
};

/** Convert graph failures into an accurate, machine-readable update-tool error. */
export function describeIntentUpdateFailure(result: IntentUpdateGraphResult): {
  failureCategory: string;
  error: string;
  details?: string;
} {
  const persistenceFailure = result.executionResults?.find((execution) => !execution.success);
  if (persistenceFailure) {
    return {
      failureCategory: 'persistence_failure',
      error: 'Intent update could not be persisted.',
      ...(persistenceFailure.error ? { details: persistenceFailure.error } : {}),
    };
  }

  const failure = result.validationFailures?.[0];
  if (failure) {
    const broadnessNote = failure.referentialBreadth === 'broad'
      ? ' Referential breadth was recorded as a warning; it was not the blocking reason.'
      : '';
    return {
      failureCategory: failure.category,
      error: `${failure.message}${broadnessNote}`,
      ...(failure.classification ? { details: `Speech act: ${failure.classification}.` } : {}),
    };
  }

  return {
    failureCategory: 'reconciliation_boundary',
    error: 'Intent update produced no executable action after target-boundary enforcement.',
  };
}

export function createIntentTools(defineTool: DefineTool, deps: IntentToolDeps) {
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
      "- No parameters: returns the **caller's own** active intents. In a network-scoped chat the result is clamped to the bound network. In an unscoped chat the result spans all of the user's active intents. There is no implicit default to the scoped network — to browse the bound community's intents, pass `networkId` explicitly.\n" +
      "- With networkId: returns **all members'** intents in that network (community browse path). Add userId to filter to one member.\n" +
      "- With userId in an network-scoped chat: reads that member's intents in the bound network. The target user must be a member of that network.\n" +
      "- With userId in an unscoped chat: only works for the current user (cannot read another user's global intents without an network scope).\n\n" +
      "**Workflow:** To explore what members of a network are looking for, first call read_network_memberships(networkId) to list members, " +
      "then read_intents(networkId) to see all intents in that community. " +
      "Each intent includes: id, description (payload), summary, confidence (0-1), inferenceType (explicit/implicit), status, and linked networks.\n\n" +
      "**Returns:** Paginated list of intents with count. Use the intent IDs in subsequent calls to update_intent, delete_intent, or add_intent_to_network.",
    querySchema: z.object({
      networkId: z.string().optional().describe("Network UUID — filters intents to this network (community browse path: returns all members' intents). There is no implicit default in network-scoped chats; omit to get caller-owned intents across the reachable networks, or pass the scoped network UUID to browse community members. Get network IDs from read_networks."),
      userId: z.string().optional().describe("User ID — filters to this user's intents. In an network-scoped chat, this reads that member's intents in the bound network (no networkId required). In an unscoped chat, only the current user is allowed without networkId; cross-user reads require an network scope. Omit for caller-owned intents."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100). Defaults to returning all results if omitted."),
      page: z.number().int().min(1).optional().describe("Page number (1-based). Only used when limit is also provided."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);

      // Distinguish "explicit network browse" from "implicit scope-aware read"
      const scopedNetworkId = focusedNetworkId(context);
      const scopedIntentId = focusedIntentId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);
      const explicitNetworkId = query.networkId?.trim();
      const explicitUserId = query.userId?.trim();

      if (scopedIntentId && (explicitNetworkId || (explicitUserId && explicitUserId !== context.userId))) {
        return error("This chat is scoped to one selected intent. Only that intent is available here.");
      }

      // Validate explicit networkId format
      if (explicitNetworkId && !UUID_REGEX.test(explicitNetworkId)) {
        return error("Invalid network ID format.");
      }

      // Strict scope enforcement: in a scoped chat, the only allowed explicit
      // networkId is the envelope's scoped network. Cross-network browse must
      // happen in a separate unscoped chat or a chat scoped to that network.
      if (scopedNetworkId && explicitNetworkId && explicitNetworkId !== scopedNetworkId) {
        return error(
          `This chat is scoped to ${scopedNetworkLabel}. You can only read intents from this community.`
        );
      }

      // Cross-user read in scoped chat: target user must be a member of the scoped network
      if (scopedNetworkId && explicitUserId && explicitUserId !== context.userId) {
        const isInScopedNetwork = await deps.systemDb.isNetworkMember(scopedNetworkId, explicitUserId);
        if (!isInScopedNetwork) {
          return error(
            `This chat is scoped to ${scopedNetworkLabel}. You can only read intents from members of this community.`
          );
        }
      }

      // Cross-user global read is disallowed without an network scope
      if (!explicitNetworkId && !scopedNetworkId && explicitUserId && explicitUserId !== context.userId) {
        return error("Cannot read another user's global intents. Use networkId to scope to a shared network.");
      }

      // Membership check for explicit cross-network reads in unscoped chats
      if (!scopedNetworkId && explicitNetworkId) {
        const callerIsMember = await deps.systemDb.isNetworkMember(explicitNetworkId, context.userId);
        if (!callerIsMember) {
          return error("You can only read intents from networks you are a member of.");
        }
      }

      // ── Choose the read mode ──
      // 1. Explicit networkId (browse all members in that network) — pass networkId, optionally + queryUserId.
      // 2. Explicit userId in a scoped chat — read that user's intents in the bound network.
      // 3. Explicit userId in an unscoped chat — only self (cross-user rejected above); global "my intents".
      // 4. Implicit (no explicit network/user) in scoped chat — pass networkScope, no networkId.
      // 5. Implicit in unscoped chat — global getActiveIntents (caller's own).
      const graphInput: Record<string, unknown> = {
        userId: context.userId,
        userProfile: "",
      };

      if (scopedIntentId) {
        const intent = await deps.systemDb.getIntent(scopedIntentId);
        if (!intent || intent.userId !== context.userId || intent.archivedAt) {
          return error("This selected intent is no longer available.");
        }
        return success({
          count: 1,
          totalCount: 1,
          intents: [{
            id: intent.id,
            description: intent.payload,
            summary: intent.summary,
            createdAt: intent.createdAt,
          }],
          scopeRestriction: {
            isScoped: true,
            scopedToIntent: scopedIntentId,
            message: "Results are restricted to the selected intent.",
          },
        });
      }

      if (explicitNetworkId) {
        graphInput.networkId = explicitNetworkId;
        if (explicitUserId) graphInput.queryUserId = explicitUserId;
      } else if (explicitUserId && scopedNetworkId) {
        // Scoped chat + userId: implicit network is the chat's bound network.
        // Membership of the target user was verified above.
        graphInput.networkId = scopedNetworkId;
        graphInput.queryUserId = explicitUserId;
      } else if (explicitUserId) {
        // Unscoped chat + userId: only allowed for self (others rejected above).
        graphInput.queryUserId = explicitUserId;
        graphInput.allUserIntents = true;
      } else if (scopedNetworkId) {
        // Scoped chat, implicit read: caller-only across reachable networks.
        graphInput.networkScope = deriveAllowedNetworkIds({
          memberships: context.userNetworks,
          scopeType: 'network',
          scopeId: scopedNetworkId,
        });
      } else {
        // Unscoped, implicit read: caller's global intents.
        graphInput.allUserIntents = true;
      }

      const _readIntentGraphStart = Date.now();
      const result = await traceGraph("intent", () => invokeWithAbortSignal(graphs.intent, graphInput));
      const _readIntentGraphMs = Date.now() - _readIntentGraphStart;

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
      "Creates and persists an intent (a signal of interest or need) for the authenticated user, linked to exactly the networks you name. " +
      "Intents drive discovery: once created, the system indexes the signal and searches for complementary intents from other people.\n\n" +
      "**What to pass:** `description` — a clear, concept-based statement of what the user is looking for (e.g. 'Looking for an AI/ML co-founder in Berlin'). " +
      "`networkIds` — the networks to broadcast it to. Nothing is auto-assigned: a signal with no network ids is created but reaches nobody until it is linked. " +
      "Get network ids from read_networks; every id must be a network the user currently belongs to.\n\n" +
      "**Specificity gate.** Judge whether the description is concrete enough to match on before calling. 'find a job', 'meet people', or 'learn something' " +
      "is too vague — call read_intents() for context, propose a refined version to the user, and wait for their confirmation first. " +
      "Specific asks ('senior UX design role at a tech company in Berlin') can go straight through.\n\n" +
      "**URL handling.** If the user pastes a URL describing the intent (e.g. a job posting), call scrape_url first with " +
      "objective=\"Extract key details for an intent\", synthesize a conceptual description, then pass that here. Exception: profile URLs " +
      "(LinkedIn, GitHub, X) are for research_profile, not scrape_url.\n\n" +
      "**Returns:** The created intent id and the networks it was linked to. Use add_intent_to_network / remove_intent_from_network to change those links later.",
    querySchema: z.object({
      description: z.string().describe("A clear, specific description of what the user is looking for. Concept-based, not a raw URL. Vague descriptions are rejected — include what kind, what for, and/or timeframe."),
      networkIds: z.array(z.string()).optional().describe("Network UUIDs to link the intent to. Each must be a current membership. Defaults to the scoped network in a network-scoped chat, and to nothing otherwise."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      if (!query.description?.trim()) {
        return error("Description is required.");
      }

      const scopedNetworkId = focusedNetworkId(context);
      const scopedIntentId = focusedIntentId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);

      if (scopedIntentId) {
        return error("This chat is scoped to an existing selected intent. Update that intent instead of creating a different one here.");
      }

      const requestedNetworkIds = (query.networkIds ?? []).map((id) => id.trim()).filter(Boolean);
      if (requestedNetworkIds.some((id) => !UUID_REGEX.test(id))) {
        return error("Invalid network ID format.");
      }
      if (scopedNetworkId && requestedNetworkIds.some((id) => id !== scopedNetworkId)) {
        return error(
          `This chat is scoped to ${scopedNetworkLabel}. You can only create intents in this community.`
        );
      }

      const networkIds = scopedNetworkId
        ? [scopedNetworkId]
        : requestedNetworkIds;
      const scopeEnvelope = scopedNetworkId
        ? { scopeType: 'network' as const, scopeId: scopedNetworkId }
        : {};

      const latestUser = typeof userDb.getUser === "function" ? await userDb.getUser() : context.user;
      const userProfile = buildApprovedIdentitySnapshot(latestUser);

      const _intentGraphStart = Date.now();
      const result = await traceGraph("intent", () => invokeWithAbortSignal(graphs.intent, {
        userId: context.userId,
        userProfile,
        inputContent: query.description,
        networkIds,
        ...scopeEnvelope,
      }));
      const _intentGraphMs = Date.now() - _intentGraphStart;
      logger.debug("Intent graph create response", { result });

      const trace = Array.isArray(result.trace) ? result.trace : [];
      const debugSteps = trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
        step: t.node,
        detail: t.detail,
        ...(t.data ? { data: t.data } : {}),
      }));
      const graphTimings = [{ name: 'intent-create', durationMs: _intentGraphMs, agents: result.agentTimings ?? [] }];

      const created = (result.executionResults ?? []).filter(
        (execution: ExecutionResult) => execution.actionType === 'create' && execution.success,
      );
      if (created.length === 0) {
        const failure = describeIntentUpdateFailure(result as IntentUpdateGraphResult);
        return error(
          `${failure.error} Retry with a more specific goal, or ask the user what outcome they want.`,
          debugSteps,
        );
      }

      return success({
        created: true,
        count: created.length,
        intents: created.map((execution: ExecutionResult) => ({
          intentId: execution.intentId,
          description: execution.payload,
          networkIds: execution.linkedNetworkIds ?? [],
        })),
        message: `Created ${created.length} intent${created.length > 1 ? 's' : ''}. Discovery starts in the background; use list_opportunities to review results.`,
        debugSteps,
        _graphTimings: graphTimings,
      });
    },
  });

  const updateIntent = defineTool({
    name: "update_intent",
    description:
      "Updates an existing intent's description. After updating, the system re-processes it through inference and verification, " +
      "re-evaluates its network assignments, and makes the approved signal eligible for background matching.\n\n" +
      "**When to use:** When the user wants to refine or change what they're looking for — e.g. narrowing scope, adding specificity, " +
      "or pivoting to a different need. Prefer updating over delete+create to preserve the intent's history and existing network links.\n\n" +
      "**Returns:** Updated `intentId` and `description`, plus a confirmation message. The intent's embeddings and network relevancy scores are recalculated automatically.",
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

      const scopedIntentId = focusedIntentId(context);
      if (scopedIntentId && scopedIntentId !== intentId) {
        return error("This chat is scoped to one selected intent. You can only update that intent here.");
      }

      // Ownership guard: caller must own the intent
      const intent = await deps.systemDb.getIntent(intentId);
      if (!intent || intent.userId !== context.userId) {
        return error("Intent not found or you can only update your own intents.");
      }
      if (intent.archivedAt) {
        return error("This intent is archived and cannot be updated. Create a new intent instead.");
      }

      const scopedNetworkId = focusedNetworkId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);

      // Strict scope enforcement: when chat is network-scoped, verify intent is linked to that network
      if (scopedNetworkId) {
        const db = deps.userDb;
        const intentNetworks = await db.getNetworkIdsForIntent(intentId);
        if (!intentNetworks.includes(scopedNetworkId)) {
          return error(
            `This chat is scoped to ${scopedNetworkLabel}. You can only update intents linked to this community.`
          );
        }
      }

      const latestUser = typeof userDb.getUser === "function" ? await userDb.getUser() : context.user;
      const userProfile = buildApprovedIdentitySnapshot(latestUser);

      const _intentGraphStart2 = Date.now();
      const result = await traceGraph("intent", () => invokeWithAbortSignal(graphs.intent, {
        userId: context.userId,
        userProfile,
        inputContent: query.description,
        targetIntentIds: [intentId],
        ...(scopedNetworkId && { networkId: scopedNetworkId, scopeType: 'network' as const, scopeId: scopedNetworkId }),
      }));
      const _intentGraphMs2 = Date.now() - _intentGraphStart2;

      if (!result.executionResults?.some((r: ExecutionResult) => r.success)) {
        return JSON.stringify({
          success: false,
          ...describeIntentUpdateFailure(result),
        });
      }
      return success({
        message: "Intent updated.",
        intentId,
        description: query.description,
        _graphTimings: [
          { name: 'intent', durationMs: _intentGraphMs2, agents: result.agentTimings ?? [] },
        ],
      });
    },
  });

  const deleteIntent = defineTool({
    name: "delete_intent",
    description:
      "Archives (soft-deletes) an intent, removing it from active discovery. The intent is not permanently deleted — it is marked as archived " +
      "and no longer participates in opportunity matching or network evaluation.\n\n" +
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

      const scopedNetworkId = focusedNetworkId(context);
      const scopedIntentId = focusedIntentId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);

      if (scopedIntentId && scopedIntentId !== intentId) {
        return error("This chat is scoped to one selected intent. You can only delete that intent here.");
      }

      // Strict scope enforcement: when chat is network-scoped, verify intent is linked to that network
      if (scopedNetworkId) {
        const db = deps.userDb;
        const intentNetworks = await db.getNetworkIdsForIntent(intentId);
        if (!intentNetworks.includes(scopedNetworkId)) {
          return error(
            `This chat is scoped to ${scopedNetworkLabel}. You can only delete intents linked to this community.`
          );
        }
      }

      const _deleteIntentGraphStart = Date.now();
      const result = await traceGraph("intent", () => invokeWithAbortSignal(graphs.intent, {
        userId: context.userId,
        userProfile: "",
        archive: true,
        targetIntentIds: [intentId],
        ...(scopedNetworkId && { networkId: scopedNetworkId, scopeType: 'network' as const, scopeId: scopedNetworkId }),
      }));
      const _deleteIntentGraphMs = Date.now() - _deleteIntentGraphStart;

      if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
        return error("Failed to delete intent.");
      }
      return success({
        message: "Intent archived successfully.",
        _graphTimings: [{ name: 'intent', durationMs: _deleteIntentGraphMs, agents: result.agentTimings ?? [] }],
      });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT–NETWORK JUNCTION (add / list / remove)
  // ─────────────────────────────────────────────────────────────────────────────

  const addIntentToNetwork = defineTool({
    name: "add_intent_to_network",
    description:
      "Manually links an intent to a network (community), making the approved signal eligible for background matching within that network. " +
      "Normally intents are auto-assigned to relevant networks on creation, but use this to explicitly add an intent to an additional network.\n\n" +
      "**When to use:** When the user wants to share an existing intent with a specific community they belong to, " +
      "or when auto-assignment missed a network the user considers relevant.\n\n" +
      "**Returns:** Confirmation that the link was created. The intent will now appear in that network's intent list and participate in discovery within that community.",
    querySchema: z.object({
      intentId: z.string().describe("The UUID of the intent to link. Get this from read_intents results."),
      networkId: z.string().optional().describe("The UUID of the network to link the intent to. Get this from read_networks. Defaults to the scoped network in network-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const scopedNetworkId = focusedNetworkId(context);
      const scopedIntentId = focusedIntentId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);
      const intentId = query.intentId?.trim() ?? "";
      const networkId = query.networkId?.trim() || scopedNetworkId || "";
      if (scopedIntentId && intentId !== scopedIntentId) {
        return error("This chat is scoped to one selected intent. You can only link that intent here.");
      }
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(networkId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      // Strict scope enforcement: when chat is network-scoped, only allow linking to that network
      if (scopedNetworkId && networkId !== scopedNetworkId) {
        return error(
          `This chat is scoped to ${scopedNetworkLabel}. You can only link intents to this community.`
        );
      }

      const _addIntentToNetworkGraphStart = Date.now();
      const result = await traceGraph("intent_network", () => invokeWithAbortSignal(graphs.intentNetwork, {
        userId: context.userId,
        networkId,
        intentId,
        operationMode: 'create' as const,
      }));
      const _addIntentToNetworkGraphMs = Date.now() - _addIntentToNetworkGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          const alreadyExisted = result.mutationResult.message?.includes('already in this network') ?? false;
          return success({
            created: !alreadyExisted,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'intent_network', durationMs: _addIntentToNetworkGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to link intent to network.");
      }
      return error("Failed to link intent to network.");
    },
  });

  const listIntentNetworks = defineTool({
    name: "list_intent_networks",
    description:
      "Reads the many-to-many links between intents and networks. Use this to understand which intents are shared in which communities, " +
      "and which networks a specific intent belongs to.\n\n" +
      "**Usage modes:**\n" +
      "- With networkId: lists all intents linked to that network. Add userId to filter to one member's intents in that network.\n" +
      "- With intentId + networkId: checks whether a specific intent is linked to a specific network.\n" +
      "- intentId alone requires a networkId (the system won't reveal all networks an intent is in).\n\n" +
      "**When to use:** To audit which intents are active in a community, verify an intent's network assignment before removing it, " +
      "or check if a newly created intent was auto-assigned to the expected network.\n\n" +
      "**Returns:** List of intent-network links with relevancy scores (0-1, how well the intent fits the network's purpose).",
    querySchema: z.object({
      intentId: z.string().optional().describe("Intent UUID — check if this specific intent is linked to the specified network. Must be combined with networkId."),
      networkId: z.string().optional().describe("Network UUID — list all intents linked to this network. Get this from read_networks. Defaults to scoped network in network-scoped chats."),
      userId: z.string().optional().describe("Filter results to this user's intents within the specified network. Omit to see all members' intents."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const scopedNetworkId = focusedNetworkId(context);
      const scopedIntentId = focusedIntentId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);
      const intentId = query.intentId?.trim() || scopedIntentId || undefined;
      let networkId = query.networkId?.trim() || scopedNetworkId || undefined;
      const queryUserId = query.userId?.trim() || undefined;

      if (scopedIntentId && query.intentId?.trim() && query.intentId.trim() !== scopedIntentId) {
        return error("This chat is scoped to one selected intent. You can only read links for that intent here.");
      }
      if (scopedIntentId && queryUserId && queryUserId !== context.userId) {
        return error("This chat is scoped to one selected intent. Other users' intent links are not available here.");
      }

      if (intentId && !UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }
      if (networkId && !UUID_REGEX.test(networkId)) {
        return error("Invalid network ID format.");
      }
      if (!intentId && !networkId) {
        return error("Provide networkId or intentId.");
      }

      // Strict scope enforcement: when chat is network-scoped, only allow querying that network
      if (scopedNetworkId && networkId && networkId !== scopedNetworkId) {
        return error(
          `This chat is scoped to ${scopedNetworkLabel}. You can only read intent links from this community.`
        );
      }

      // When only intentId is provided, enforce scope - don't reveal all linked networks
      if (intentId && !networkId) {
        if (scopedNetworkId) {
          // When scoped, only check if intent is linked to the scoped network
          networkId = scopedNetworkId;
        } else {
          // When unscoped, still don't reveal all networks - require explicit networkId
          return error(
            "Please provide a networkId to check if the intent is linked to a specific network. Listing all linked networks is not supported."
          );
        }
      }

      const _listIntentNetworksGraphStart = Date.now();
      const result = await traceGraph("intent_network", () => invokeWithAbortSignal(graphs.intentNetwork, {
        userId: context.userId,
        networkId,
        intentId,
        operationMode: 'read' as const,
        queryUserId,
      }));
      const _listIntentNetworksGraphMs = Date.now() - _listIntentNetworksGraphStart;

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        return success({ ...result.readResult, _graphTimings: [{ name: 'intent_network', durationMs: _listIntentNetworksGraphMs, agents: result.agentTimings ?? [] }] });
      }
      return error("Failed to fetch intent-network links.");
    },
  });

  const removeIntentFromNetwork = defineTool({
    name: "remove_intent_from_network",
    description:
      "Removes the link between an intent and a network. The intent itself is NOT deleted — it just stops being visible in that community " +
      "and is no longer eligible for background matching within that network. The intent may still be linked to other networks.\n\n" +
      "**When to use:** When the user wants to withdraw an intent from a specific community without archiving it entirely. " +
      "Use list_intent_networks first to verify the link exists.\n\n" +
      "**Returns:** Confirmation that the link was removed. To fully remove an intent, use delete_intent instead.",
    querySchema: z.object({
      intentId: z.string().describe("The UUID of the intent to unlink. Get this from read_intents or list_intent_networks."),
      networkId: z.string().optional().describe("The UUID of the network to unlink from. Get this from read_networks. Defaults to the scoped network in network-scoped chats."),
    }),
    handler: async ({ context, query }) => {
      const scopeErr = await ensureScopedMembership(context, deps.systemDb);
      if (scopeErr) return error(scopeErr);
      const scopedNetworkId = focusedNetworkId(context);
      const scopedIntentId = focusedIntentId(context);
      const scopedNetworkLabel = focusedNetworkLabel(context);
      const intentId = query.intentId?.trim() ?? "";
      const networkId = query.networkId?.trim() || scopedNetworkId || "";
      if (scopedIntentId && intentId !== scopedIntentId) {
        return error("This chat is scoped to one selected intent. You can only unlink that intent here.");
      }
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(networkId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      // Strict scope enforcement: when chat is network-scoped, only allow unlinking from that network
      if (scopedNetworkId && networkId !== scopedNetworkId) {
        return error(
          `This chat is scoped to ${scopedNetworkLabel}. You can only unlink intents from this community.`
        );
      }

      const _removeIntentFromNetworkGraphStart = Date.now();
      const result = await traceGraph("intent_network", () => invokeWithAbortSignal(graphs.intentNetwork, {
        userId: context.userId,
        networkId,
        intentId,
        operationMode: 'delete' as const,
      }));
      const _removeIntentFromNetworkGraphMs = Date.now() - _removeIntentFromNetworkGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            deleted: true,
            message: result.mutationResult.message,
            _graphTimings: [{ name: 'intent_network', durationMs: _removeIntentFromNetworkGraphMs, agents: result.agentTimings ?? [] }],
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
      "Approved signals are matched in the background. Use list_opportunities only to review persisted opportunities after background matching has produced them.\n\n" +
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

  return [readIntents, createIntent, updateIntent, deleteIntent, addIntentToNetwork, listIntentNetworks, removeIntentFromNetwork, searchIntents] as const;
}
