/**
 * Host bridge behind the negotiator persona's `reject_opportunity` and
 * `accept_opportunity` tools (#1471) — the owner's VERDICT lane.
 *
 * The owner makes three kinds of decision in their signal's DM. They ANSWER a
 * question a parked negotiation asked (#1466 gave that a lane). They EDIT the
 * signal (`update_intent` always had one). And they pass a VERDICT on a
 * counterparty — which had no lane at all. On 2026-08-20, in the DM of a
 * pairing parked on `input_required`, a client told their agent to reject the
 * counterparty. The agent could not: every verdict lever in the product was
 * the Radar card's Skip/Start-Chat and the REST endpoints behind them, and
 * `update_opportunity` — which is in the toolset — refuses a `negotiating`
 * pairing outright and fails the IND-593 owner-approval boundary on the chat
 * surface by design.
 *
 * Nothing is re-implemented here. The reject is the SAME
 * `opportunityService.updateOpportunityStatus(id, 'rejected', userId, …)` the
 * Radar's Skip page calls through `PATCH /opportunities/:id/status`, and the
 * accept is that call with `'accepted'`. Everything that hangs off an owner
 * verdict therefore happens exactly as it already does: the outcome hooks, the
 * DM resolution on accept, the contact memberships, and — via
 * `OpportunityEvents.onTransition` (main.ts) → `evaluateOpportunityTransition`
 * — the question-message regeneration that retires a dismissed pairing's open
 * question. A rejected pairing's question dies with it because that arrow
 * already exists on every status transition; this module deliberately does not
 * reach into it.
 *
 * Positions, never ids. The prompt lists this signal's actionable
 * counterparties, numbered; the tool hands back a number; this module owns the
 * mapping. A ref the model could name is a ref it could get wrong, and here a
 * wrong ref declines the wrong person — so the model is never given one, and
 * the successful result names WHO was acted on so the confirmation the client
 * reads comes from the write rather than from the model's belief about it.
 */
import type { OpportunityStatus } from '@indexnetwork/protocol';

import { opportunityService } from '../../services/opportunity.service';
import { log } from '../log';

const logger = log.lib.from('negotiator-verdict.host');

/**
 * Statuses a client can still pass a verdict on: the match is live and
 * undecided by them. `latent`/`draft` are pre-delivery, and `accepted` /
 * `rejected` / `expired` are already decided — a verdict on any of those would
 * be a decision the client has no reason to believe they are making.
 */
export const ACTIONABLE_VERDICT_STATUSES: OpportunityStatus[] = ['pending', 'negotiating', 'stalled'];

/** How each actionable status reads to the client, in one clause. */
const STATE_LINE: Record<string, string> = {
  pending: 'waiting on your decision',
  negotiating: 'your agents are still negotiating',
  stalled: 'parked, waiting on you',
};

/** One numbered counterparty, as both the prompt and the mapping see it. */
export interface ActionableCounterparty {
  /** 1-based, exactly as the prompt renders it and the tool names it. */
  position: number;
  opportunityId: string;
  /** Who the client would be deciding about. */
  name: string;
  status: string;
  /** The prompt line: name + one-line state. */
  label: string;
}

/** Structural slice of what the opportunity list returns for this purpose. */
interface ListedOpportunity {
  id: string;
  status: string;
  createdAt: Date | string;
  counterpartName?: string;
  actors?: Array<{ userId: string; role?: string }>;
}

/** Injectable seams; production resolves the real service. */
export interface NegotiatorVerdictHostDeps {
  listOpportunities?: (
    userId: string,
    options: { statuses: OpportunityStatus[]; scopeType: 'intent'; scopeId: string },
  ) => Promise<unknown[]>;
  updateStatus?: (
    opportunityId: string,
    status: OpportunityStatus,
    userId: string,
    options: { scopeType: 'intent'; scopeId: string },
  ) => Promise<unknown>;
}

/** Mirrors the protocol's `NegotiatorVerdictResult`; structural by design. */
export type NegotiatorVerdictResult =
  | { status: 'executed'; counterparty: string }
  | { status: 'none_actionable' }
  | { status: 'unknown_counterparty'; count: number; actionable: string[] }
  | { status: 'already_decided'; counterparty: string }
  | { status: 'error' };

export interface NegotiatorVerdictInput {
  intentId: string;
  counterparty: number;
  reason?: string;
}

const asTime = (value: Date | string): number => {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * This signal's actionable counterparties, numbered — the single ordering both
 * the prompt and the mapping read, so the number the client's agent was shown
 * is the number this module resolves.
 *
 * The order is OLDEST FIRST, deliberately. The list is rendered when the turn
 * starts and resolved when the tool fires, and in between a fresh match can
 * appear: ascending order appends it at the end instead of renumbering
 * everything above it, so a new arrival mid-turn cannot slide a different
 * person under the number the client's agent already read. (A pairing
 * CONCLUDING mid-turn still shifts what follows it; the write then lands on a
 * neighbour of the intended one, which is why the executed result names who it
 * hit and the persona is told to confirm by name.)
 *
 * Introducer rows are excluded: an introducer is not a party to the pairing,
 * and accept/reject is the parties' decision.
 *
 * Never throws — the prompt path treats an unreadable list as "no verdicts to
 * offer", which is strictly better than losing the turn.
 */
