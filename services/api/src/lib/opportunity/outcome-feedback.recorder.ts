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
 *   3. The caller is a genuine non-introducer actor on the opportunity.
 *   4. An exact selected intent must match a recipient actor; otherwise the
 *      recipient must have exactly one actor-intent scope. The resolved intent
 *      is re-read and confirmed owned by the recipient.
 *   5. Exactly one unique non-introducer counterpart exists. Multiparty,
 *      counterpart-less, and ambiguous opportunities are excluded.
 *   6. A genuine recipient-specific presenter snapshot already exists in the
 *      trusted presentation cache. Raw evaluator reasoning is never a fallback.
 *
 * The stored snapshot is presentation-approved and bounded; the sole
 * counterpart is stored only as a recipient-scoped, non-reversible hash.
 */
import { OUTCOME_MAX_PUBLIC_CONTEXT_CHARS, buildDeliveryCardPresentationCacheKey, buildHomeCardPresentationCacheKey, isOutcomeQuestionsActivated, stripUnsupportedOpportunityClaims, stripUuids, truncateAtBoundary, type Opportunity, type OutcomeLabel } from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { cacheAdapter } from '../../adapters/cache.adapter';
import { type OutcomeMiningScope, maybeMineOutcomeHypotheses } from '../../queues/outcome/outcome.mining.shared';
import type { NewOpportunityOutcomeEvent } from '../../schemas/database.schema';
import { computeIntentFingerprint } from '../intent/intent.fingerprint';
import { computeOutcomeCounterpartDedupKey, computeOutcomeIdempotencyKey, computeOutcomeSnapshotHash } from './outcome-feedback.identity';

/** Provenance of an owner action. Only a verified human session is eligible. */
export type OwnerActionProvenance = 'user_session' | 'api_key';

/** One explicit owner action to (maybe) record. */
export interface OutcomeFeedbackRecord {
  opportunity: Opportunity;
  recipientUserId: string;
  action: OutcomeLabel;
  provenance: OwnerActionProvenance;
  /** Exact selected-intent scope supplied by a scoped user action, when any. */
  selectedIntentId?: string;
}

export type OutcomeActorResolution = 'selected_intent' | 'unique_owned_scope';

/** A prepared, eligible capture: event + transaction precondition + mining scope. */
export interface PreparedOutcomeCapture {
  event: NewOpportunityOutcomeEvent;
  actorResolution: OutcomeActorResolution;
  scope: OutcomeMiningScope;
}

export interface OutcomeFeedbackRecorderLike {
  prepare(input: OutcomeFeedbackRecord): Promise<PreparedOutcomeCapture | null>;
  triggerMine(scope: OutcomeMiningScope): void;
}

interface CachedHomePresentation {
  opportunityId: string;
  mainText: string;
}

interface CachedDeliveryPresentation {
  opportunityId: string;
  personalizedSummary: string;
}

function normalizeApprovedSnapshot(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const safe = stripUuids(stripUnsupportedOpportunityClaims(value)).trim();
  if (!safe) return null;
  return truncateAtBoundary(safe, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS).trim() || null;
}

async function getCachedApprovedSnapshot(
  opportunity: Opportunity,
  recipientUserId: string,
): Promise<string | null> {
  try {
    const [home, delivery] = await cacheAdapter.mget<CachedHomePresentation | CachedDeliveryPresentation>([
      buildHomeCardPresentationCacheKey(opportunity.id, opportunity.status, recipientUserId),
      buildDeliveryCardPresentationCacheKey(opportunity.id, opportunity.status, recipientUserId),
    ]);
    if (home?.opportunityId === opportunity.id && 'mainText' in home) {
      const snapshot = normalizeApprovedSnapshot(home.mainText);
      if (snapshot) return snapshot;
    }
    if (delivery?.opportunityId === opportunity.id && 'personalizedSummary' in delivery) {
      return normalizeApprovedSnapshot(delivery.personalizedSummary);
    }
    return null;
  } catch {
    // Cache unavailability makes the event ineligible, never a reason to use
    // evaluator reasoning or to fail the underlying owner action.
    return null;
  }
}

/** Injectable collaborators (defaults wire the real adapters) for tests. */
export interface OutcomeFeedbackRecorderDeps {
  /** Raw intent read INCLUDING owner — must not enforce caller ownership itself. */
  getIntent: (intentId: string) => Promise<{ payload: string; summary: string | null; userId: string } | null>;
  /** Read only a previously cached, genuine recipient-facing presentation. */
  getApprovedCandidateSnapshot: (opportunity: Opportunity, recipientUserId: string) => Promise<string | null>;
  triggerMine: (scope: OutcomeMiningScope) => void;
}

function defaultDeps(): OutcomeFeedbackRecorderDeps {
  return {
    getIntent: (intentId) => chatDatabaseAdapter.getIntent(intentId),
    getApprovedCandidateSnapshot: getCachedApprovedSnapshot,
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
    if (input.provenance !== 'user_session') return null;

    const { opportunity, recipientUserId, action } = input;
    const recipientActors = opportunity.actors.filter(
      (actor) => actor.userId === recipientUserId && actor.role !== 'introducer',
    );
    if (recipientActors.length === 0) return null;

    let intentId: string;
    let actorResolution: OutcomeActorResolution;
    if (input.selectedIntentId) {
      if (!recipientActors.some((actor) => actor.intent === input.selectedIntentId)) return null;
      intentId = input.selectedIntentId;
      actorResolution = 'selected_intent';
    } else {
      const recipientIntentIds = [...new Set(
        recipientActors
          .map((actor) => actor.intent?.trim())
          .filter((value): value is string => Boolean(value)),
      )];
      if (recipientIntentIds.length !== 1) return null;
      [intentId] = recipientIntentIds;
      actorResolution = 'unique_owned_scope';
    }

    const intent = await this.deps.getIntent(intentId);
    if (!intent || intent.userId !== recipientUserId) return null;
    const intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);

    const participantIds = new Set(
      opportunity.actors
        .filter((actor) => actor.role !== 'introducer')
        .map((actor) => actor.userId),
    );
    if (participantIds.size !== 2 || !participantIds.has(recipientUserId)) return null;
    const counterpartUserId = [...participantIds].find((userId) => userId !== recipientUserId);
    if (!counterpartUserId) return null;
    const dedupKey = computeOutcomeCounterpartDedupKey(recipientUserId, counterpartUserId);

    const candidateSnapshot = await this.deps.getApprovedCandidateSnapshot(opportunity, recipientUserId);
    if (!candidateSnapshot) return null;
    const snapshotHash = computeOutcomeSnapshotHash(candidateSnapshot);
    const idempotencyKey = computeOutcomeIdempotencyKey({
      recipientUserId,
      intentId,
      intentFingerprint,
      opportunityId: opportunity.id,
      action,
    });

    const matchingNetworkIds = [...new Set(
      recipientActors
        .filter((actor) => actor.intent === intentId)
        .map((actor) => actor.networkId)
        .filter((value): value is string => Boolean(value)),
    )];
    const networkId = matchingNetworkIds.length === 1 ? matchingNetworkIds[0] : null;

    const event: NewOpportunityOutcomeEvent = {
      recipientUserId,
      intentId,
      intentFingerprint,
      opportunityId: opportunity.id,
      networkId,
      action,
      candidateSnapshot,
      snapshotHash,
      dedupKey,
      idempotencyKey,
    };

    return {
      event,
      actorResolution,
      scope: { recipientUserId, intentId, intentFingerprint },
    };
  }
}

export const outcomeFeedbackRecorder = new OutcomeFeedbackRecorder();
