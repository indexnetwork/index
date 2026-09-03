/**
 * IND-610 — owner-only projection of a negotiation's outreach-gate decision.
 *
 * Deliberately a standalone, dependency-free module rather than a private
 * helper inside `conversation.database.adapter.ts`: this is the privacy
 * boundary that decides whether one user's agent's private reasoning about
 * another user is disclosed, and it must be provable without a live database.
 * Everything here is pure, so the guard is covered by hermetic tests that CI
 * actually runs, not only by DB-backed specs that require a disposable
 * database to exercise.
 *
 * `import type` only — nothing in this module pulls the drizzle client in.
 */
import type { ProjectedScreenDecision } from './database.shared';

/** The subset of the negotiation-outcome artifact this projection needs. */
export interface NegotiationOutcomeFacts {
  reason: string | null;
  reasoning: string | null;
}

/**
 * The user whose agent initiated the negotiation, and therefore the only user
 * entitled to the outreach-gate reasoning.
 *
 * `initiatorUserId` is the explicit field; `sourceUserId` is the pre-initiator
 * fallback for tasks written before it existed. Returns null rather than
 * `undefined` for a malformed task so a comparison against an equally
 * malformed viewer id can never accidentally succeed.
 */
export function readInitiatorUserId(metadata: Record<string, unknown>): string | null {
  if (typeof metadata.initiatorUserId === 'string' && metadata.initiatorUserId !== '') {
    return metadata.initiatorUserId;
  }
  if (typeof metadata.sourceUserId === 'string' && metadata.sourceUserId !== '') {
    return metadata.sourceUserId;
  }
  return null;
}

/**
 * Reads the named `tasks.metadata.screenDecision` fields written by the
 * outreach gate. READ-ONLY HISTORY: the gate is gone and nothing writes this
 * key any more, but negotiations that ran before its removal still carry it
 * and the owner's gate-decision card still renders them.
 *
 * Named-field projection only — the raw metadata blob is never returned, so
 * unrelated or internal keys on the task cannot leak through this surface.
 */
function readScreenDecisionRecord(metadata: Record<string, unknown>): ProjectedScreenDecision | null {
  const raw = metadata.screenDecision;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.decision !== 'pass' && record.decision !== 'reach_out') return null;
  const evidence = typeof record.evidence === 'object' && record.evidence !== null && !Array.isArray(record.evidence)
    ? record.evidence as Record<string, unknown>
    : {};
  const named = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
  return {
    source: 'screen',
    decision: record.decision,
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : '',
    intentAlignment: named(evidence.intentAlignment),
    screenedAt: named(record.screenedAt),
  };
}

/**
 * Picks the honest text for the decision, without regard to who is asking.
 *
 * Two distinct refusals collapse into the same `screened_out` outcome:
 * - the agent refused on its opening turn — the live route; the only reasoning
 *   lives on the negotiation-outcome artifact;
 * - HISTORICAL: the outreach gate passed before any contact — reasoning and
 *   structured evidence live on `tasks.metadata.screenDecision`. Nothing
 *   writes that key now, but rows from before its removal still hold one.
 *
 * When the outcome is `screened_out` but the screen record did not itself pass,
 * that record describes a decision which was *overtaken* by the opening
 * refusal, so the outcome reasoning wins; otherwise the richer screen record
 * does. `source` records which one, so the card never claims screen-node
 * evidence it does not have.
 */
function selectScreenDecision(
  metadata: Record<string, unknown>,
  outcome: NegotiationOutcomeFacts | null,
): ProjectedScreenDecision | null {
  const screenRecord = readScreenDecisionRecord(metadata);
  const outcomeReasoning = outcome?.reason === 'screened_out' ? (outcome.reasoning ?? '').trim() : '';
  const fromOutcome: ProjectedScreenDecision | null = outcomeReasoning === '' ? null : {
    source: 'outcome',
    // `screened_out` means, definitionally, that no outreach was ever made.
    decision: 'pass',
    reasoning: outcomeReasoning,
    intentAlignment: null,
    screenedAt: null,
  };

  if (fromOutcome && (!screenRecord || screenRecord.decision !== 'pass')) return fromOutcome;
  return screenRecord ?? fromOutcome;
}

/**
 * The owner gate. Returns the projected decision only when the viewer is the
 * negotiation's initiator, and null for everyone else.
 *
 * This check is deliberately independent, not inherited: the list query also
 * skips `screened_out` rows for non-initiators, but that skip is a *listing*
 * rule for one query. A conversation fetched directly, or any future caller of
 * this projection, must not depend on it for its privacy guarantee — so the
 * ownership comparison lives here, next to the data it protects.
 */
export function projectOwnerScreenDecision(
  metadata: Record<string, unknown>,
  outcome: NegotiationOutcomeFacts | null,
  viewerUserId: string | null | undefined,
): ProjectedScreenDecision | null {
  const initiatorUserId = readInitiatorUserId(metadata);
  if (initiatorUserId === null) return null;
  if (typeof viewerUserId !== 'string' || viewerUserId === '') return null;
  if (initiatorUserId !== viewerUserId) return null;
  return selectScreenDecision(metadata, outcome);
}
