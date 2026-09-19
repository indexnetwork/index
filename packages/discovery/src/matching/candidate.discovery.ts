import type { DiscoveryData, IntentCandidate, IntentPairEvaluator, Profile, RunOptions } from '../core/types.js';

import { INTENT_MATCH_REASONING } from './discovery.constants.js';

/** Read ports for exhaustive intent pairing within authorized network registrations. */
export type CandidateDiscoveryData = Pick<
  DiscoveryData,
  | 'getNetworkMemberships'
  | 'getActiveIntents'
  | 'getProfile'
  | 'getNetworkIdsForIntent'
  | 'getDiscoveryScope'
  | 'getNetworkContexts'
  | 'getActiveNetworkMembershipPairs'
  | 'listIntentCandidates'
>;

export interface CounterpartyCandidate {
  candidateUserId: string;
  candidateIntentId: string;
  networkId: string;
  matchProbability: number;
  reasoning: string;
  candidatePayload: string;
  candidateSummary?: string;
  profile: Profile | null;
  networkContext?: string;
}

export interface CandidateDiscoveryInput {
  userId: string;
  triggerIntentId: string;
  networkIds: string[];
}

export interface CandidateDiscoveryResult {
  networkIds: string[];
  sourcePayload: string;
  candidates: CounterpartyCandidate[];
}

const PAIR_CONCURRENCY = 4;

/** Scores every eligible intent/network pair directly and ranks by match probability. */
export class CandidateDiscovery {
  /** @param deps - Host-owned read ports and direct intent-pair evaluator. */
  constructor(
    private readonly deps: {
      database: CandidateDiscoveryData;
      evaluator: IntentPairEvaluator;
    },
  ) {}

