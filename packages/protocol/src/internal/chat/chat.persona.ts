import type { ChatTools, ToolContext, ResolvedToolContext } from "../shared/agent/tool.factory.js";
import type { IterationContext } from "./chat.prompt.modules.js";

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT PERSONA CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
//
// The chat runtime (ChatAgent + ChatGraphFactory) is persona-neutral infrastructure:
// prompt, toolset, and loop behaviors are injected via a ChatPersonaConfig rather
// than hardcoded. There is no default — the caller binds the PersonalAgent persona
// (personal-agent.persona.ts) per session, and unknown personas fail closed.

/**
 * Behaviors that live in the agent loop itself (not in the prompt or toolset).
 * Each persona opts in explicitly.
 */
export interface ChatPersonaLoopBehaviors {
  /**
   * Detect hallucinated ```opportunity / ```intent_proposal code blocks in model
   * text, auto-invoke the corresponding tool, and strip unbacked blocks from the
   * final response. Only meaningful for personas whose toolset can legitimately
   * produce those blocks — enabled for the PersonalAgent persona.
   */
  hallucinationRecovery: boolean;
}

/**
 * Persona configuration injected into `ChatAgent.create()`.
 *
 * A persona bundles the three persona-coupled seams of the chat runtime:
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
  /**
   * Optionally resolves a turn without an LLM or tools. Use only for narrow,
   * deterministic safety redirects derived entirely from iteration context.
   */
  resolveDeterministicResponse?: (ctx: ResolvedToolContext, iterCtx: IterationContext) => string | null;
  /** Loop behaviors this persona opts into. */
  loopBehaviors: ChatPersonaLoopBehaviors;
}
