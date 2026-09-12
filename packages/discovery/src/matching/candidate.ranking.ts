import { timed } from '../core/runtime.js';
import type { DiscoveryState, EvaluatedOpportunity } from './discovery.state.js';
import { rankingLog } from './discovery.trace.js';

/**
 * Node 4: Ranking
 * Sorts evaluated opportunities by score, applies limit, dedupes by actor-set hash.
 */
export async function rankingNode(state: DiscoveryState) {
  return timed("OpportunityGraph.ranking", async () => {
    rankingLog.verbose('Starting ranking', {
      evaluatedCount: state.evaluatedOpportunities.length,
    });

    try {
      const sorted = [...state.evaluatedOpportunities].sort((a, b) => b.score - a.score);
      const ranked = state.options.limit != null ? sorted.slice(0, state.options.limit) : sorted;

      const actorSetKey = (opp: EvaluatedOpportunity) =>
        opp.actors
          .map((a) => `${a.userId}:${a.networkId}`)
          .sort()
          .join('|');
      const seen = new Set<string>();
      const deduplicated = ranked.filter((opp) => {
        const key = actorSetKey(opp);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      rankingLog.verbose('Ranking complete', {
        sorted: sorted.length,
        afterLimit: ranked.length,
        afterDedup: deduplicated.length,
      });
      return { evaluatedOpportunities: deduplicated };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      rankingLog.error('Failed', { error });
      return {
        evaluatedOpportunities: [],
        error: 'Failed to rank opportunities.',
        trace: [{
          node: "ranking_fatal",
          detail: `Ranking failed: ${errMsg}`,
          data: { error: errMsg },
        }],
      };
    }
  });
}

/** Trace summary for {@link rankingNode}. */
export function rankingTraceSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  if (r?.error) return `error: ${r.error}`;
  const opps = r?.evaluatedOpportunities as unknown[];
  return opps ? `Ranked ${opps.length} opportunity(ies)` : undefined;
}
