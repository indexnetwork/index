import { createHash } from 'node:crypto';

import type { OutcomeLabel } from '@indexnetwork/protocol';

/** SHA-256 hex of a canonical, versioned JSON tuple. */
function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Non-reversible, recipient-scoped identity for one unique counterpart. */
export function computeOutcomeCounterpartDedupKey(
  recipientUserId: string,
  counterpartUserId: string,
): string {
  return sha256(['outcome-counterpart-v1', recipientUserId, counterpartUserId]);
}

/** Content hash for the exact presentation-approved snapshot stored in an event. */
export function computeOutcomeSnapshotHash(candidateSnapshot: string): string {
  return sha256(['outcome-snapshot-v1', candidateSnapshot]);
}

/**
 * Retry identity for one explicit decision in one exact intent revision.
 * Material intent edits deliberately create a new identity namespace.
 */
export function computeOutcomeIdempotencyKey(input: {
  recipientUserId: string;
  intentId: string;
  intentFingerprint: string;
  opportunityId: string;
  action: OutcomeLabel;
}): string {
  return sha256([
    'outcome-event-v2',
    input.recipientUserId,
    input.intentId,
    input.intentFingerprint,
    input.opportunityId,
    input.action,
  ]);
}

/** True only for canonical lowercase SHA-256 hex values. */
export function isOutcomeHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