export async function readActionableCounterparties(
  userId: string,
  intentId: string,
  deps?: NegotiatorVerdictHostDeps,
): Promise<ActionableCounterparty[]> {
  try {
    const list = deps?.listOpportunities
      ?? ((uid: string, options: { statuses: OpportunityStatus[]; scopeType: 'intent'; scopeId: string }) =>
        opportunityService.getOpportunitiesForUser(uid, options));
    const rows = (await list(userId, {
      statuses: ACTIONABLE_VERDICT_STATUSES,
      scopeType: 'intent',
      scopeId: intentId,
    })) as ListedOpportunity[];

    return rows
      .filter((row) => {
        if (!row?.id || !ACTIONABLE_VERDICT_STATUSES.includes(row.status as OpportunityStatus)) return false;
        const own = row.actors?.find((actor) => actor.userId === userId);
        return !own || own.role !== 'introducer';
      })
      .sort((a, b) => asTime(a.createdAt) - asTime(b.createdAt) || a.id.localeCompare(b.id))
      .map((row, index) => {
        const name = row.counterpartName?.trim() || 'An unnamed match';
        const state = STATE_LINE[row.status] ?? row.status;
        return {
          position: index + 1,
          opportunityId: row.id,
          name,
          status: row.status,
          label: `${name} — ${state}`,
        };
      });
  } catch (err) {
    logger.error('negotiator_verdict_enumeration_failed', {
      userId,
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Execute one verdict on the number the client's agent named.
 *
 * Never throws — a tool that throws costs the client their turn, and the
 * honest failure the model is told to report is strictly better than that.
 */
async function passVerdict(
  userId: string,
  input: NegotiatorVerdictInput,
  target: 'rejected' | 'accepted',
  deps?: NegotiatorVerdictHostDeps,
): Promise<NegotiatorVerdictResult> {
  try {
    const actionable = await readActionableCounterparties(userId, input.intentId, deps);
    if (actionable.length === 0) return { status: 'none_actionable' };

    const relist = () => ({
      status: 'unknown_counterparty' as const,
      count: actionable.length,
      actionable: actionable.map((candidate) => candidate.label),
    });

    const chosen = actionable.find((candidate) => candidate.position === input.counterparty);
    if (!chosen) {
      logger.info('negotiator_verdict_unknown_counterparty', {
        userId,
        intentId: input.intentId,
        counterparty: input.counterparty,
        actionable: actionable.length,
      });
      return relist();
    }

    // The Radar's Skip/Start-Chat path, called exactly as the REST controller
    // calls it. The intent scope is not decoration: it re-checks that the
    // pairing really belongs to the signal this DM is pinned to, and it keeps
    // the accept from cascading onto sibling opportunities — the same
    // narrowing the intent-scoped Radar applies.
    //
    // `actionProvenance` is deliberately NOT passed. That field marks a verified
    // first-party owner CLICK for outcome capture (IND-434); a verdict spoken to
    // an agent is a real owner decision but a model-mediated one, and a
    // misheard "not this one" must not become a mined preference label.
    const update = deps?.updateStatus
      ?? ((opportunityId: string, status: OpportunityStatus, uid: string, options: { scopeType: 'intent'; scopeId: string }) =>
        opportunityService.updateOpportunityStatus(opportunityId, status, uid, options));
    const result = await update(chosen.opportunityId, target, userId, {
      scopeType: 'intent',
      scopeId: input.intentId,
    }) as { error?: string; status?: number } | null;

    if (result && typeof result === 'object' && 'error' in result && result.error) {
      // 409 is the self-accept guard: this client already committed, so it is
      // the other side's move. 403/404 means the pairing left the actionable
      // set between the list being rendered and this call — nothing was
      // decided, and re-listing is more use to the client than an error.
      if (result.status === 409) return { status: 'already_decided', counterparty: chosen.name };
      if (result.status === 403 || result.status === 404) return relist();
      logger.error('negotiator_verdict_rejected_by_service', {
        userId,
        intentId: input.intentId,
        opportunityId: chosen.opportunityId,
        target,
        serviceStatus: result.status,
        error: result.error,
      });
      return { status: 'error' };
    }

    logger.info('negotiator_verdict_executed', {
      userId,
      intentId: input.intentId,
      opportunityId: chosen.opportunityId,
      target,
      // The client's own words, when they gave any. There is no column for a
      // verdict reason on the owner path, and inventing one would be a new
      // write this lane has no mandate for — so the log is the record.
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return { status: 'executed', counterparty: chosen.name };
  } catch (err) {
    logger.error('negotiator_verdict_failed', {
      userId,
      intentId: input.intentId,
      counterparty: input.counterparty,
      target,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'error' };
  }
}

/** Decline one counterparty on the client's instruction — the Radar Skip path. */
export const rejectOpportunity = (
  userId: string,
  input: NegotiatorVerdictInput,
  deps?: NegotiatorVerdictHostDeps,
): Promise<NegotiatorVerdictResult> => passVerdict(userId, input, 'rejected', deps);

/** Accept one counterparty on the client's instruction — one side of two. */
export const acceptOpportunity = (
  userId: string,
  input: NegotiatorVerdictInput,
  deps?: NegotiatorVerdictHostDeps,
): Promise<NegotiatorVerdictResult> => passVerdict(userId, input, 'accepted', deps);

/** The host object the composition root injects into the negotiator toolset. */
export const negotiatorVerdictToolsHost = {
  rejectOpportunity: (userId: string, input: NegotiatorVerdictInput) => rejectOpportunity(userId, input),
  acceptOpportunity: (userId: string, input: NegotiatorVerdictInput) => acceptOpportunity(userId, input),
};
