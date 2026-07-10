import { createChatTools, type ChatTools, type ToolContext, type ResolvedToolContext } from "../shared/agent/tool.factory.js";
import type { ChatPersonaConfig } from "./chat.persona.js";
import { buildNegotiatorSystemContent, type NegotiatorPromptOptions } from "./negotiator.prompt.js";

// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATOR PERSONA (P4.1)
// ═══════════════════════════════════════════════════════════════════════════════
//
// A pure persona addition on the P4.0 persona-neutral chat runtime: advocate
// prompt, client-scoped toolset, and all orchestrator loop behaviors OFF.
// Unlike the orchestrator (a static singleton), the negotiator persona is
// created per session because its identity comes from the user's
// `type='personal'` agent row (name/description).

/**
 * Persona id for the user's personal negotiator. Matches the
 * `conversations.persona` column value for negotiator DM sessions.
 */
export const NEGOTIATOR_PERSONA_ID = "negotiator";

/**
 * Client-scoped tool allowlist for the negotiator persona.
 *
 * Deliberately excludes every network-facing capability: no discovery
 * (`discover_opportunities`), no network/membership management, no profile or
 * intent writes, no contact import. This agent works for one client; as the
 * orchestrator sunsets, network-facing capabilities migrate here deliberately
 * (out of scope for P4.1).
 */
export const NEGOTIATOR_TOOL_NAMES = [
  "list_negotiations",
  "get_negotiation",
  "respond_to_negotiation",
  "list_opportunities",
  "read_intents",
  "read_premises",
] as const;

const NEGOTIATOR_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(NEGOTIATOR_TOOL_NAMES);

/**
 * Filters a full chat-tool registry down to the negotiator allowlist.
 * Exported separately so the scoping rule is unit-testable without
 * constructing the full tool factory dependency graph.
 */
export function filterNegotiatorTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((t) => NEGOTIATOR_TOOL_ALLOWLIST.has(t.name));
}

/**
 * Creates the negotiator persona's client-scoped toolset.
 *
 * Reuses the standard chat tool factory (so context resolution, scope
 * derivation, logging, and error handling stay identical) and filters the
 * registry to the allowlist. The negotiation tools are already context-bound
 * to `context.userId`, so every tool in this set can only read or act on the
 * calling client's own data.
 */
export async function createNegotiatorTools(
  deps: ToolContext,
  preResolvedContext?: ResolvedToolContext,
): Promise<ChatTools> {
  const tools = await createChatTools(deps, preResolvedContext);
  return filterNegotiatorTools(tools);
}

/**
 * Creates a negotiator `ChatPersonaConfig` bound to the client's personal
 * negotiator agent row identity.
 *
 * Loop behaviors are all OFF: no create-intent callback and no
 * hallucinated-block auto-invoke/strip — the negotiator's toolset cannot
 * legitimately produce opportunity/intent-proposal blocks, and it must never
 * inherit the orchestrator's discovery auto-invocation.
 *
 * @param opts - Identity from the user's `type='personal'` agent row
 */
export function createNegotiatorPersona(opts: NegotiatorPromptOptions): ChatPersonaConfig {
  return {
    id: NEGOTIATOR_PERSONA_ID,
    buildSystemContent: (ctx, iterCtx) => buildNegotiatorSystemContent(ctx, opts, iterCtx),
    createTools: (deps, preResolvedContext) => createNegotiatorTools(deps, preResolvedContext),
    loopBehaviors: {
      createIntentCallback: false,
      hallucinationRecovery: false,
    },
  };
}
