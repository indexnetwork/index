/**
 * Discovery pipeline, terminal stage: open the pairs.
 *
 * Every pair becomes an opportunity with a negotiation record beside it. There
 * is no separate open decision: whether a match is worth pursuing is the
 * initiator's first turn, `propose` or `decline`, and a decline costs one model
 * turn and reaches no human.
 *
 * There is no dedup here, deliberately. The ~600 lines that used to live in
 * the persist node — the 30-day window, same-intent-pair suppression, latent
 * upgrades, orphan healing — existed because two discovery runs could each
 * INSERT a row for one pair. They cannot any more: the pair key is unique on
 * the negotiation, so the second run finds the first run's record.
 */

import { timed } from '../shared/observability/performance.js';
import { hasUnsupportedOpportunityClaim } from '../shared/utils/claim-safety.js';
import { pairKeyOf } from './opportunity.counterparties.js';
import type { CreateIntentCounterpartyData } from './opportunity.counterparties.js';
import type { Id } from '../../platform/database.js';
import { persistLog, type OpportunityGraphDeps, type OpportunityState } from './opportunity.graph.shared.js';

export async function emitCounterpartiesNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed('OpportunityGraph.emitCounterparties', async () => {
    if (state.evaluatedOpportunities.length === 0) {
      persistLog.verbose('No pairs to open', { triggerIntentId: state.triggerIntentId });
      return { opened: [] };
    }

    const pairs: CreateIntentCounterpartyData[] = [];
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
      // the pair carries forward into the brief.
      if (hasUnsupportedOpportunityClaim(evaluated.reasoning)) {
        persistLog.warn('Skipping a match with an unsupported affiliation/presence claim', {
          triggerIntentId: state.triggerIntentId,
        });
        continue;
      }

      pairs.push({
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

    if (pairs.length === 0) return { opened: [] };

    const opened = await deps.database.openCounterparties(pairs);
    persistLog.info('Opened discovery counterparties', {
      triggerIntentId: state.triggerIntentId,
      count: pairs.length,
      opened: opened.length,
    });

    return {
      opened,
      trace: [{
        node: 'emit_counterparties',
        detail: `Opened ${opened.length} of ${pairs.length} pair(s)`,
        data: { count: pairs.length, opened: opened.length },
      }],
    };
  });
}

/** Trace summary for {@link emitCounterpartiesNode}. */
export function emitCounterpartiesTraceSummary(result: unknown): string | undefined {
  const record = result as Record<string, unknown> | undefined;
  const opened = record?.opened as unknown[] | undefined;
  return opened ? `Opened ${opened.length} pair(s)` : undefined;
}
