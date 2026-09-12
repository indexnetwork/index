import { requestContext } from '../core/runtime.js';
import type { RunOptions } from '../core/types.js';
import { evaluationNode } from './candidate.evaluator.js';
import { rankingNode, rankingTraceSummary } from './candidate.ranking.js';
import { discoveryNode, discoveryTraceSummary } from './candidate.retrieval.js';
import { DISCOVERY_MIN_SIMILARITY, validateDiscoveryMinSimilarity } from './discovery.constants.js';
import { prepNode, prepTraceSummary, resolveNode, resolveTraceSummary, scopeNode, scopeTraceSummary } from './discovery.preparation.js';
import type { DiscoveryDeps, DiscoveryInput, DiscoveryState, PotentialIntentPair } from './discovery.state.js';
import { withNodeTrace } from './discovery.trace.js';
import { hasUnsupportedOpportunityClaim } from './match.verifier.js';

/** Plain async discovery. The host owns every protocol mutation after discovery. */
export class Discovery {
  private readonly deps: DiscoveryDeps;

  constructor(deps: Omit<DiscoveryDeps, 'retrievalMinSimilarity'> & { retrievalMinSimilarity?: number }) {
    this.deps = { ...deps, retrievalMinSimilarity: validateDiscoveryMinSimilarity(deps.retrievalMinSimilarity ?? DISCOVERY_MIN_SIMILARITY) };
  }

  /**
   * @param input - Discoverer, intent/query, and requested network scope.
   * @param options - Cancellation and tracing, isolated to this run.
   * @returns Potential intent pairs and discovery diagnostics, with no opportunities committed.
   * @throws On cancellation; ordinary stage failures are reported in `error`.
   */
  discover(input: DiscoveryInput, options: RunOptions = {}): Promise<DiscoveryState & { pairs: PotentialIntentPair[] }> {
    return requestContext.run(options, async () => {
      const state: DiscoveryState = {
        ...input, options: input.options ?? {}, indexedIntents: [], userNetworks: [], targetNetworks: [],
        networkRelevancyScores: {}, discoverySource: 'intent', sourceProfile: null, resolvedIntentInNetwork: false,
        candidates: [], evaluatedOpportunities: [], trace: [], agentTimings: [],
      };
      const apply = async (
        name: string,
        step: (state: DiscoveryState, deps: DiscoveryDeps) => Promise<Partial<DiscoveryState>>,
        summary?: (result: unknown) => string | undefined,
      ) => {
        options.signal?.throwIfAborted();
        const result = await withNodeTrace(name, (s: DiscoveryState) => step(s, this.deps), summary)(state);
        const trace = [...state.trace, ...(result.trace ?? [])];
        const agentTimings = [...state.agentTimings, ...(result.agentTimings ?? [])];
        Object.assign(state, result, { trace, agentTimings });
        options.signal?.throwIfAborted();
      };
      await apply('opportunity-prep', prepNode, prepTraceSummary);
      if (!state.error) await apply('opportunity-scope', scopeNode, scopeTraceSummary);
      if (!state.error && state.targetNetworks.length) {
        await apply('opportunity-resolve', resolveNode, resolveTraceSummary);
        if (!state.error) await apply('opportunity-discovery', discoveryNode, discoveryTraceSummary);
        if (!state.error) await apply('opportunity-evaluation', evaluationNode);
        if (!state.error) await apply('opportunity-ranking', rankingNode, rankingTraceSummary);
      }

      const pairs: PotentialIntentPair[] = [];
      for (const evaluated of state.evaluatedOpportunities) {
        const own = evaluated.actors.find(actor => actor.userId === state.userId);
        const other = evaluated.actors.find(actor => actor.userId !== state.userId);
        const networkId = state.networkId ?? own?.networkId ?? other?.networkId;
        if (!own?.intentId || !other?.intentId || !networkId || hasUnsupportedOpportunityClaim(evaluated.reasoning)) continue;
        pairs.push({
          networkId, intentA: own.intentId, intentB: other.intentId, userA: own.userId, userB: other.userId,
          score: evaluated.score, reasoning: evaluated.reasoning, evidence: evaluated.evidence ?? [],
        });
      }
      return { ...state, pairs };
    });
  }
}
