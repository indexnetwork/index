/**
 * Negotiation Integration
 * 
 * Utility functions to integrate negotiation with opportunity discovery.
 * This module bridges the gap between the discovery flow and negotiation queue.
 */

import { negotiationQueue } from '../../../queues/negotiation.queue';
import type { NegotiationTrigger } from '../../../types/negotiation.types';
import type { Id } from '../../../types/common.types';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('NegotiationIntegration');

export interface DiscoveryCandidate {
  candidateUserId: string;
  candidateIntentId?: string;
  indexId: string;
  similarity?: number;
}

export interface TriggerNegotiationsInput {
  /** The user who triggered discovery */
  initiatorUserId: string;
  /** Candidates found by discovery */
  candidates: DiscoveryCandidate[];
  /** The intent that triggered discovery (optional) */
  triggerIntentId?: string;
  /** The search query used (optional) */
  searchQuery?: string;
  /** Limit on how many negotiations to initiate */
  limit?: number;
}

export interface TriggerNegotiationsResult {
  /** Number of negotiations initiated */
  initiated: number;
  /** Candidate user IDs that had negotiations initiated */
  candidateUserIds: string[];
  /** Any errors that occurred */
  errors: Array<{ candidateUserId: string; error: string }>;
}

/**
 * Trigger negotiations for discovered candidates.
 * 
 * This function takes the output of discovery (candidate matches) and
 * enqueues negotiation jobs for each candidate pair.
 * 
 * Use this instead of the evaluation node when you want negotiations
 * to determine opportunity creation.
 */
export async function triggerNegotiationsForDiscovery(
  input: TriggerNegotiationsInput
): Promise<TriggerNegotiationsResult> {
  const { initiatorUserId, candidates, triggerIntentId, searchQuery, limit = 10 } = input;

  logger.info('[TriggerNegotiations] Starting', {
    initiatorUserId,
    candidatesCount: candidates.length,
    hasTriggerIntent: !!triggerIntentId,
    hasSearchQuery: !!searchQuery,
    limit,
  });

  // Dedupe candidates by userId
  const seenUserIds = new Set<string>();
  const dedupedCandidates = candidates.filter(c => {
    if (c.candidateUserId === initiatorUserId) return false; // Skip self
    if (seenUserIds.has(c.candidateUserId)) return false;
    seenUserIds.add(c.candidateUserId);
    return true;
  });

  // Sort by similarity and take top N
  const sortedCandidates = dedupedCandidates
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);

  const result: TriggerNegotiationsResult = {
    initiated: 0,
    candidateUserIds: [],
    errors: [],
  };

  // Enqueue negotiation jobs
  for (const candidate of sortedCandidates) {
    try {
      const trigger: NegotiationTrigger = {
        source: 'search',
        intentId: triggerIntentId as Id<'intents'> | undefined,
        query: searchQuery,
        indexId: candidate.indexId as Id<'indexes'>,
      };

      await negotiationQueue.addInitiateJob({
        initiatorUserId,
        responderUserId: candidate.candidateUserId,
        trigger,
        indexId: candidate.indexId,
      });

      result.initiated++;
      result.candidateUserIds.push(candidate.candidateUserId);

      logger.verbose('[TriggerNegotiations] Enqueued negotiation', {
        initiatorUserId,
        responderUserId: candidate.candidateUserId,
        indexId: candidate.indexId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        candidateUserId: candidate.candidateUserId,
        error: errorMessage,
      });
      logger.warn('[TriggerNegotiations] Failed to enqueue', {
        candidateUserId: candidate.candidateUserId,
        error: errorMessage,
      });
    }
  }

  logger.info('[TriggerNegotiations] Complete', {
    initiated: result.initiated,
    errors: result.errors.length,
  });

  return result;
}
