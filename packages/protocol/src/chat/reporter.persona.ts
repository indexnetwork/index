import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createChatTools, type ChatTools, type ResolvedToolContext, type ToolContext } from "../shared/agent/tool.factory.js";
import { error, resolveChatContext, success } from "../shared/agent/tool.helpers.js";
import type { UserDatabase } from "../shared/interfaces/database.interface.js";
import { focusedNetworkId, scopeFromNetworkId } from "../shared/agent/tool.scope.js";
import type { ChatPersonaConfig } from "./chat.persona.js";
import { buildReporterSystemContent } from "./reporter.prompt.js";

/** Public kickoff marker used by the Agent surface to request its opening briefing. */
export { REPORTER_BRIEFING_KICKOFF } from "./reporter.prompt.js";

/** Stable persona id persisted for read-only Agent reporting sessions. */
export const REPORTER_PERSONA_ID = "reporter";

/**
 * Exact positive allowlist for the reporter persona. New shared tools remain
 * unavailable until they are explicitly reviewed here.
 */
export const REPORTER_TOOL_NAMES = [
  "read_intents",
  "search_intents",
  "read_user_contexts",
  "preview_user_context",
  "read_premises",
  "read_networks",
  "read_network_memberships",
  "read_pending_questions",
  "list_opportunities",
  "report_agent_activity",
] as const;

const REPORTER_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(REPORTER_TOOL_NAMES);

interface ReporterToolBoundary {
  context: ResolvedToolContext;
  userDb: UserDatabase;
  findPendingQuestions?: ToolContext["findPendingQuestions"];
}

/** Filters a shared registry through the reporter's positive allowlist. */
export function filterReporterTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((candidate) => REPORTER_TOOL_ALLOWLIST.has(candidate.name));
}

function invokeSharedTool(sharedTool: { invoke: (input: unknown) => unknown }, input: unknown): Promise<string> {
  return sharedTool.invoke(input) as Promise<string>;
}

/**
 * Replaces shared tools whose normal modes can enumerate other users with
 * reporter-safe, self-only read contracts. Opportunity listing is deliberately
 * aggregate-only: it never returns a counterpart name, row, or explanation.
 */
