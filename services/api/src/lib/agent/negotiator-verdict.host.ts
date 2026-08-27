/**
 * Host bridge behind the negotiator persona's `reject_opportunity` and
 * `accept_opportunity` tools (#1471) — the owner's VERDICT lane.
 *
 * The owner makes two kinds of decision in their signal's DM. They EDIT the
 * signal (`update_intent` always had one). And they pass a VERDICT on a
 * counterparty — which had no lane at all. On 2026-08-20, in the DM of a
 * pairing still being negotiated, a client told their agent to reject the
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
 * DM resolution on accept, and the contact memberships. This module
 * deliberately does not reach into any other status-transition side effect.
 *
 * Positions, never ids. The prompt lists this signal's actionable
 * counterparties, numbered; the tool hands back a number; this module owns the
 * mapping. A ref the model could name is a ref it could get wrong, and here a
 * wrong ref declines the wrong person — so the model is never given one, and
 * the successful result names WHO was acted on so the confirmation the client
 * reads comes from the write rather than from the model's belief about it.
 */
import type { OpportunityStatus, PersonalAgentMatch } from '@indexnetwork/protocol';
import { opportunityRef } from '@indexnetwork/protocol';

import { discoveryCandidateAdapter } from '../../adapters/discovery-candidate.database.adapter';

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

/**
 * What the PersonalAgent sees as "this signal's matches": everything not yet
 * decided. Wider than the verdict set because kickoff reaches out to matches
 * discovery has only just persisted (`latent`), which no verdict could land
 * on yet. A verdict named against one of those resolves to
 * `unknown_counterparty` and is reported honestly.
 */
export const PERSONAL_AGENT_MATCH_STATUSES: OpportunityStatus[] = ['negotiating', 'stalled', 'pending'];

/** How each actionable status reads to the client, in one clause. */
const STATE_LINE: Record<string, string> = {
  found: 'found, not contacted yet',
  pending: 'waiting on your decision',
  negotiating: 'your agents are still negotiating',
  stalled: 'paused',
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
  /** Ordering key for the union with pending candidates. */
  createdAt: Date | string;
}

/** Structural slice of what the opportunity list returns for this purpose. */
interface ListedOpportunity {
  id: string;
  status: string;
  createdAt: Date | string;
  counterpartName?: string;
  actors?: Array<{ userId: string; role?: string; approved?: boolean }>;
}

