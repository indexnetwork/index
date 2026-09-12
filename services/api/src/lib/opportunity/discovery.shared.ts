import { Artifacts, Matchmaking, MatchExplainer, ModelClient } from '@indexnetwork/matchmaking';
import type { ArtifactStore, MatchmakingData, MatchmakingInput, MatchmakingState, PotentialIntentPair } from '@indexnetwork/matchmaking';
import { decideNegotiationOpening, pairKeyOf, requestContext, resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '@indexnetwork/protocol';
import type { OpenedNegotiation } from '@indexnetwork/protocol';

import type { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';

import { log } from '../log';

type DiscoveryLogger = ReturnType<typeof log.job.from>;
export type DiscoveryDatabase = Pick<ChatDatabaseAdapter,
  | 'getNetworkMemberships' | 'getActiveIntents' | 'getProfile' | 'getIntent'
  | 'getNetworkIdsForIntent' | 'getNetwork' | 'getNetworkMemberCount' | 'getIntentNetworkScores'
  | 'getActiveNetworkMembershipPairs' | 'getRecentlyRejectedOpportunityCounterparties' | 'isNetworkOwner'
  | 'getHydeDocument' | 'saveHydeDocument' | 'openCounterparties'
>;

/** The API supplies infrastructure; the library owns generation, cache identity and retrieval. */
export function createArtifacts(database: ArtifactStore) {
  return new Artifacts({
    database, embedder: new EmbedderAdapter(), cache: new RedisCacheAdapter(),
    model: new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
  });
}

/** Resolve protocol rules using live host reads, without coupling matchmaking to protocol. */
export function createMatchmakingData(database: DiscoveryDatabase): MatchmakingData {
  return {
    getNetworkMemberships: userId => database.getNetworkMemberships(userId),
    getActiveIntents: userId => database.getActiveIntents(userId),
    getProfile: userId => database.getProfile(userId),
    getIntent: intentId => database.getIntent(intentId),
    getNetworkIdsForIntent: intentId => database.getNetworkIdsForIntent(intentId),
    getNetwork: networkId => database.getNetwork(networkId),
    getNetworkMemberCount: networkId => database.getNetworkMemberCount(networkId),
    getIntentNetworkScores: intentId => database.getIntentNetworkScores(intentId),
    getActiveNetworkMembershipPairs: pairs => database.getActiveNetworkMembershipPairs(pairs),
    getRecentlyRejectedOpportunityCounterparties: (userId, candidates, windowMs) => database.getRecentlyRejectedOpportunityCounterparties(userId, candidates, windowMs),
    getDiscoveryScope: async input => resolveDiscoveryNetworkScope({
      userNetworkIds: input.userNetworks, networkId: input.networkId, networkScope: input.networkScope,
      ownsRequestedNetwork: !!input.networkId && !input.userNetworks.includes(input.networkId)
        && await database.isNetworkOwner(input.networkId, input.userId),
      triggerIntentNetworkIds: input.triggerIntentId ? await database.getNetworkIdsForIntent(input.triggerIntentId) : undefined,
    }),
    getNetworkContexts: async networkIds => {
      const contexts: Record<string, string> = {};
      await Promise.all(networkIds.map(async id => {
        const network = await database.getNetwork(id);
        if (!network) return;
        const context = renderDiscoveryNetworkContext(network);
        if (context !== undefined) contexts[id] = context;
      }));
      return contexts;
    },
  };
}

/** Commit potential pairs using protocol identity and opening rules inside the existing transaction. */
export async function openMatchmakingPairs(database: Pick<DiscoveryDatabase, 'openCounterparties'>, pairs: PotentialIntentPair[], logger: DiscoveryLogger) {
  const context = requestContext.getStore();
  context?.abortSignal?.throwIfAborted();
  if (!pairs.length) return [];
  const started = Date.now();
  context?.traceEmitter?.({ type: 'agent_start', name: 'opportunity-emit-counterparties' });
  try {
    const opened = await database.openCounterparties(pairs.map(pair => ({
      ...pair, pairKey: pairKeyOf(pair.networkId, pair.intentA, pair.intentB),
    })), decideNegotiationOpening);
    logger.info('Opened discovery counterparties', { count: pairs.length, opened: opened.length });
    context?.traceEmitter?.({ type: 'agent_end', name: 'opportunity-emit-counterparties', durationMs: Date.now() - started, summary: `Opened ${opened.length} pair(s)` });
    return opened;
  } catch (error) {
    context?.traceEmitter?.({ type: 'agent_end', name: 'opportunity-emit-counterparties', durationMs: Date.now() - started, summary: 'Opening counterparties failed' });
    throw error;
  }
}

export type OpportunityDiscoveryCompletionReason =
  | 'created_or_reactivated'
  | 'no_search_candidates'
  | 'evaluator_rejected_all'
  | 'persistence_zero_other';

export interface OpportunityDiscoverySummary {
  candidatesFound: number;
  evaluatedCount: number;
  opportunitiesCreated: number;
  completionReason: OpportunityDiscoveryCompletionReason;
  /** Negotiations this run opened; each owes its initiator a first turn. */
  opened: OpenedNegotiation[];
}

/** Derive a stable zero-output reason without exposing candidate details. */
export function summarizeOpportunityDiscoveryResult(
  result: Pick<MatchmakingState, 'candidates' | 'evaluatedOpportunities'> & { opened: OpenedNegotiation[] },
): OpportunityDiscoverySummary {
  const { candidates, evaluatedOpportunities, opened } = result;
  const evaluatedCount = evaluatedOpportunities.length;
  const completionReason: OpportunityDiscoveryCompletionReason = opened.length > 0
    ? 'created_or_reactivated'
    : candidates.length === 0
      ? 'no_search_candidates'
      : evaluatedCount === 0
        ? 'evaluator_rejected_all'
        : 'persistence_zero_other';

  return {
    candidatesFound: candidates.length,
    evaluatedCount,
    opportunitiesCreated: opened.length,
    completionReason,
    opened,
  };
}

/** Run matchmaking, then commit pairs before discovery is marked successful. */
export async function runOpportunityDiscovery<T extends MatchmakingInput>(params: {
  database: DiscoveryDatabase;
  deps?: { invokeMatchmaking?: (opts: T) => Promise<void> };
  invokeOpts: T;
  logger: DiscoveryLogger;
  logContext: Record<string, unknown>;
}): Promise<OpportunityDiscoverySummary | null> {
  const { database, deps, invokeOpts, logger, logContext } = params;
  if (deps?.invokeMatchmaking) {
    await deps.invokeMatchmaking(invokeOpts);
    return null;
  }
  const model = new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' });
  const artifacts = new Artifacts({ database, model, embedder: new EmbedderAdapter(), cache: new RedisCacheAdapter() });
  const matchmaking = new Matchmaking({
    database: createMatchmakingData(database), search: new EmbedderAdapter(),
    prepareArtifacts: input => artifacts.prepare(input), matchExplainer: new MatchExplainer(model),
  });
  const context = requestContext.getStore();
  const result = await matchmaking.discover(invokeOpts, { signal: context?.abortSignal, traceEmitter: context?.traceEmitter, logger });
  if (result.error) {
    logger.error('Matchmaking failed', { ...logContext, error: result.error });
    throw new Error(result.error);
  }
  const opened = await openMatchmakingPairs(database, result.pairs, logger);
  const summary = summarizeOpportunityDiscoveryResult({ ...result, opened });
  logger.info('Matchmaking complete', { ...logContext, ...summary, opened: undefined, openedCount: opened.length });
  logger.verbose('Matchmaking trace', { ...logContext, trace: result.trace });
  return summary;
}
