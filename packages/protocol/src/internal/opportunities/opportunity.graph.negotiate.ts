/**
 * Discovery pipeline, stage 7: post-persist negotiation.
 *
 * For each persisted opportunity, kicks off (or resumes) its negotiation by
 * invoking `NegotiationGraph` with `{ opportunityId, brief, intentId, round }`
 * — the graph's own `open` path creates the negotiation and takes the first
 * turn (writing the opportunity to `negotiating` itself), or is a no-op if
 * one already exists for that opportunity. This node never writes opportunity
 * status itself — the graph owns that write, including on the error path,
 * where an unconditional write here would strand a failed-init opportunity
 * at `negotiating` or clobber a reactivated one. Nothing here waits for a
 * verdict: negotiations pause and resolve asynchronously, through their own
 * invokes, not through this node.
 *
 * A round is this kickoff batch, not one opportunity: every opportunity
 * sharing an intentId in this batch shares one round, bumped once per
 * intentId before any of that intentId's opens run — otherwise every
 * negotiation would be its own round of one, and reflect would fire at the
 * very first pause instead of waiting for the batch.
 *
 * `brief` is a minimal deterministic string built from the trigger intent —
 * IS-A authors real briefs from the DM once it lands (step 2 of the
 * personal-agent-and-negotiation-graphs plan).
 */

import type { OpportunityActor } from '../../platform/database.js';
import { resolveOpportunityActorIntent } from './opportunity.actor.js';
import { negotiateLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/**
 * Node 3b: Negotiate (post-persist)
 */
export async function negotiateNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  if (!deps.negotiationGraph) return {};
  if (!state.opportunities || state.opportunities.length === 0) return {};

  const discoveryUserId = state.userId as string;
  const triggerIntent = (state.indexedIntents ?? []).find((intent) => intent.intentId === state.triggerIntentId);
  const brief = triggerIntent
    ? `Opened from a signal: ${triggerIntent.summary ?? triggerIntent.payload}`
    : 'Opened by discovery.';

  const kickoffs = state.opportunities
    .map((opp) => {
      const actors = opp.actors as OpportunityActor[];
      const introducers = actors.filter((a) => a.role === 'introducer');
      if (introducers.length > 0 && !introducers.every((a) => a.approved === true)) return null;

      const sourceActor = actors.find((a) => a.userId === discoveryUserId && a.role !== 'introducer');
      const candidateActor = actors.find((a) => a.userId !== discoveryUserId && a.role !== 'introducer');
      if (!sourceActor || !candidateActor) return null;

      const intentId = resolveOpportunityActorIntent(sourceActor) ?? state.triggerIntentId;
      if (!intentId) return null;

      return { opportunityId: opp.id as string, intentId };
    })
    .filter((entry): entry is { opportunityId: string; intentId: string } => entry !== null);

  const roundByIntentId = new Map<string, Promise<number>>();
  const roundFor = (intentId: string): Promise<number> => {
    let round = roundByIntentId.get(intentId);
    if (!round) {
      round = deps.database.bumpIntentNegotiationRound(intentId);
      roundByIntentId.set(intentId, round);
    }
    return round;
  };

  await Promise.all(kickoffs.map(async ({ opportunityId, intentId }) => {
    try {
      const round = await roundFor(intentId);
      await deps.negotiationGraph!.invoke({ opportunityId, brief, intentId, round });
    } catch (err) {
      negotiateLog.error('Failed to kick off negotiation', { opportunityId, intentId, error: err });
    }
  }));

  return {
    trace: [{
      node: 'negotiate',
      detail: `${kickoffs.length} of ${state.opportunities.length} opportunit(y/ies) kicked off`,
      data: { candidateCount: state.opportunities.length, kickedOff: kickoffs.length },
    }],
  };
}
