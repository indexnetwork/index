export interface NegotiationSpeakerParticipants {
  sourceUserId?: unknown;
  candidateUserId?: unknown;
  /**
   * The seat that opens this negotiation (v2 stamp). An unopened negotiation
   * starts with its initiator; `sourceUserId` is the pre-stamp fallback, which
   * is what the stamp defaults to anyway.
   */
  initiatorUserId?: unknown;
}

export interface NegotiationSpeakerMessage {
  senderId?: unknown;
  parts?: unknown;
}

function canonicalAction(message: NegotiationSpeakerMessage): string | null {
  if (!Array.isArray(message.parts)) return null;
  for (const part of message.parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const partRecord = part as Record<string, unknown>;
    if (partRecord.kind !== 'data' || !partRecord.data || typeof partRecord.data !== 'object' || Array.isArray(partRecord.data)) continue;
    const action = (partRecord.data as Record<string, unknown>).action;
    return typeof action === 'string' ? action : null;
  }
  return null;
}

function participantId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Resolves the participant whose agent owns the next canonical bilateral turn.
 *
 * `messages` must be THIS negotiation's messages (see
 * `getNegotiationMessages`), never the whole conversation. Two agents share one
 * DM across every match they are ever paired on, so conversation-scoped parity
 * makes a fresh negotiation inherit the turn order of an unrelated, concluded
 * one — handing the floor to the counterparty, who may `accept` immediately and
 * conclude the match before its initiator has spoken.
 *
 * Participant identities must be nonempty and distinct. Unrelated agent,
 * system, and owner-settlement messages are ignored while finding the latest
 * source/candidate message. An ordinary canonical message passes the floor to
 * the other participant; `ask_user` retains it for the consulting sender's
 * exact successor. A negotiation with no canonical history of its own has not
 * opened yet, so it starts with its initiator. Invalid participant metadata
 * always fails closed.
 */
export function expectedNegotiationSpeaker(
  participants: NegotiationSpeakerParticipants,
  messages: readonly NegotiationSpeakerMessage[],
): string | null {
  const source = participantId(participants.sourceUserId);
  const candidate = participantId(participants.candidateUserId);
  if (!source || !candidate || source === candidate) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const sender = message?.senderId === `agent:${source}`
      ? source
      : message?.senderId === `agent:${candidate}`
        ? candidate
        : null;
    if (!sender) continue;
    return canonicalAction(message) === 'ask_user'
      ? sender
      : sender === source ? candidate : source;
  }

  // Unopened: the initiator seat speaks first. Mirrors the
  // `initiatorUserId ?? sourceUserId` precedence in `resolveSeat`, and falls
  // back to source when the stamp is absent or names a non-participant.
  const initiator = participantId(participants.initiatorUserId);
  return initiator === candidate ? candidate : source;
}
