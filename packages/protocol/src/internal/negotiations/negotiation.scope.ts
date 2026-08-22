/**
 * The boundary between a negotiation and the conversation it runs in.
 *
 * Two agents share one DM permanently — `getOrCreateDM` keys on the agent pair
 * alone — so that conversation accumulates every negotiation the pair has ever
 * had. A negotiation is a bounded episode about ONE match inside it.
 *
 * Every question about a negotiation's own state (whose turn it is, whether it
 * has opened, how many turns it has run) must be answered from the
 * negotiation's messages. Conversation-wide reads remain valid for CONTEXT —
 * what the pair discussed before — but must never decide state, or a fresh
 * match inherits the turn parity of an unrelated concluded one.
 *
 * Every surface that resolves the floor shares this rule. If the graph and the
 * respond/polling surfaces disagreed about a negotiation's scope, an external
 * agent would be told it is not its turn forever.
 */

/** Minimal task-metadata shape needed to identify a negotiation. */
export interface NegotiationScopeMetadata {
  opportunityId?: unknown;
}

/**
 * The opportunity a negotiation belongs to, or null when the task carries no
 * opportunity. Keyed on opportunity rather than task because an `ask_user`
 * pause resumes into a successor task: both tasks' turns are one negotiation.
 */
export function negotiationScopeKey(
  metadata: NegotiationScopeMetadata | null | undefined,
): string | null {
  const id = metadata?.opportunityId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Reads the messages that constitute one negotiation.
 *
 * A task with no opportunity has no identity separate from its conversation
 * (direct and legacy invocations), so the conversation is its scope — there is
 * no other match it could be confused with.
 */
export async function readNegotiationMessages<M>(
  readers: {
    byNegotiation: (opportunityId: string) => Promise<M[]>;
    byConversation: (conversationId: string) => Promise<M[]>;
  },
  scope: {
    conversationId: string;
    metadata: NegotiationScopeMetadata | null | undefined;
  },
): Promise<M[]> {
  const opportunityId = negotiationScopeKey(scope.metadata);
  return opportunityId
    ? readers.byNegotiation(opportunityId)
    : readers.byConversation(scope.conversationId);
}
