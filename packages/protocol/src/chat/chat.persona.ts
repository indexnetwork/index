import { createChatTools, type ChatTools, type ToolContext, type ResolvedToolContext } from "../shared/agent/tool.factory.js";
import { buildSystemContent } from "./chat.prompt.js";
import type { IterationContext } from "./chat.prompt.modules.js";

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT PERSONA CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
//
// The chat runtime (ChatAgent + ChatGraphFactory) is persona-neutral infrastructure:
// prompt, toolset, and orchestrator-specific loop behaviors are injected via a
// ChatPersonaConfig rather than hardcoded. The orchestrator is the default (and
// currently only) registered persona — its config is exactly the pre-refactor
// wiring, so behavior is byte-identical for existing chat sessions.
//
// Future personas (e.g. the per-user negotiator, P4.1) provide their own prompt
// builder and toolset, and default all orchestrator loop behaviors OFF.

/**
 * Orchestrator-specific behaviors that live in the agent loop itself
 * (not in the prompt or toolset). Each persona opts in explicitly.
 */
export interface ChatPersonaLoopBehaviors {
  /**
   * When `discover_opportunities` returns `createIntentSuggested`, auto-invoke
   * `create_intent` and then re-run `discover_opportunities` with the original
   * arguments.
   */
  createIntentCallback: boolean;
  /**
   * Detect hallucinated ```opportunity / ```intent_proposal code blocks in model
   * text, auto-invoke the corresponding tool, and strip unbacked blocks from the
   * final response. Only meaningful for personas whose toolset can legitimately
   * produce those blocks.
   */
  hallucinationRecovery: boolean;
}

/**
 * Persona configuration injected into `ChatAgent.create()`.
 *
 * A persona bundles the three orchestrator-coupled seams of the chat runtime:
 * system-prompt construction, toolset creation, and loop behaviors.
 */
export interface ChatPersonaConfig {
  /**
   * Stable persona identifier. Matches the `conversations.persona` column value
   * for sessions driven by this persona.
   */
  id: string;
  /** Builds the system prompt for each agent-loop iteration. */
  buildSystemContent: (ctx: ResolvedToolContext, iterCtx: IterationContext) => string;
  /** Creates the persona's toolset bound to the resolved user context. */
  createTools: (deps: ToolContext, preResolvedContext?: ResolvedToolContext) => Promise<ChatTools>;
  /** Orchestrator-specific loop behaviors this persona opts into. */
  loopBehaviors: ChatPersonaLoopBehaviors;
}

/** Persona id for the default orchestrator ("You are Index…"). */
export const ORCHESTRATOR_PERSONA_ID = "orchestrator";

/**
 * The orchestrator persona — exactly the pre-personafication wiring:
 * `buildSystemContent` from chat.prompt, `createChatTools` from tool.factory,
 * and all loop behaviors enabled.
 *
 * Both functions delegate lazily (arrow wrappers) instead of capturing the
 * imported symbols at module-load time. This preserves ESM live-binding
 * semantics: the pre-refactor code read `createChatTools` through its import
 * binding at call time, which is what lets test suites swap the module via
 * `mock.module` — a snapshot in this object literal would pin whichever
 * version was loaded first.
 */
export const ORCHESTRATOR_PERSONA: ChatPersonaConfig = {
  id: ORCHESTRATOR_PERSONA_ID,
  buildSystemContent: (ctx, iterCtx) => buildSystemContent(ctx, iterCtx),
  createTools: (deps, preResolvedContext) => createChatTools(deps, preResolvedContext),
  loopBehaviors: {
    createIntentCallback: true,
    hallucinationRecovery: true,
  },
};