  /**
   * Scores all eligible counterparty intents within shared intent registrations.
   * @param input - An owned active intent and a distinct nonempty subset of its authorized networks.
   * @param options - Cancellation signal, execution tracing, and logger.
   * @returns Every still-eligible pair in descending match probability order, plus the evaluated source payload.
   * @throws When scope or source changes, evaluation fails, a probability is invalid, or host reads fail.
   */
  async discover(input: CandidateDiscoveryInput, options: RunOptions = {}): Promise<CandidateDiscoveryResult> {
    const requestedNetworks = this.validateInput(input);
    const { database, evaluator } = this.deps;
    const { traceEmitter, logger } = options;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const startedAt = Date.now();
    signal.throwIfAborted();
    traceEmitter?.({ type: 'agent_start', name: 'opportunity-discovery' });

    try {
      const [memberships, userIntents, triggerIntentNetworkIds] = await Promise.all([
        database.getNetworkMemberships(input.userId),
        database.getActiveIntents(input.userId),
        database.getNetworkIdsForIntent(input.triggerIntentId),
      ]);
      signal.throwIfAborted();

      const triggerIntent = userIntents.find((intent) => intent.id === input.triggerIntentId);
      if (!triggerIntent) {
        throw new Error('Trigger intent is not available for discovery.');
      }
      const sourcePayload = triggerIntent.payload;
      const userNetworkIds = memberships.map((membership) => membership.networkId);
      const scope = await database.getDiscoveryScope({
        userId: input.userId,
        userNetworks: userNetworkIds,
        networkScope: requestedNetworks,
        triggerIntentId: input.triggerIntentId,
      });
      signal.throwIfAborted();

      if (scope.error) throw new Error(scope.error);
      const isScopeAuthorized =
        scope.networkIds.length === requestedNetworks.length &&
        requestedNetworks.every(
          (id) => scope.networkIds.includes(id) && userNetworkIds.includes(id) && triggerIntentNetworkIds.includes(id),
        );
      if (!isScopeAuthorized) {
        throw new Error('Requested networks are outside authorized scope.');
      }

      const [listedCandidates, networkContexts] = await Promise.all([
        database.listIntentCandidates({ excludeUserId: input.userId, networkIds: scope.networkIds }, { signal }),
        database.getNetworkContexts(scope.networkIds),
      ]);
      signal.throwIfAborted();

      const uniqueCandidates = new Map<string, IntentCandidate>();
      for (const candidate of listedCandidates) {
        if (
          candidate.userId === input.userId ||
          candidate.id === input.triggerIntentId ||
          !scope.networkIds.includes(candidate.networkId)
        ) continue;
        const key = JSON.stringify([candidate.id, candidate.networkId]);
        if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
      }
      const intentCandidates = [...uniqueCandidates.values()];
      const initialMemberships = await database.getActiveNetworkMembershipPairs([
        ...scope.networkIds.map((networkId) => ({ userId: input.userId, networkId })),
        ...intentCandidates.map((candidate) => ({ userId: candidate.userId, networkId: candidate.networkId })),
      ]);
      signal.throwIfAborted();
      const initialMemberKeys = new Set(initialMemberships.map((pair) => JSON.stringify([pair.userId, pair.networkId])));
      if (scope.networkIds.some((networkId) => !initialMemberKeys.has(JSON.stringify([input.userId, networkId])))) {
        throw new Error('Source network scope changed during discovery.');
      }

      const profiles = new Map<string, Promise<Profile | null>>();
      const matches: CounterpartyCandidate[] = [];
      for (let offset = 0; offset < intentCandidates.length; offset += PAIR_CONCURRENCY) {
        signal.throwIfAborted();
        const evaluated = await Promise.all(
          intentCandidates.slice(offset, offset + PAIR_CONCURRENCY).map(async (candidate): Promise<CounterpartyCandidate | null> => {
            if (!initialMemberKeys.has(JSON.stringify([candidate.userId, candidate.networkId]))) return null;
            const [activeIntents, assignments] = await Promise.all([
              database.getActiveIntents(candidate.userId),
              database.getNetworkIdsForIntent(candidate.id),
            ]);
            signal.throwIfAborted();
            const activeIntent = activeIntents.find((intent) => intent.id === candidate.id);
            if (!activeIntent || activeIntent.payload !== candidate.payload || !assignments.includes(candidate.networkId)) {
              return null;
            }

            const matchProbability = await evaluator.evaluate({
              intentA: sourcePayload,
              intentB: candidate.payload,
              networkContext: networkContexts[candidate.networkId],
            }, { signal });
            signal.throwIfAborted();
            if (!Number.isFinite(matchProbability) || matchProbability < 0 || matchProbability > 1) {
              throw new Error('Intent pair evaluator must return a finite probability between 0 and 1.');
            }

            let profile = profiles.get(candidate.userId);
            if (!profile) {
              profile = database.getProfile(candidate.userId);
              profiles.set(candidate.userId, profile);
            }
            const candidateProfile = await profile;
            signal.throwIfAborted();
            return {
              candidateUserId: candidate.userId,
              candidateIntentId: candidate.id,
              networkId: candidate.networkId,
              matchProbability,
              reasoning: INTENT_MATCH_REASONING,
              candidatePayload: candidate.payload,
              candidateSummary: activeIntent.summary ?? undefined,
              profile: candidateProfile,
              networkContext: networkContexts[candidate.networkId],
            };
          }),
        );
        for (const candidate of evaluated) {
          if (candidate) matches.push(candidate);
        }
      }

      // Provider calls and profile hydration can outlive the eligibility snapshot.
      const freshMatches: CounterpartyCandidate[] = [];
      for (let offset = 0; offset < matches.length; offset += PAIR_CONCURRENCY) {
        signal.throwIfAborted();
        const refreshed = await Promise.all(
          matches.slice(offset, offset + PAIR_CONCURRENCY).map(async (candidate): Promise<CounterpartyCandidate | null> => {
            const [activeIntents, assignments] = await Promise.all([
              database.getActiveIntents(candidate.candidateUserId),
              database.getNetworkIdsForIntent(candidate.candidateIntentId),
            ]);
            signal.throwIfAborted();
            const activeIntent = activeIntents.find((intent) => intent.id === candidate.candidateIntentId);
            if (!activeIntent || activeIntent.payload !== candidate.candidatePayload || !assignments.includes(candidate.networkId)) {
              return null;
            }
            return { ...candidate, candidateSummary: activeIntent.summary ?? undefined };
          }),
        );
        for (const candidate of refreshed) {
          if (candidate) freshMatches.push(candidate);
        }
      }

      const [currentSourceIntents, sourceAssignments, activeMembershipPairs] = await Promise.all([
        database.getActiveIntents(input.userId),
        database.getNetworkIdsForIntent(input.triggerIntentId),
        database.getActiveNetworkMembershipPairs([
          ...scope.networkIds.map((networkId) => ({ userId: input.userId, networkId })),
          ...freshMatches.map((candidate) => ({ userId: candidate.candidateUserId, networkId: candidate.networkId })),
        ]),
      ]);
      signal.throwIfAborted();
      const currentSourceIntent = currentSourceIntents.find((intent) => intent.id === input.triggerIntentId);
      if (!currentSourceIntent) {
        throw new Error('Trigger intent is not available for discovery.');
      }
      if (currentSourceIntent.payload !== sourcePayload) {
        throw new Error('Trigger intent payload changed during discovery.');
      }

      const memberKeys = new Set(activeMembershipPairs.map((pair) => JSON.stringify([pair.userId, pair.networkId])));
      const validNetworks = scope.networkIds.filter(
        (networkId) => sourceAssignments.includes(networkId) && memberKeys.has(JSON.stringify([input.userId, networkId])),
      );
      if (validNetworks.length !== requestedNetworks.length) {
        throw new Error('Source network scope changed during discovery.');
      }
      const candidates = freshMatches.filter(
        (candidate) => memberKeys.has(JSON.stringify([candidate.candidateUserId, candidate.networkId])),
      ).sort((a, b) => b.matchProbability - a.matchProbability);
      logger?.info('Intent pair discovery complete', {
        candidates: candidates.length,
        networks: validNetworks.length,
      });
      return { networkIds: validNetworks, sourcePayload, candidates };
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      traceEmitter?.({
        type: 'agent_end',
        name: 'opportunity-discovery',
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private validateInput(input: CandidateDiscoveryInput): string[] {
    if (
      !Array.isArray(input.networkIds) ||
      !input.networkIds.length ||
      new Set(input.networkIds).size !== input.networkIds.length ||
      input.networkIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new Error('Provide distinct nonempty network IDs.');
    }
    return [...input.networkIds];
  }
}
