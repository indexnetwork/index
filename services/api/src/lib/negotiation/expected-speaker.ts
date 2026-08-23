/**
 * Host-side mirror of `NegotiationGraph`'s own `nextSpeaker` algorithm
 * (packages/protocol/src/internal/negotiations/negotiation.graph.ts).
 *
 * Every surface has to agree on this: it is used only for the pickup/claim
 * seat check (deciding whether the claiming external agent is actually the
 * negotiation's next speaker) — the graph's own `apply` node is the
 * authoritative writer and computes this independently for every turn.
 */
export interface NegotiationSpeakerMessage {
  senderId: string;
  parts: unknown;
}

function isPauseTurnData(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { verb?: unknown }).verb === 'pause';
}

function stringField(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

/** Whose turn is next: retry the last speaker after a pause, else the other seat; the initiator opens. */
export function expectedNegotiationSpeaker(
  metadata: Record<string, unknown>,
  messages: NegotiationSpeakerMessage[],
): string | undefined {
  const initiatorUserId = stringField(metadata, 'initiatorUserId') ?? stringField(metadata, 'sourceUserId');
  const sourceUserId = stringField(metadata, 'sourceUserId');
  const candidateUserId = stringField(metadata, 'candidateUserId');
  const last = messages[messages.length - 1];
  if (!last) return initiatorUserId;
  const part = (last.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === 'data');
  const lastSpeakerId = last.senderId.replace(/^agent:/, '');
  if (part && isPauseTurnData(part.data)) return lastSpeakerId;
  return lastSpeakerId === sourceUserId ? candidateUserId : sourceUserId;
}

/** The negotiation's identity for scoping a turn-history read — its opportunity, when task-backed. */
export function negotiationScopeKey(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || metadata.type !== 'negotiation') return null;
  return typeof metadata.opportunityId === 'string' ? metadata.opportunityId : null;
}
