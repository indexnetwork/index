// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA SELF-IDENTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every chat persona is the same thing to the user: their own agent. The app
// says so everywhere — the intent page column, the chat placeholder, /agents,
// /agent/memory. A persona that introduces itself by its toolset ("Signal
// Agent", "Onboarding Agent") tells the user they are talking to something
// else. The name comes from the user's `type='personal'` agent row, the same
// row the negotiator persona already reads.

/** Identity of the user's personal agent, as the persona should introduce it. */
export interface AgentIdentityOptions {
  /**
   * Display name from the user's `type='personal'` agent row. Absent only if
   * the row is somehow missing — `ensureNegotiatorAgent` runs at auth, so
   * every user has one from signup.
   */
  agentName?: string;
}

/**
 * Builds a persona's opening self-identification sentence.
 *
 * The nameless fallback stays generic on purpose: reintroducing a product noun
 * there would recreate exactly the mismatch this helper exists to remove.
 *
 * @param input - The agent's name, the user it works for, and the persona's role
 * @returns One sentence, e.g. `You are Ada's Agent, the private signals and profile assistant for Ada.`
 */
export function buildAgentSelfIntroduction(input: {
  agentName?: string;
  userName: string;
  /** Role phrase, without a leading article-free verb — e.g. "the restricted setup assistant". */
  role: string;
}): string {
  const name = input.agentName?.trim();
  return name
    ? `You are ${name}, ${input.role} for ${input.userName}.`
    : `You are ${input.userName}'s personal agent, ${input.role}.`;
}
