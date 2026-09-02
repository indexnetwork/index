/**
 * Discovery pipeline, terminal stage: emit candidates.
 *
 * Replaces the persist node. Discovery no longer creates opportunities — it
 * records the pairs it found, keyed by `pairKey`; opening one is a separate
 * decision.
 *
 * There is no dedup here, deliberately. The ~600 lines that used to live in
 * the persist node — the 30-day window, same-intent-pair suppression, latent
 * upgrades, orphan healing — existed because two discovery runs could each
 * INSERT a row for one pair. They cannot any more: the pair key is unique, so
 * the second run updates the first run's candidate instead of racing it.
 */

import { timed } from '../shared/observability/performance.js';
import { hasUnsupportedOpportunityClaim } from '../shared/utils/claim-safety.js';
import { pairKeyOf } from './opportunity.candidates.js';
import type { CreateDiscoveryMatchCandidateData } from './opportunity.candidates.js';
import type { Id } from '../../platform/database.js';
import { persistLog, type OpportunityGraphDeps, type OpportunityState } from './opportunity.graph.shared.js';

export async function emitCandidatesNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed('OpportunityGraph.emitCandidates', async () => {
    if (state.evaluatedOpportunities.length === 0) {
      persistLog.verbose('No candidates to emit', { triggerIntentId: state.triggerIntentId });
      return { candidatesEmitted: [] };
    }

    const items: CreateDiscoveryMatchCandidateData[] = [];
    for (const evaluated of state.evaluatedOpportunities) {
      const own = evaluated.actors.find((actor) => actor.userId === state.userId);
      const other = evaluated.actors.find((actor) => actor.userId !== state.userId);
      const networkId = (state.networkId ?? own?.networkId ?? other?.networkId) as Id<'networks'> | undefined;

      // A pair is two seated intents in one network. Anything else is not a
      // pair this model can open, so it is dropped rather than half-recorded.
      if (!own?.intentId || !other?.intentId || !networkId) {
        persistLog.warn('Dropping a match without two seated intents', {
          triggerIntentId: state.triggerIntentId,
          ownIntent: own?.intentId,
          otherIntent: other?.intentId,
          networkId,
        });
        continue;
      }

      // Same gate the persist node held: an unsupported affiliation or
      // presence claim must not reach a principal, and the reasoning is what
      // the candidate carries forward into the brief.
      if (hasUnsupportedOpportunityClaim(evaluated.reasoning)) {
        persistLog.warn('Skipping a match with an unsupported affiliation/presence claim', {
          triggerIntentId: state.triggerIntentId,
        });
        continue;
      }

      items.push({
        pairKey: pairKeyOf(networkId, own.intentId, other.intentId),
        networkId,
        intentA: own.intentId,
        intentB: other.intentId,
        userA: own.userId,
        userB: other.userId,
        score: evaluated.score,
        reasoning: evaluated.reasoning,
        evidence: evaluated.evidence ?? [],
      });
    }

    if (items.length === 0) return { candidatesEmitted: [] };

    const candidatesEmitted = await deps.database.upsertDiscoveryMatchCandidates(items);
    persistLog.info('Emitted discovery candidates', {
      triggerIntentId: state.triggerIntentId,
      count: candidatesEmitted.length,
    });

    return {
      candidatesEmitted,
      trace: [{
        node: 'emit_candidates',
        detail: `Emitted ${candidatesEmitted.length} candidate(s)`,
        data: { count: candidatesEmitted.length },
      }],
    };
  });
}

/** Trace summary for {@link emitCandidatesNode}. */
export function emitCandidatesTraceSummary(result: unknown): string | undefined {
  const emitted = (result as Record<string, unknown>)?.candidatesEmitted as unknown[] | undefined;
  return emitted ? `Emitted ${emitted.length} candidate(s)` : undefined;
}
