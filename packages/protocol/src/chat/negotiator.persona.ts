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
 * P4.5 (IND-413) expanded this from the read-mostly P4.1 set: with direct
 * opportunity discovery retiring alongside the orchestrator, discovery is
 * purely signal-based — so the negotiator (the surviving personal-agent chat
 * surface) manages the client's signals, profile knowledge, memberships, and
 * contacts.
 *
 * Still deliberately excluded:
 * - discovery runs (`discover_opportunities`, `get/cancel_discovery_run`) —
 *   retired capability; matching happens in the background from signals,
 * - whole-network administration (`create/update/delete_network`) — a
 *   human/UI act for now (joins/leaves are allowed),
 * - onboarding plumbing (`complete_onboarding`,
 *   `record_onboarding_privacy_consent`),
 * - agent management (`register/update/delete_agent`, permission grants),
 * - `confirm_opportunity_delivery` (OpenClaw ledger write, never chat).
 */
export const NEGOTIATOR_TOOL_NAMES = [
  // Negotiation record — the advocate core (P4.1)
  "list_negotiations",
  "get_negotiation",
  "respond_to_negotiation",
  "list_opportunities",
  "update_opportunity",
  // Signals — the input surface of signal-based discovery (P4.5)
  "read_intents",
  "create_intent",
  "update_intent",
  "delete_intent",
  "search_intents",
  "read_intent_indexes",
  "create_intent_index",
  "delete_intent_index",
  // Profile knowledge (P4.5)
  "read_user_contexts",
  "create_user_context",
  "update_user_context",
  "confirm_user_context",
  "preview_user_context",
  // Premises (P4.5; read was already in P4.1)
  "read_premises",
  "create_premise",
  "update_premise",
  "retract_premise",
  // Networks — joins/leaves only, no network administration (P4.5)
  "read_networks",
  "read_network_memberships",
  "create_network_membership",
  "delete_network_membership",
  // Contacts — dormant while CONTACTS_ENABLED=false (P4.5)
  "list_contacts",
  "search_contacts",
  "add_contact",
  "remove_contact",
  "import_contacts",
  "import_gmail_contacts",
  // Utility — create_intent's own contract instructs scraping pasted URLs
  // before synthesizing a signal description (P4.5)
  "scrape_url",
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
 * Loop behaviors (P4.5):
 * - `hallucinationRecovery: true` — with `create_intent` in the toolset the
 *   model can legitimately produce ```intent_proposal blocks, so unbacked
 *   blocks must be detected/auto-invoked/stripped. The auto-invoke path is
 *   confirm-safe: `create_intent` returns a proposal card that persists
 *   nothing until the client approves it in the UI. A hallucinated
 *   ```opportunity block maps to `discover_opportunities`, which is absent
 *   from this toolset — the loop falls back to a correction message and the
 *   final-response strip still removes the unbacked block.
 * - `createIntentCallback: false` — discovery-coupled (fires only off
 *   `discover_opportunities` results); retired along with direct discovery.
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
      hallucinationRecovery: true,
    },
  };
}
