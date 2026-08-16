export interface NegotiationSpeakerParticipants {
  sourceUserId?: unknown;
  candidateUserId?: unknown;
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
 * Participant identities must be nonempty and distinct. Unrelated agent,
 * system, and owner-settlement messages are ignored while finding the latest
 * source/candidate message. An ordinary canonical message passes the floor to
 * the other participant; `ask_user` retains it for the consulting sender's
 * exact successor. A valid conversation with no canonical history starts with
 * the source participant. Invalid participant metadata always fails closed.
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

  return source;
}
