import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createChatTools, type ChatTools, type ResolvedToolContext, type ToolContext } from "../shared/agent/tool.factory.js";
import { error, resolveChatContext, success } from "../shared/agent/tool.helpers.js";
import type { SystemDatabase, UserDatabase } from "../shared/interfaces/database.interface.js";
import { deriveAllowedNetworkIds, focusedIntentId, focusedNetworkId, scopeFromNetworkId } from "../shared/agent/tool.scope.js";
import type { ChatPersonaConfig } from "./chat.persona.js";
import { buildSignalSystemContent } from "./signal.prompt.js";

/** Public kickoff marker used by New Signal surfaces to enter guided intake. */
export { SIGNAL_NEW_SIGNAL_KICKOFF } from "./signal.prompt.js";

/** Stable persona id persisted for restricted Signal Agent conversations. */
export const SIGNAL_PERSONA_ID = "signal";

/**
 * Exact positive tool allowlist for Signal Agent.
 *
 * New tools added to the shared chat registry remain unavailable until they are
 * reviewed and explicitly added here.
 */
export const SIGNAL_TOOL_NAMES = [
  // Signals and assignment to communities the user already belongs to.
  "read_intents",
  "create_intent",
  "update_intent",
  "delete_intent",
  "search_intents",
  "read_intent_indexes",
  "create_intent_index",
  "delete_intent_index",
  // User/profile context.
  "read_user_contexts",
  "preview_user_context",
  "confirm_user_context",
  "create_user_context",
  "update_user_context",
  // Premise knowledge.
  "read_premises",
  "create_premise",
  "update_premise",
  "retract_premise",
  // Read-only community and membership context.
  "read_networks",
  "read_network_memberships",
  // Pasted-link reading and chat clarification.
  "scrape_url",
  "ask_user_question",
] as const;

const SIGNAL_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(SIGNAL_TOOL_NAMES);

export interface SignalToolBoundary {
  context: ResolvedToolContext;
  userDb: UserDatabase;
  systemDb: SystemDatabase;
}

function isLiveIntent(intent: Awaited<ReturnType<UserDatabase["getIntent"]>>): intent is NonNullable<typeof intent> {
  return Boolean(
    intent
    && !intent.archivedAt
    && (intent.status == null || intent.status === "ACTIVE"),
  );
}

async function getOwnedLiveIntent(userDb: UserDatabase, intentId: string) {
  try {
    const intent = await userDb.getIntent(intentId);
    return isLiveIntent(intent) ? intent : null;
  } catch {
    // The context-bound adapter throws for foreign IDs. Collapse missing,
    // foreign, archived, and non-live rows to the same non-enumerating result.
    return null;
  }
}

function matchesIntentText(
  intent: { payload: string; summary: string | null },
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return intent.payload.toLocaleLowerCase().includes(needle)
    || (intent.summary?.toLocaleLowerCase().includes(needle) ?? false);
}

/**
 * Filters shared chat tools through Signal Agent's positive allowlist.
 *
 * @param tools - Shared context-bound chat tools
 * @returns Only explicitly approved Signal Agent tools
 */
export function filterSignalTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((candidate) => SIGNAL_TOOL_ALLOWLIST.has(candidate.name));
}

/**
 * Narrows schemas and handlers whose shared versions expose broader modes than
 * Signal Agent is allowed to use.
 *
 * @param allowed - Name-allowlisted shared chat tools
 * @param boundary - Authoritative context-bound databases for Signal-only checks
 * @returns Signal-safe tools with self-only reads and proposal-only creation
 */
