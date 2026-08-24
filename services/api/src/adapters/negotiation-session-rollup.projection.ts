/**
 * Which of a conversation's negotiation task sessions represents it to a viewer.
 *
 * One durable A2A conversation is one counterparty pair, and it accumulates a
 * task session per opportunity the pair's agents have negotiated. The rail and
 * the your-move badge read a single `negotiation` lifecycle per conversation,
 * so the choice of session IS the row: its badge, its summary line, its
 * timestamp, and whether it counts toward "your move".
 *
 * The choice is dominated by liveness, not recency. A viewer with one session
 * awaiting their approval and any number of later screened-out ones has a live
 * row; recency only breaks ties within the same liveness tier. Picking the
 * newest task instead let a later rejection shadow an older pending approval:
 * the rail read "No match" while the Radar for the same pair said "Awaiting
 * you · 1", and the header read "0 your move".
 *
 * Pure and dependency-free so the rule is provable without a database.
 */
import { readInitiatorUserId } from './negotiation-lifecycle.projection';

export type NegotiationSessionLiveness =
  /** An opportunity awaits an owner's decision — the Radar's "Awaiting you". */
  | 'awaiting_approval'
  /** Parked `input_required`: a human was asked. Whose, the web decides from the session-scoped turn. */
  | 'parked'
  /** Agents are still exchanging turns, or the session has not started. */
  | 'in_progress'
  /** Accepted, declined, screened, stalled, expired, or failed. */
  | 'resolved';

const LIVENESS_RANK: Record<NegotiationSessionLiveness, number> = {
  awaiting_approval: 0,
  parked: 1,
  in_progress: 2,
  resolved: 3,
};

const TERMINAL_OPPORTUNITY_STATUSES = new Set(['accepted', 'rejected', 'stalled', 'expired']);
const TERMINAL_TASK_STATES = new Set(['completed', 'failed', 'canceled', 'rejected', 'auth_required']);
const STALL_REASONS = new Set(['turn_cap', 'timeout', 'agent_error']);

export interface NegotiationSessionCandidate {
  taskId: string;
  state: string;
  opportunityStatus: string | null;
  outcome: { hasOpportunity: boolean; reason: string | null } | null;
  metadata: Record<string, unknown>;
  createdAt: Date | string;
}

/**
 * Mirrors the precedence of the web's `deriveNegotiationPresentation`
 * (apps/web/src/lib/negotiation-presentation.ts) at tier granularity: an
 * opportunity's terminal status is authoritative over a stale task state, a
 * pending opportunity is awaiting an owner regardless of the task that
 * produced it, and a parked task is live until its opportunity closes.
 *
 * `awaiting_approval` ranks above `parked` deliberately. The server cannot see
 * which side a parked task is waiting on (that needs the session's last turn),
 * so if the two ever coexist for one pair, the pending approval — which is
 * unambiguously the viewer's move — must be the one that represents the row.
 */
export function negotiationSessionLiveness(candidate: Pick<NegotiationSessionCandidate, 'state' | 'opportunityStatus' | 'outcome'>): NegotiationSessionLiveness {
  const { state, opportunityStatus, outcome } = candidate;
  if (opportunityStatus && TERMINAL_OPPORTUNITY_STATUSES.has(opportunityStatus)) return 'resolved';
  if (outcome?.reason === 'agent_error') return 'resolved';
  if (opportunityStatus === 'latent' || opportunityStatus === 'draft') return 'in_progress';
  if (STALL_REASONS.has(outcome?.reason ?? '')) return 'resolved';
  if (opportunityStatus === 'pending' || outcome?.hasOpportunity === true) return 'awaiting_approval';
  if (state === 'input_required') return 'parked';
  if (outcome?.hasOpportunity === false || TERMINAL_TASK_STATES.has(state)) return 'resolved';
  return 'in_progress';
}

function timestampOf(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A screened-out outreach gate is private to the client that initiated it:
 * it is never projected to the counterparty through the shared conversation,
 * not even as the session that represents it.
 */
export function isNegotiationSessionVisibleTo(
  candidate: Pick<NegotiationSessionCandidate, 'outcome' | 'metadata'>,
  viewerUserId: string | null | undefined,
): boolean {
  if (candidate.outcome?.reason !== 'screened_out') return true;
  return readInitiatorUserId(candidate.metadata) === viewerUserId;
}

/**
 * Picks the session that represents a conversation to `viewerUserId`: the
 * most alive visible session, newest-created first within a tier (ties on the
 * same timestamp fall back to the larger task id, matching the previous
 * `ORDER BY created_at DESC, id DESC`). Null when the viewer may see none.
 */
export function selectRepresentedNegotiationSession<T extends NegotiationSessionCandidate>(
  candidates: readonly T[],
  viewerUserId: string | null | undefined,
): T | null {
  let best: T | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestCreatedAt = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isNegotiationSessionVisibleTo(candidate, viewerUserId)) continue;
    const rank = LIVENESS_RANK[negotiationSessionLiveness(candidate)];
    const createdAt = timestampOf(candidate.createdAt);
    const wins = best === null
      || rank < bestRank
      || (rank === bestRank && (createdAt > bestCreatedAt
        || (createdAt === bestCreatedAt && candidate.taskId > best.taskId)));
    if (!wins) continue;
    best = candidate;
    bestRank = rank;
    bestCreatedAt = createdAt;
  }
  return best;
}
