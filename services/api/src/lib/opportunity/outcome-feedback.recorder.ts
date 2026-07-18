/**
 * Lens B outcome feedback recorder (IND-434).
 *
 * Prepares an EXPLICIT owner opportunity decision (accept / reject) for
 * idempotent, append-only capture. The recorder is READ-ONLY: it verifies
 * provenance + scope and builds the event row, but the actual insert happens
 * atomically inside the winning owner-action transition (via the OutcomeOutbox
 * threaded through OpportunityService → the adapter). Mining is triggered by
 * the service only when a genuinely new row was inserted, after commit.
 *
 * Eligibility (fail-closed — any doubt ⇒ no capture):
 *   1. Flag OUTCOME_QUESTIONS_MODE != off.
 *   2. Provenance is a VERIFIED explicit human owner action ('user_session').
 *      Agent / API-key / system / internal callers never pass this, so their
 *      status mutations are never recorded as preferences (the generic
 *      MCP/agent graph path stays deferred to IND-438).
 *   3. The caller is a genuine non-introducer actor on the opportunity.
 *   4. The scope is the caller's OWN intent: the recipient actor's `intent`,
 *      re-read and confirmed owned by the recipient (intent.userId ===
 *      recipientUserId). A counterparty's intent, or a missing intent, is
 *      excluded.
 *   5. A deterministic canonical counterpart identity exists. Counterpart-less
 *      opportunities are skipped — there is no independence key, and the
 *      opportunity id must NEVER be used as one (it would make every event look
 *      independent).
 *
 * The stored snapshot is presentation-safe (sanitized reasoning summary); the
 * counterpart is stored only as a non-reversible dedup hash.
 */
import { createHash } from 'node:crypto';

import { OUTCOME_MAX_PUBLIC_CONTEXT_CHARS, isOutcomeQuestionsActivated, safeFallbackSummary, type Opportunity, type OutcomeLabel } from '@indexnetwork/protocol';

import { computeIntentFingerprint } from '../intent/intent.fingerprint';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import type { NewOpportunityOutcomeEvent } from '../../schemas/database.schema';
import { type OutcomeMiningScope, maybeMineOutcomeHypotheses } from '../../queues/outcome/outcome.mining.shared';

/**
 * Provenance of an owner action. Only a verified explicit human session may
 * become a preference label; every other principal is excluded upstream.
 */
export type OwnerActionProvenance = 'user_session' | 'api_key';

/** One explicit owner action to (maybe) record. */
export interface OutcomeFeedbackRecord {
  /** The full pre-write opportunity (source of intent, actors, reasoning). */
  opportunity: Opportunity;
  /** The owner (recipient) who took the action. */
  recipientUserId: string;
  /** The explicit owner decision. */
  action: OutcomeLabel;
  /** Verified provenance from the controller boundary. */
  provenance: OwnerActionProvenance;
}

/** A prepared, eligible capture: the event row + the mining scope to fire post-commit. */
export interface PreparedOutcomeCapture {
  event: NewOpportunityOutcomeEvent;
  scope: OutcomeMiningScope;
}

export interface OutcomeFeedbackRecorderLike {
  /** Build an eligible capture (read-only), or null when ineligible. */
  prepare(input: OutcomeFeedbackRecord): Promise<PreparedOutcomeCapture | null>;
  /** Fire the fire-and-forget shadow mining pass for a committed capture. */
  triggerMine(scope: OutcomeMiningScope): void;
}

/** SHA-256 hex of a canonical JSON tuple. */
function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Injectable collaborators (defaults wire the real adapters) for tests. */
export interface OutcomeFeedbackRecorderDeps {
  /** Raw intent read INCLUDING owner — must not enforce caller ownership itself. */
  getIntent: (intentId: string) => Promise<{ payload: string; summary: string | null; userId: string } | null>;
  triggerMine: (scope: OutcomeMiningScope) => void;
}

function defaultDeps(): OutcomeFeedbackRecorderDeps {
  return {
    getIntent: (intentId) => chatDatabaseAdapter.getIntent(intentId),
    triggerMine: maybeMineOutcomeHypotheses,
  };
}

export class OutcomeFeedbackRecorder implements OutcomeFeedbackRecorderLike {
  constructor(private readonly deps: OutcomeFeedbackRecorderDeps = defaultDeps()) {}

  triggerMine(scope: OutcomeMiningScope): void {
    this.deps.triggerMine(scope);
  }

  async prepare(input: OutcomeFeedbackRecord): Promise<PreparedOutcomeCapture | null> {
    if (!isOutcomeQuestionsActivated()) return null;
    // Only verified explicit human owner actions become labels.
    if (input.provenance !== 'user_session') return null;

    const { opportunity: opp, recipientUserId, action } = input;

    // The caller must be a genuine non-introducer actor on this opportunity.
    const recipientActor = opp.actors.find((a) => a.userId === recipientUserId);
    if (!recipientActor || recipientActor.role === 'introducer') return null;

    // Scope to the recipient's OWN intent (the intent they contributed to
    // this opportunity), never the counterparty-triggered intent.
    const intentId = recipientActor.intent;
    if (!intentId) return null;

    const intent = await this.deps.getIntent(intentId);
    if (!intent) return null; // intent gone — nothing safe to scope to
    // Ownership proof: the scoping intent must belong to the recipient.
    if (intent.userId !== recipientUserId) return null;

    const intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);

    // Deterministic canonical counterpart identity/set. No counterpart ⇒ no
    // independence key ⇒ skip (never fall back to the opportunity id).
    const counterpartIds = [
      ...new Set(
        opp.actors
          .filter((a) => a.userId !== recipientUserId && a.role !== 'introducer')
          .map((a) => a.userId),
      ),
    ].sort();
    if (counterpartIds.length === 0) return null;
    const dedupKey = sha256(['counterpart-set', ...counterpartIds]);

    const networkId = recipientActor.networkId ?? null;

    // Presentation-safe, bounded candidate snapshot (no raw reasoning/UUIDs).
    const candidateSnapshot = safeFallbackSummary(opp.interpretation?.reasoning, {
      maxChars: OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
    });
    const snapshotHash = sha256(['snapshot', candidateSnapshot]);

    // One event per (recipient, opportunity, action) — retry-idempotent.
    const idempotencyKey = sha256(['outcome', recipientUserId, opp.id, action]);

    const event: NewOpportunityOutcomeEvent = {
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
    };

    return { event, scope: { recipientUserId, intentId, intentFingerprint } };
  }
}

/** Shared singleton, mirroring uptakeAcceptanceGuard. */
export const outcomeFeedbackRecorder = new OutcomeFeedbackRecorder();