export function narrowSignalTools(
  allowed: ChatTools,
  boundary: SignalToolBoundary,
): ChatTools {
  const { context, userDb, systemDb } = boundary;

  return allowed.map((sharedTool) => {
    if (sharedTool.name === "create_intent") {
      return tool(
        async (query: { description: string; networkId?: string }) => {
          const scopedNetworkId = focusedNetworkId(context);
          const scopedIntentId = focusedIntentId(context);
          const explicitNetworkId = query.networkId?.trim();

          if (scopedIntentId) {
            return error("This chat is scoped to an existing selected intent. Update that intent instead of creating a different one here.");
          }
          if (scopedNetworkId && explicitNetworkId && explicitNetworkId !== scopedNetworkId) {
            return error("The requested network conflicts with this chat's focused community.");
          }

          const effectiveNetworkId = scopedNetworkId ?? explicitNetworkId;
          if (effectiveNetworkId) {
            const isMember = await systemDb.isNetworkMember(effectiveNetworkId, context.userId);
            if (!isMember) {
              return error("You are no longer a member of this community.");
            }
          }

          return sharedTool.invoke({
            description: query.description,
            ...(effectiveNetworkId ? { networkId: effectiveNetworkId } : {}),
            // Signal web chats always use the confirmation-safe proposal path.
            autoApprove: false,
          }) as Promise<string>;
        },
        {
          name: "create_intent",
          description:
            "Draft a new signal for the current user. Returns an intent_proposal card that must be passed through verbatim and approved in the web UI before persistence.",
          schema: z.object({
            description: z.string().trim().min(1).describe("Clear, specific signal description."),
            networkId: z.string().uuid().optional().describe("Optional existing-membership community UUID."),
          }).strict(),
        },
      );
    }

    if (sharedTool.name === "read_premises") {
      return tool(
        async (query: { includeRetracted?: boolean }) => sharedTool.invoke({
          includeRetracted: query.includeRetracted ?? false,
        }) as Promise<string>,
        {
          name: "read_premises",
          description: "Read only the current user's premises. Use before creating or updating profile knowledge.",
          schema: z.object({
            includeRetracted: z.boolean().optional().default(false),
          }),
        },
      );
    }

    if (sharedTool.name === "read_user_contexts") {
      return tool(
        async () => sharedTool.invoke({}) as Promise<string>,
        {
          name: "read_user_contexts",
          description: "Read only the current user's identity and synthesized profile context.",
          schema: z.object({}),
        },
      );
    }

    if (sharedTool.name === "read_intents") {
      return tool(
        async (query: { limit?: number; page?: number }) => sharedTool.invoke(query) as Promise<string>,
        {
          name: "read_intents",
          description: "Read the current user's own signals, optionally paginated.",
          schema: z.object({
            limit: z.number().int().min(1).max(100).optional(),
            page: z.number().int().min(1).optional(),
          }),
        },
      );
    }

    if (sharedTool.name === "search_intents") {
      return tool(
        async (query: { query: string; limit?: number }) => {
          const limit = query.limit ?? 25;
          const scopedIntentId = focusedIntentId(context);
          const scopedNetworkId = focusedNetworkId(context);

          if (scopedIntentId) {
            const intent = await getOwnedLiveIntent(userDb, scopedIntentId);
            const intents = intent && matchesIntentText(intent, query.query)
              ? [{ id: intent.id, payload: intent.payload, summary: intent.summary, createdAt: intent.createdAt }]
              : [];
            return success({ intents: intents.slice(0, limit) });
          }

          if (scopedNetworkId) {
            if (!(await systemDb.isNetworkMember(scopedNetworkId, context.userId))) {
              return error("You are no longer a member of this community.");
            }
            const candidates = (await userDb.getActiveIntents())
              .filter((intent) => matchesIntentText(intent, query.query));
            const assignmentChecks = await Promise.all(
              candidates.map((intent) => userDb.isIntentAssignedToIndex(intent.id, scopedNetworkId)),
            );
            return success({
              intents: candidates
                .filter((_intent, index) => assignmentChecks[index])
                .slice(0, limit),
            });
          }

          return success({
            intents: await userDb.searchOwnIntents(query.query, limit),
          });
        },
        {
          name: "search_intents",
          description: "Search the current user's own active signals by text within the selected Signal scope.",
          schema: z.object({
            query: z.string().trim().min(1),
            limit: z.number().int().min(1).max(100).optional(),
          }).strict(),
        },
      );
    }

    if (sharedTool.name === "read_networks") {
      return tool(
        async () => {
          const scopedIntentId = focusedIntentId(context);
          const scopedNetworkId = focusedNetworkId(context);
          const memberships = await userDb.getNetworkMemberships();

          if (scopedNetworkId) {
            const focusedMemberships = memberships.filter(
              (membership) => membership.networkId === scopedNetworkId,
            );
            if (focusedMemberships.length === 0) {
              return error("You are no longer a member of this community.");
            }
            return success({ memberOf: focusedMemberships, publicNetworks: [] });
          }

          if (scopedIntentId) {
            const intent = await getOwnedLiveIntent(userDb, scopedIntentId);
            if (!intent) {
              return error("The selected intent is not an owned active signal.");
            }
            const assignedNetworkIds = new Set(
              await userDb.getNetworkIdsForIntent(scopedIntentId),
            );
            return success({
              memberOf: memberships.filter((membership) =>
                assignedNetworkIds.has(membership.networkId)),
              publicNetworks: [],
            });
          }

          return success({ memberOf: memberships, publicNetworks: [] });
        },
        {
          name: "read_networks",
          description: "List only communities the current user is presently a member of. Public communities are never included.",
          schema: z.object({}).strict(),
        },
      );
    }

    if (sharedTool.name === "read_network_memberships") {
      return tool(
        async (query: { networkId?: string }) => {
          const scopedNetworkId = focusedNetworkId(context);
          const explicitNetworkId = query.networkId?.trim();
          if (scopedNetworkId && explicitNetworkId && explicitNetworkId !== scopedNetworkId) {
            return error("The requested network conflicts with this chat's focused community.");
          }
          const effectiveNetworkId = explicitNetworkId ?? scopedNetworkId;
          const memberships = await userDb.getNetworkMemberships();
          if (effectiveNetworkId) {
            const focusedMemberships = memberships.filter(
              (membership) => membership.networkId === effectiveNetworkId,
            );
            if (focusedMemberships.length === 0) {
              return error("You are no longer a member of this community.");
            }
            return success({ userId: context.userId, memberships: focusedMemberships });
          }
          return success({ userId: context.userId, memberships });
        },
        {
          name: "read_network_memberships",
          description: "Read only the current user's present community memberships. This never lists other members.",
          schema: z.object({
            networkId: z.string().uuid().optional(),
          }).strict(),
        },
      );
    }

    if (sharedTool.name === "read_intent_indexes") {
      return tool(
        async (query: { intentId: string; networkId: string }) => {
          const intentId = query.intentId.trim();
          const networkId = query.networkId.trim();
          const scopedIntentId = focusedIntentId(context);
          const scopedNetworkId = focusedNetworkId(context);

          if (scopedIntentId && intentId !== scopedIntentId) {
            return error("The requested intent conflicts with this chat's selected intent.");
          }
          if (scopedNetworkId && networkId !== scopedNetworkId) {
            return error("The requested network conflicts with this chat's focused community.");
          }

          const intent = await getOwnedLiveIntent(userDb, intentId);
          if (!intent) {
            return error("The selected intent is not an owned active signal.");
          }
          if (!(await systemDb.isNetworkMember(networkId, context.userId))) {
            return error("You are no longer a member of this community.");
          }

          const assigned = await userDb.isIntentAssignedToIndex(intentId, networkId);
          return success({
            isAssigned: assigned,
            links: assigned ? [{ intentId, networkId }] : [],
          });
        },
        {
          name: "read_intent_indexes",
          description: "Check one exact owned active signal-to-current-membership community assignment.",
          schema: z.object({
            intentId: z.string().uuid(),
            networkId: z.string().uuid(),
          }).strict(),
        },
      );
    }

    return sharedTool;
  }) as ChatTools;
}

