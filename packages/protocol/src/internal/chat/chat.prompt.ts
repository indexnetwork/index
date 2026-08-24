// ═══════════════════════════════════════════════════════════════════════════════
// SHARED CHAT-LOOP PROMPT FRAGMENTS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Persona-neutral prompt text owned by the agent loop rather than by any one
// persona. The persona builds its own system prompt (see
// personal-agent.prompt.ts); what remains here is only what the loop itself
// injects regardless of persona.

/**
 * Nudge message injected after SOFT_ITERATION_LIMIT iterations.
 */
export const ITERATION_NUDGE = `[System Note: You've made several tool calls. Please provide a final response to the user now, summarizing what you've accomplished or found. If you need more information from the user, ask for it in your response.]`;