export function narrowReporterTools(
  allowed: ChatTools,
  boundary: ReporterToolBoundary,
): ChatTools {
  const { context, userDb } = boundary;

  return allowed.map((sharedTool) => {
    if (sharedTool.name === "read_intents") {
      return tool(
        async (query: { limit?: number; page?: number }) => {
          const limit = query.limit ?? 100;
          const page = query.page ?? 1;
          const intents = await userDb.getActiveIntents();
          const start = (page - 1) * limit;
          return success({
            intents: intents.slice(start, start + limit),
            page,
            limit,
            total: intents.length,
          });
        },
        {
          name: "read_intents",
          description: "Read the authenticated user's own active signals only.",
          schema: z.object({
            limit: z.number().int().min(1).max(100).optional(),
            page: z.number().int().min(1).optional(),
          }).strict(),
        },
      );
    }

    if (sharedTool.name === "search_intents") {
      return tool(
        async (query: { query: string; limit?: number }) => success({
          intents: await userDb.searchOwnIntents(query.query, query.limit ?? 20),
        }),
        {
          name: "search_intents",
          description: "Search the authenticated user's own active signals only.",
          schema: z.object({
            query: z.string().trim().min(1),
            limit: z.number().int().min(1).max(100).optional(),
          }).strict(),
        },
      );
    }

    if (sharedTool.name === "read_user_contexts") {
      return tool(
        async () => invokeSharedTool(sharedTool, {}),
        {
          name: "read_user_contexts",
          description: "Read the authenticated user's own identity and global context only.",
          schema: z.object({}).strict(),
        },
      );
    }

    if (sharedTool.name === "read_premises") {
      return tool(
        async (query: { includeRetracted?: boolean }) => invokeSharedTool(sharedTool, {
          includeRetracted: query.includeRetracted ?? false,
          userId: context.userId,
        }),
        {
          name: "read_premises",
          description: "Read the authenticated user's own premises only.",
          schema: z.object({ includeRetracted: z.boolean().optional() }).strict(),
        },
      );
    }

    if (sharedTool.name === "read_network_memberships") {
      return tool(
        async () => invokeSharedTool(sharedTool, {}),
        {
          name: "read_network_memberships",
          description: "Read the authenticated user's own network memberships only.",
          schema: z.object({}).strict(),
        },
      );
    }

    if (sharedTool.name === "read_networks") {
      return tool(
        async () => invokeSharedTool(sharedTool, { userId: context.userId }),
        {
          name: "read_networks",
          description: "Read networks available to the authenticated user.",
          schema: z.object({}).strict(),
        },
      );
    }

    if (sharedTool.name === "read_pending_questions") {
      return tool(
        async (query: { limit?: number }) => {
          if (!boundary.findPendingQuestions) return error("Question lookup is not available.");
          const questions = await boundary.findPendingQuestions(context.userId, {
            modes: ["enrichment", "intent", "discovery"],
            limit: query.limit ?? 10,
          });
          return success({ questions: questions.slice(0, query.limit ?? 10) });
        },
        {
          name: "read_pending_questions",
          description: "Read the user's own non-negotiation pending questions; answering is unavailable here.",
          schema: z.object({ limit: z.number().int().min(1).max(10).optional() }).strict(),
        },
      );
    }

    if (sharedTool.name === "list_opportunities") {
      return tool(
        async (query: { networkId?: string }) => {
          const scopedNetworkId = focusedNetworkId(context);
          if (scopedNetworkId && query.networkId && query.networkId !== scopedNetworkId) {
            return error("This chat is scoped to a different network.");
          }
          const activeIntents = await userDb.getActiveIntents();
          const intentById = new Map(activeIntents.map((intent) => [intent.id, intent]));
          const opportunities = await userDb.getOpportunitiesForUser({
            ...(query.networkId || scopedNetworkId ? { networkId: query.networkId || scopedNetworkId } : {}),
            statuses: ["draft", "pending", "latent"],
            limit: 100,
          });
          const counts = new Map<string, { intentId: string; title: string; count: number }>();
          const seen = new Set<string>();
          for (const opportunity of opportunities) {
            const ownIntentIds = new Set(
              opportunity.actors
                .filter((actor) => actor.userId === context.userId && actor.intent && intentById.has(actor.intent))
                .map((actor) => actor.intent as string),
            );
            if (ownIntentIds.size === 0) continue;
            seen.add(opportunity.id);
            for (const intentId of ownIntentIds) {
              const intent = intentById.get(intentId);
              if (!intent) continue;
              const existing = counts.get(intentId) ?? {
                intentId,
                title: intent.summary?.trim() || intent.payload,
                count: 0,
              };
              existing.count += 1;
              counts.set(intentId, existing);
            }
          }
          return success({
            found: seen.size > 0,
            count: seen.size,
            bySignal: [...counts.values()],
          });
        },
        {
          name: "list_opportunities",
          description: "Report current opportunity counts by the user's own signal, without counterpart identities or rows.",
          schema: z.object({ networkId: z.string().uuid().optional() }).strict(),
        },
      );
    }

    return sharedTool;
  }) as ChatTools;
}

/** Creates the reporter's context-bound, allowlisted toolset. */
export async function createReporterTools(
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
  const allowed = filterReporterTools(await createChatTools(deps, resolvedContext)) as ChatTools;

  return narrowReporterTools(allowed, {
    context: resolvedContext,
    userDb,
    findPendingQuestions: deps.findPendingQuestions,
  });
}

/** Restricted read-only Agent reporter persona. */
export const REPORTER_PERSONA: ChatPersonaConfig = {
  id: REPORTER_PERSONA_ID,
  buildSystemContent: (ctx, iterCtx) => buildReporterSystemContent(ctx, iterCtx),
  createTools: (deps, preResolvedContext) => createReporterTools(deps, preResolvedContext),
  loopBehaviors: {
    createIntentCallback: false,
    hallucinationRecovery: false,
  },
};
