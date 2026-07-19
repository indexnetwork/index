import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createChatTools, type ChatTools, type ResolvedToolContext, type ToolContext } from "../shared/agent/tool.factory.js";
import type { ChatPersonaConfig } from "./chat.persona.js";
import { buildSignalSystemContent } from "./signal.prompt.js";

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

/**
 * Filters shared chat tools through Signal Agent's positive allowlist.
 *
 * @param tools - Shared context-bound chat tools
 * @returns Only explicitly approved Signal Agent tools
 */
export function filterSignalTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((tool) => SIGNAL_TOOL_ALLOWLIST.has(tool.name));
}

/**
 * Narrows schemas and handlers whose shared versions expose broader modes than
 * Signal Agent is allowed to use.
 *
 * @param allowed - Name-allowlisted shared chat tools
 * @returns Signal-safe tools with self-only reads and proposal-only creation
 */
export function narrowSignalTools(allowed: ChatTools): ChatTools {
  return allowed.map((sharedTool) => {
    if (sharedTool.name === "create_intent") {
      return tool(
        async (query: { description: string; networkId?: string }) => sharedTool.invoke({
          ...query,
          // Signal web chats always use the confirmation-safe proposal path.
          autoApprove: false,
        }) as Promise<string>,
        {
          name: "create_intent",
          description:
            "Draft a new signal for the current user. Returns an intent_proposal card that must be passed through verbatim and approved in the web UI before persistence.",
          schema: z.object({
            description: z.string().trim().min(1).describe("Clear, specific signal description."),
            networkId: z.string().optional().describe("Optional existing-membership community UUID."),
          }),
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
        async (query: { query: string; limit?: number }) => sharedTool.invoke(query) as Promise<string>,
        {
          name: "search_intents",
          description: "Search the current user's own active signals by text.",
          schema: z.object({
            query: z.string().trim().min(1),
            limit: z.number().int().min(1).max(100).optional(),
          }),
        },
      );
    }

    if (sharedTool.name === "read_intent_indexes") {
      return tool(
        async (query: { intentId: string; networkId: string }) => sharedTool.invoke(query) as Promise<string>,
        {
          name: "read_intent_indexes",
          description: "Check whether one of the current user's signals is assigned to one existing-membership community.",
          schema: z.object({
            intentId: z.string().uuid(),
            networkId: z.string().uuid(),
          }),
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
  const allowed = filterSignalTools(
    await createChatTools(deps, preResolvedContext),
  ) as ChatTools;
  return narrowSignalTools(allowed);
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
