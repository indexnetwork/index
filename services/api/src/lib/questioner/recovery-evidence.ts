import { computeIntentFingerprint } from '../intent/intent.fingerprint';

export interface RecoveryEvidenceOpportunity {
  id: string;
  status?: string | null;
  actors: Array<{ userId: string; role: string; networkId?: string | null }>;
  context?: { networkId?: string | null } | null;
}

export interface RecoveryEvidenceTask {
  id: string;
  state: string;
  metadata: Record<string, unknown> | null;
}

export interface RecoveryEvidenceArtifact {
  name: string | null;
  parts: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedCounterpartyUserId(
  opportunity: RecoveryEvidenceOpportunity,
  recipientUserId: string,
): string | null {
  const participantIds = new Set(opportunity.actors
    .filter((actor) => actor.role !== 'introducer')
    .map((actor) => actor.userId));
  if (participantIds.size !== 2 || !participantIds.has(recipientUserId)) return null;
  return [...participantIds].find((candidate) => candidate !== recipientUserId) ?? null;
}

function capturedIntentFingerprint(
  metadata: Record<string, unknown>,
  recipientUserId: string,
  intentId: string,
): string | null {
  if (!Array.isArray(metadata.intentSnapshots)) return null;
  const matches = metadata.intentSnapshots.filter((snapshot) => isRecord(snapshot)
    && snapshot.userId === recipientUserId
    && snapshot.intentId === intentId);
  if (matches.length !== 1) return null;
  const snapshot = matches[0];
  if (typeof snapshot.description !== 'string' || typeof snapshot.title !== 'string') return null;
  return computeIntentFingerprint(snapshot.description, snapshot.title);
}

function validateTaskProvenance(input: {
  task: RecoveryEvidenceTask;
  opportunityId: string;
  recipientUserId: string;
  counterpartyUserId: string;
  intentId: string;
  currentIntentFingerprint: string;
}): { networkId: string } | null {
  const metadata = input.task.metadata;
  if (!metadata
    || metadata.type !== 'negotiation'
    || metadata.opportunityId !== input.opportunityId
    || typeof metadata.networkId !== 'string'
    || metadata.networkId.length === 0
    || typeof metadata.sourceUserId !== 'string'
    || typeof metadata.candidateUserId !== 'string'
    || metadata.sourceUserId === metadata.candidateUserId) return null;
  const participants = new Set([metadata.sourceUserId, metadata.candidateUserId]);
  if (participants.size !== 2
    || !participants.has(input.recipientUserId)
    || !participants.has(input.counterpartyUserId)) return null;
  if (capturedIntentFingerprint(metadata, input.recipientUserId, input.intentId)
    !== input.currentIntentFingerprint) return null;
  return { networkId: metadata.networkId };
}

function readDataPart(parts: unknown): Record<string, unknown> | null {
  if (!Array.isArray(parts)) return null;
  const dataParts = parts.filter((part) => isRecord(part) && part.kind === 'data' && isRecord(part.data));
  return dataParts.length === 1 ? dataParts[0].data as Record<string, unknown> : null;
}

/**
 * Fail-closed projection of one rejected negotiation to a boolean. This is the
 * privacy-minimal extraction of the Lens-C task/snapshot/network precedent:
 * callers may retain only a bounded aggregate count of `true` results.
 */
export function hasValidatedRejectedNoOpportunityEvidence(input: {
  opportunity: RecoveryEvidenceOpportunity;
  tasks: RecoveryEvidenceTask[];
  artifactsByTaskId: ReadonlyMap<string, RecoveryEvidenceArtifact[]>;
  recipientUserId: string;
  intentId: string;
  currentIntentFingerprint: string;
}): boolean {
  if (input.opportunity.status !== 'rejected') return false;
  const counterpartyUserId = validatedCounterpartyUserId(input.opportunity, input.recipientUserId);
  if (!counterpartyUserId) return false;

  const qualifying = input.tasks.filter((task) => {
    if (task.state !== 'completed') return false;
    const provenance = validateTaskProvenance({
      task,
      opportunityId: input.opportunity.id,
      recipientUserId: input.recipientUserId,
      counterpartyUserId,
      intentId: input.intentId,
      currentIntentFingerprint: input.currentIntentFingerprint,
    });
    if (!provenance) return false;
    if (input.opportunity.context?.networkId
      && input.opportunity.context.networkId !== provenance.networkId) return false;
    for (const participantId of [input.recipientUserId, counterpartyUserId]) {
      if (!input.opportunity.actors.some((actor) => actor.role !== 'introducer'
        && actor.userId === participantId
        && actor.networkId === provenance.networkId)) return false;
    }

    const outcomeArtifacts = (input.artifactsByTaskId.get(task.id) ?? [])
      .filter((artifact) => artifact.name === 'negotiation-outcome');
    if (outcomeArtifacts.length !== 1) return false;
    return readDataPart(outcomeArtifacts[0].parts)?.hasOpportunity === false;
  });

  // Multiple qualifying continuations are ambiguous for one opportunity count.
  return qualifying.length === 1;
}