/** Injectable seams; production resolves the real service. */
export interface NegotiatorVerdictHostDeps {
  /** This signal's pairs discovery found and nobody has opened yet. */
  listPendingCandidates?: (
    userId: string,
    intentId: string,
  ) => Promise<Array<{ id: string; createdAt: Date; counterpartName?: string }>>;
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

/** Verdict named by opportunity id — the IntentAgent's lane (phase 2). */
export interface NegotiatorVerdictByIdInput {
  intentId: string;
  opportunityId: string;
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
 * THROWS. Every caller that reasons over this list — the PersonalAgent's
 * every turn — must see a read failure as a failure, not as an empty signal.
 * {@link readActionableCounterparties} is the degrading wrapper, for the tool
 * surfaces that would rather offer nothing than lose a turn.
 */
export async function readSignalMatches(
  userId: string,
  intentId: string,
  deps?: NegotiatorVerdictHostDeps,
  /** Widened by the PersonalAgent, which also reaches out to undecided matches. */
  statuses: OpportunityStatus[] = ACTIONABLE_VERDICT_STATUSES,
): Promise<ActionableCounterparty[]> {
  {
    const list = deps?.listOpportunities
      ?? ((uid: string, options: { statuses: OpportunityStatus[]; scopeType: 'intent'; scopeId: string }) =>
        opportunityService.getOpportunitiesForUser(uid, options));
    const rows = (await list(userId, {
      statuses,
      scopeType: 'intent',
      scopeId: intentId,
    })) as ListedOpportunity[];

    return rows
      .filter((row) => {
        if (!row?.id || !statuses.includes(row.status as OpportunityStatus)) return false;
        return true;
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
          createdAt: row.createdAt,
          label: `${name} — ${state}`,
        };
      });
  }
}

/**
 * Everything this signal's PersonalAgent may act on: the pairs discovery found
 * and has not opened, plus the opportunities already open.
 *
 * `ActionableCounterparty` is deliberately NOT widened to carry a candidate.
 * That type is the verdict lane's, over real rows — a verdict on a pair nobody
 * has opened would be a decision about nothing. The union lives here, at the
 * one seam that feeds the agent.
 *
 * OLDEST FIRST, and that is a contract. The prompt renders this list numbered
 * and the agent's tool call names a position, so a match arriving mid-turn
 * must append rather than slide a different person under a number the agent
 * already read.
 *
 * THROWS, on either read. The agent's every turn is about this list; a
 * swallowed failure is a turn that decides nothing and reports success.
 */
export async function readPersonalAgentMatches(
  userId: string,
  intentId: string,
  deps?: NegotiatorVerdictHostDeps,
): Promise<PersonalAgentMatch[]> {
  const readCandidates = deps?.listPendingCandidates
    ?? ((uid: string, iid: string) => discoveryCandidateAdapter.listPendingCandidatesForIntent(uid, iid));

  const [opportunities, candidates] = await Promise.all([
    readSignalMatches(userId, intentId, deps, PERSONAL_AGENT_MATCH_STATUSES),
    readCandidates(userId, intentId),
  ]);

  const entries = [
    ...candidates.map((candidate) => ({
      sortAt: asTime(candidate.createdAt),
      sortId: candidate.id,
      match: {
        ref: { kind: 'candidate' as const, id: candidate.id },
        label: `${candidate.counterpartName?.trim() || 'An unnamed match'} — ${STATE_LINE.found}`,
        status: 'found',
      } satisfies PersonalAgentMatch,
    })),
    ...opportunities.map((counterparty) => ({
      sortAt: asTime(counterparty.createdAt),
      sortId: counterparty.opportunityId,
      match: {
        ref: opportunityRef(counterparty.opportunityId),
        label: counterparty.label,
        status: counterparty.status,
      } satisfies PersonalAgentMatch,
    })),
  ];

  return entries
    .sort((a, b) => a.sortAt - b.sortAt || a.sortId.localeCompare(b.sortId))
    .map((entry) => entry.match);
}

/**
 * The same list, for a surface that would rather show nothing than lose a
 * turn: the persona/MCP verdict tools render it as the options a tool call may
 * name, and an unreadable list there honestly means "no verdicts to offer".
 *
 * This swallow is NOT for the PersonalAgent. Its turns are ABOUT this list —
 * a reflect that reads `[]` from a transient database error decides nothing,
 * succeeds, and permanently consumes that drain generation's retained job.
 * That lane calls {@link readSignalMatches} and lets the error propagate.
 */
export async function readActionableCounterparties(
  userId: string,
  intentId: string,
  deps?: NegotiatorVerdictHostDeps,
  statuses: OpportunityStatus[] = ACTIONABLE_VERDICT_STATUSES,
): Promise<ActionableCounterparty[]> {
  try {
    return await readSignalMatches(userId, intentId, deps, statuses);
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
 * Execute one verdict on a counterparty already resolved from the actionable
 * list. Shared by the position lane (persona/MCP tools) and the id lane (the
 * IntentAgent's acts) so there is exactly one write path and one honest
 * classification of its failures.
 */
async function executeVerdictOn(
  userId: string,
  intentId: string,
  chosen: ActionableCounterparty,
  target: 'rejected' | 'accepted',
  relist: () => Extract<NegotiatorVerdictResult, { status: 'unknown_counterparty' }>,
  deps?: NegotiatorVerdictHostDeps,
  reason?: string,
): Promise<NegotiatorVerdictResult> {
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
    //
    // Ending the pairing's live negotiation is part of that same call now
    // (D23): the service closes the negotiation task through the graph's
    // `resolve` after a terminal flip, so a verdict spoken here can no longer
    // leave the task `working` and hold its round's reflect trigger open.
    const update = deps?.updateStatus
      ?? ((opportunityId: string, status: OpportunityStatus, uid: string, options: { scopeType: 'intent'; scopeId: string }) =>
        opportunityService.updateOpportunityStatus(opportunityId, status, uid, options));
  const result = await update(chosen.opportunityId, target, userId, {
    scopeType: 'intent',
    scopeId: intentId,
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
      intentId,
      opportunityId: chosen.opportunityId,
      target,
      serviceStatus: result.status,
      error: result.error,
    });
    return { status: 'error' };
  }

  logger.info('negotiator_verdict_executed', {
    userId,
    intentId,
    opportunityId: chosen.opportunityId,
    target,
    // The client's own words, when they gave any. There is no column for a
    // verdict reason on the owner path, and inventing one would be a new
    // write this lane has no mandate for — so the log is the record.
    ...(reason ? { reason } : {}),
  });
  return { status: 'executed', counterparty: chosen.name };
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
    // NARROW, deliberately. This lane resolves a 1-BASED POSITION the caller
    // was shown, and the tool's own contract calls it "the signal's actionable
    // list". Widening the set here renumbers every entry, so the position the
    // client's agent read would land on a different person — the exact failure
    // this module's header exists to prevent. Widening is safe only on the id
    // lane below, which resolves by opportunity id and cannot be renumbered.
    const actionable = await readActionableCounterparties(userId, input.intentId, deps, ACTIONABLE_VERDICT_STATUSES);
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

    return await executeVerdictOn(userId, input.intentId, chosen, target, relist, deps, input.reason);
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

/**
 * Execute one verdict on an opportunity the caller already holds the id of —
 * the IntentAgent's lane (phase 2). The agent's context numbered THIS list
 * (the same reader) and its validator resolved the number to the id, so the
 * id re-checks membership here rather than trusting the earlier read: an
 * opportunity that left the actionable set between context assembly and this
 * call gets a re-list, exactly as a stale position does on the tool lane.
 *
 * Never throws — the act's outcome is ledgered either way, and an honest
 * failure beats a lost turn.
 */
export async function passVerdictOnOpportunity(
  userId: string,
  input: NegotiatorVerdictByIdInput,
  target: 'rejected' | 'accepted',
  deps?: NegotiatorVerdictHostDeps,
): Promise<NegotiatorVerdictResult> {
  try {
    // WIDE, deliberately: the SAME set the PersonalAgent's context numbered.
    // Re-listing the narrower verdict set made "accept the first one" before
    // kickoff always answer `unknown_counterparty`, for a `latent` match
    // `opportunityService` accepts perfectly well. Safe here and only here,
    // because this lane resolves by opportunity id — no position to shift.
    const actionable = await readActionableCounterparties(userId, input.intentId, deps, PERSONAL_AGENT_MATCH_STATUSES);
    if (actionable.length === 0) return { status: 'none_actionable' };

    const relist = () => ({
      status: 'unknown_counterparty' as const,
      count: actionable.length,
      actionable: actionable.map((candidate) => candidate.label),
    });

    const chosen = actionable.find((candidate) => candidate.opportunityId === input.opportunityId);
    if (!chosen) {
      logger.info('negotiator_verdict_opportunity_left_actionable_set', {
        userId,
        intentId: input.intentId,
        opportunityId: input.opportunityId,
        actionable: actionable.length,
      });
      return relist();
    }

    return await executeVerdictOn(userId, input.intentId, chosen, target, relist, deps, input.reason);
  } catch (err) {
    logger.error('negotiator_verdict_failed', {
      userId,
      intentId: input.intentId,
      opportunityId: input.opportunityId,
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
