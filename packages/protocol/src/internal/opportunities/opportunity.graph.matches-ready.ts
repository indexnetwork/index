/**
 * Discovery pipeline, stage 7: matches_ready.
 *
 * Discovery no longer opens negotiations. It persists the batch and emits ONE
 * `matches_ready` event per signal that got matches; the signal's
 * PersonalAgent decides whether to reach out at all, writes the strategy into
 * the DM, derives a brief per match and kicks them off itself
 * (docs/plans/2026-08-23-personal-agent-and-negotiation-graphs.md, "IS-A
 * decides to kick off negotiations; they are not automatically kicked off").
 *
 * One event per intent, not per opportunity: kickoff is a batch, and a
 * per-opportunity event would give the agent one round of one negotiation
 * each time — reflect would then fire at the very first pause.
 */

import type { OpportunityActor } from '../../platform/database.js';
import { resolveOpportunityActorIntent } from './opportunity.actor.js';
import { matchesReadyLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/**
 * Node 3b: matches_ready (post-persist)
 */
export async function matchesReadyNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  if (!deps.matchesReady) return {};
  if (!state.opportunities || state.opportunities.length === 0) return {};

  const discoveryUserId = state.userId as string;
  const intentIds = new Set<string>();
  for (const opportunity of state.opportunities) {
    const actors = opportunity.actors as OpportunityActor[];
    const introducers = actors.filter((a) => a.role === 'introducer');
    if (introducers.length > 0 && !introducers.every((a) => a.approved === true)) continue;

    const sourceActor = actors.find((a) => a.userId === discoveryUserId && a.role !== 'introducer');
    const candidateActor = actors.find((a) => a.userId !== discoveryUserId && a.role !== 'introducer');
    if (!sourceActor || !candidateActor) continue;

    const intentId = resolveOpportunityActorIntent(sourceActor) ?? state.triggerIntentId;
    if (intentId) intentIds.add(intentId);
  }

  await Promise.all([...intentIds].map(async (intentId) => {
    try {
      await deps.matchesReady!({ userId: discoveryUserId, intentId });
    } catch (err) {
      matchesReadyLog.error('Failed to emit matches_ready', { intentId, userId: discoveryUserId, error: err });
    }
  }));

  return {
    trace: [{
      node: 'matches_ready',
      detail: `${intentIds.size} signal(s) notified for ${state.opportunities.length} opportunit(y/ies)`,
      data: { candidateCount: state.opportunities.length, signals: intentIds.size },
    }],
  };
}
