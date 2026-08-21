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
 * `userName` is optional because not every surface names its client. The chat
 * personas run inside a resolved tool context and always have it; the
 * IntentAgent's unattended loop speaks of "your client" from end to end and
 * never resolves a display name, so it supplies a role phrase that already
 * says whose agent this is and omits the name rather than reading the user
 * row for one word.
 *
 * @param input - The agent's name, the user it works for, and the persona's role
 * @returns One sentence, e.g. `You are Ada's Agent, the private signals and profile assistant for Ada.`
 */
export function buildAgentSelfIntroduction(input: {
  agentName?: string;
  userName?: string;
  /** Role phrase, without a leading article-free verb — e.g. "the restricted setup assistant". */
  role: string;
}): string {
  const name = input.agentName?.trim();
  const client = input.userName?.trim();
  if (name) {
    return client ? `You are ${name}, ${input.role} for ${client}.` : `You are ${name}, ${input.role}.`;
  }
  return client ? `You are ${client}'s personal agent, ${input.role}.` : `You are ${input.role}.`;
}
