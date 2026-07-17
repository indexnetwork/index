/**
 * Lens B outcome feedback recorder (IND-434).
 *
 * Captures EXPLICIT owner opportunity actions (accept / reject) as idempotent,
 * append-only feedback events, then fires the shadow hypothesis-mining pass.
 * Injected into OpportunityService the same way the uptake guard is, so the
 * authoritative owner-action service paths gain capture with a single call and
 * no widening of the opportunity DB interface.
 *
 * Boundaries (privacy + correctness):
 *   - Only the two unambiguous owner decisions are recorded here; the service
 *     never calls this for send/pending, introducer approval, or any
 *     counterparty/agent/screening/timeout/merge/cascade/TTL/expiry transition
 *     (those never reach these service methods — they mutate status via the
 *     adapter/queues directly).
 *   - Scope is the exact recipient + triggering intent + intent fingerprint.
 *     Opportunities with no triggering intent are skipped (no scope to learn).
 *   - The stored snapshot is presentation-safe (sanitized reasoning summary);
 *     the counterpart is stored only as a non-reversible dedup hash.
 *   - Best-effort: every failure is swallowed with a warn so capture can never
 *     block or fail the user's action. Capture runs AFTER the status write
 *     returns, so a rolled-back action produces no event.
 *   - Gated on OUTCOME_QUESTIONS_MODE != off. Default off = zero writes.
 */
import { createHash } from 'node:crypto';

import { OUTCOME_MAX_PUBLIC_CONTEXT_CHARS, isOutcomeQuestionsActivated, safeFallbackSummary, type Opportunity, type OutcomeLabel } from '@indexnetwork/protocol';

import { log } from '../log';
import { computeIntentFingerprint } from '../intent/intent.fingerprint';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { appendOutcomeEvent } from './outcome-events.store';
import { maybeMineOutcomeHypotheses, type OutcomeMiningScope } from '../../queues/outcome/outcome.mining.shared';

const logger = log.service.from('OutcomeFeedbackRecorder');

/** One explicit owner action to record. */
export interface OutcomeFeedbackRecord {
  /** The full pre-write opportunity (source of intent, actors, reasoning). */
  opportunity: Opportunity;
  /** The owner (recipient) who took the action. */
  recipientUserId: string;
  /** The explicit owner decision. */
  action: OutcomeLabel;
}

export interface OutcomeFeedbackRecorderLike {
  record(input: OutcomeFeedbackRecord): Promise<void>;
}

/** SHA-256 hex of a canonical JSON tuple. */
function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Injectable collaborators (defaults wire the real adapters) for tests. */
export interface OutcomeFeedbackRecorderDeps {
  getIntent: (intentId: string) => Promise<{ payload: string; summary: string | null } | null>;
  append: typeof appendOutcomeEvent;
  triggerMine: (scope: OutcomeMiningScope) => void;
}

function defaultDeps(): OutcomeFeedbackRecorderDeps {
  return {
    getIntent: (intentId) => chatDatabaseAdapter.getIntent(intentId),
    append: appendOutcomeEvent,
    triggerMine: maybeMineOutcomeHypotheses,
  };
}

export class OutcomeFeedbackRecorder implements OutcomeFeedbackRecorderLike {
  constructor(private readonly deps: OutcomeFeedbackRecorderDeps = defaultDeps()) {}

  async record(input: OutcomeFeedbackRecord): Promise<void> {
    if (!isOutcomeQuestionsActivated()) return;

    try {
      const { opportunity: opp, recipientUserId, action } = input;

      const intentId = opp.detection?.triggeredBy;
      if (!intentId) return; // no triggering intent = no scope to learn from

      const intent = await this.deps.getIntent(intentId);
      if (!intent) return; // intent gone/archived — nothing safe to scope to

      const intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);

      const recipientActor = opp.actors.find((a) => a.userId === recipientUserId);
      const networkId = recipientActor?.networkId ?? null;

      // Related-opportunity dedup key: the counterpart identity (non-reversible
      // hash), or the opportunity itself when there is no counterpart.
      const counterpart = opp.actors.find(
        (a) => a.userId !== recipientUserId && a.role !== 'introducer',
      );
      const dedupKey = counterpart
        ? sha256(['counterpart', counterpart.userId])
        : sha256(['opportunity', opp.id]);

      // Presentation-safe, bounded candidate snapshot (no raw reasoning/UUIDs).
      const candidateSnapshot = safeFallbackSummary(opp.interpretation?.reasoning, {
        maxChars: OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
      });
      const snapshotHash = sha256(['snapshot', candidateSnapshot]);

      // One event per (recipient, opportunity, action) — retry-idempotent.
      const idempotencyKey = sha256(['outcome', recipientUserId, opp.id, action]);

      await this.deps.append({
        recipientUserId,
        intentId,
        intentFingerprint,
        opportunityId: opp.id,
        networkId,
        action,
        candidateSnapshot,
        snapshotHash,
        dedupKey,
        idempotencyKey,
      });

      // Fire-and-forget shadow mining for this exact scope.
      this.deps.triggerMine({ recipientUserId, intentId, intentFingerprint });
    } catch (error) {
      logger.warn('outcome feedback capture failed (non-blocking)', {
        opportunityId: input.opportunity?.id,
        action: input.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Shared singleton, mirroring uptakeAcceptanceGuard. */
export const outcomeFeedbackRecorder = new OutcomeFeedbackRecorder();