/**
 * Creates Signal Agent's context-bound restricted toolset.
 *
 * @param deps - Shared tool dependencies
 * @param preResolvedContext - Optional authoritative resolved context
 * @returns The allowlisted and schema-narrowed Signal Agent tools
 */
export async function createSignalTools(
  deps: ToolContext,
  preResolvedContext?: ResolvedToolContext,
): Promise<ChatTools> {
  const explicitScope = deps.scopeType && deps.scopeId
    ? { scopeType: deps.scopeType, scopeId: deps.scopeId }
    : scopeFromNetworkId(deps.networkId);
  const resolvedContext = preResolvedContext ?? await resolveChatContext({
    database: deps.database,
    userId: deps.userId,
    networkId: explicitScope.scopeType === "network" ? explicitScope.scopeId : deps.networkId,
    sessionId: deps.sessionId,
    contactsEnabled: deps.contactsEnabled,
  });
  if (explicitScope.scopeType && explicitScope.scopeId) {
    resolvedContext.scopeType = explicitScope.scopeType;
    resolvedContext.scopeId = explicitScope.scopeId;
  }

  const userDb = deps.userDb ?? deps.createUserDatabase(deps.database, resolvedContext.userId);
  const liveMemberships = await userDb.getNetworkMemberships();
  const allowedNetworkIds = deriveAllowedNetworkIds({
    memberships: liveMemberships,
    ...(resolvedContext.scopeType && resolvedContext.scopeId
      ? { scopeType: resolvedContext.scopeType, scopeId: resolvedContext.scopeId }
      : {}),
  });
  const systemDb = deps.systemDb
    ?? deps.createSystemDatabase(deps.database, resolvedContext.userId, allowedNetworkIds, deps.embedder);
  const allowed = filterSignalTools(
    await createChatTools(deps, resolvedContext),
  ) as ChatTools;

  return narrowSignalTools(allowed, { context: resolvedContext, userDb, systemDb });
}

/** Restricted Signal Agent persona on the persona-neutral chat runtime. */
export const SIGNAL_PERSONA: ChatPersonaConfig = {
  id: SIGNAL_PERSONA_ID,
  buildSystemContent: (ctx, iterCtx) => buildSignalSystemContent(ctx, iterCtx),
  createTools: (deps, preResolvedContext) => createSignalTools(deps, preResolvedContext),
  loopBehaviors: {
    // Direct discovery is absent, so its create-intent retry callback must stay off.
    createIntentCallback: false,
    // create_intent can legitimately return proposal cards; retain recovery/stripping.
    hallucinationRecovery: true,
  },
};
