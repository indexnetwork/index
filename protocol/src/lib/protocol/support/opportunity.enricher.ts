/**
 * Opportunity enricher: when creating an opportunity, find overlapping existing
 * opportunities (by non-introducer actor userId), check semantic relatedness, and
 * optionally merge into a single enriched opportunity and expire the old one(s).
 */

import type {
  CreateOpportunityData,
  Opportunity,
  OpportunityActor,
  OpportunityInterpretation,
  OpportunitySignal,
  OpportunityStatus,
} from '../interfaces/database.interface';
import type { Embedder } from '../interfaces/embedder.interface';
import type { Id } from '../../../types/common.types';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('OpportunityEnricher');

const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const MIN_REASONING_LENGTH_FOR_EMBEDDING = 10;

export type EnricherDatabase = {
  findOverlappingOpportunities(
    actorUserIds: Id<'users'>[],
    options?: { excludeStatuses?: ('latent' | 'pending' | 'accepted' | 'rejected' | 'expired')[] }
  ): Promise<Opportunity[]>;
};

export type EnrichmentResult =
  | { enriched: false; data: CreateOpportunityData }
  | { enriched: true; data: CreateOpportunityData; expiredIds: string[]; resolvedStatus: OpportunityStatus };

export type EnrichOrCreateOptions = {
  similarityThreshold?: number;
};

/**
 * Cosine similarity between two vectors (0–1).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  const sim = dot / denom;
  return Math.max(0, Math.min(1, sim));
}

/**
 * Resolve enriched opportunity status from related opportunities' statuses and the incoming status.
 * Priority: accepted > pending > rejected > draft (only when incoming is draft) > latent.
 * The incoming status is included so we do not wrongly downgrade when the new opportunity has a higher-priority status.
 * When incoming is 'draft' (e.g. from in-chat discovery), we preserve draft so the opportunity stays chat-only and
 * does not appear on the home view (home excludes draft).
 * When incoming is NOT draft (e.g. 'latent' from the background broker), existing draft status does NOT contaminate
 * the result — the broker-created opportunity retains its own status and can appear on the home view.
 */
function resolveEnrichedStatus(relatedStatuses: string[], incomingStatus?: string): OpportunityStatus {
  const statuses = incomingStatus ? [...relatedStatuses, incomingStatus] : relatedStatuses;
  if (statuses.includes('accepted')) return 'accepted';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('rejected')) return 'rejected';
  if (incomingStatus === 'draft') return 'draft';
  return 'latent';
}

/**
 * Extract non-introducer actor userIds from create data.
 */
function getNonIntroducerUserIds(data: CreateOpportunityData): Id<'users'>[] {
  const ids = data.actors
    .filter((a) => a.role !== 'introducer')
    .map((a) => a.userId);
  return [...new Set(ids)];
}

/**
 * Extract intent IDs from actors.
 */
function getIntentIdsFromActors(actors: OpportunityActor[]): Set<string> {
  const ids = new Set<string>();
  for (const a of actors) {
    if (a.intent) ids.add(a.intent);
  }
  return ids;
}

/**
 * Check if two opportunities share at least one intent ID.
 */
function shareIntentIds(
  newData: CreateOpportunityData,
  existing: Opportunity
): boolean {
  const newIntents = getIntentIdsFromActors(newData.actors);
  const existingIntents = getIntentIdsFromActors(existing.actors);
  for (const id of newIntents) {
    if (existingIntents.has(id)) return true;
  }
  return false;
}

/**
 * Merge actors from new data and existing opportunities: union by (indexId, userId, intent),
 * preserving all unique introducers and preferring newer role on conflict.
 */
function mergeActors(
  newData: CreateOpportunityData,
  existingList: Opportunity[]
): OpportunityActor[] {
  const key = (a: OpportunityActor) =>
    `${a.indexId}:${a.userId}:${a.intent ?? ''}`;
  const map = new Map<string, OpportunityActor>();

  // Add all from existing first (older)
  for (const opp of existingList) {
    for (const a of opp.actors) {
      map.set(key(a), a);
    }
  }
  // Add/overwrite with new (newer wins for same key, e.g. role)
  for (const a of newData.actors) {
    map.set(key(a), a);
  }

  return [...map.values()];
}

/**
 * Merge interpretation: single reasoning (new data only), max confidence, merged signals.
 * We use only the new opportunity's reasoning to avoid repetitive concatenation when
 * multiple overlapping opportunities share the same or similar text (e.g. same pair
 * across indexes), which previously produced long duplicated paragraphs in chat cards.
 */
function mergeInterpretation(
  newData: CreateOpportunityData,
  existingList: Opportunity[]
): OpportunityInterpretation {
  const reasoning = newData.interpretation.reasoning;

  let maxConf =
    typeof newData.interpretation.confidence === 'number'
      ? newData.interpretation.confidence
      : parseFloat(String(newData.interpretation.confidence ?? 0));
  for (const o of existingList) {
    const c = o.interpretation?.confidence;
    const cNum = typeof c === 'number' ? c : parseFloat(String(c ?? 0));
    if (cNum > maxConf) maxConf = cNum;
  }
  const confidence = maxConf;

  const signals: OpportunitySignal[] = [
    ...(newData.interpretation.signals ?? []),
    ...existingList.flatMap((o) => o.interpretation?.signals ?? []),
  ];
  const seen = new Set<string>();
  const dedupedSignals = signals.filter((s) => {
    const k = `${s.type}:${s.detail ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    category: newData.interpretation.category,
    reasoning,
    confidence: typeof confidence === 'string' ? parseFloat(confidence) : confidence,
    signals: dedupedSignals.length > 0 ? dedupedSignals : newData.interpretation.signals,
  };
}

/**
 * Enrich or create: find overlapping opportunities, filter by semantic relatedness
 * using a two-phase approach, merge actors and interpretation into a single
 * CreateOpportunityData, and return the data plus IDs to expire. If no related
 * overlap, return original data unchanged.
 *
 * Phase 1 — Intent check (free, no API call):
 *   Shared intent IDs mean the same declared user goal drove both opportunities.
 *   This is rare because the IntentReconciler already deduplicates intents per-user
 *   upstream, but when it fires it is definitive.
 *
 * Phase 2 — Batched embedding similarity (one API call for all remaining):
 *   For opportunities without shared intents, embed all reasoning texts in a single
 *   batch call and compare cosine similarity. Cross-user intent comparison (e.g.
 *   Alice's "find ML co-founder" vs Bob's "join ML startup") is implicitly handled
 *   here since reasoning text synthesizes both users' intents.
 */
export async function enrichOrCreate(
  database: EnricherDatabase,
  embedder: Embedder,
  newData: CreateOpportunityData,
  options?: EnrichOrCreateOptions
): Promise<EnrichmentResult> {
  const actorUserIds = getNonIntroducerUserIds(newData);
  if (actorUserIds.length === 0) {
    return { enriched: false, data: newData };
  }

  const overlapping = await database.findOverlappingOpportunities(actorUserIds);
  if (overlapping.length === 0) {
    return { enriched: false, data: newData };
  }

  const threshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // Phase 1: Intent-based relatedness (free, strongest signal)
  const related: Opportunity[] = [];
  const remaining: Opportunity[] = [];
  for (const opp of overlapping) {
    if (shareIntentIds(newData, opp)) {
      related.push(opp);
    } else {
      remaining.push(opp);
    }
  }

  // Phase 2: Batched embedding similarity (one API call for all remaining)
  if (remaining.length > 0) {
    const newReasoning = (newData.interpretation?.reasoning ?? '').trim();

    // Only embed opps where both reasonings are long enough
    const embeddable: Opportunity[] = [];
    for (const opp of remaining) {
      const existingReasoning = (opp.interpretation?.reasoning ?? '').trim();
      if (
        newReasoning.length >= MIN_REASONING_LENGTH_FOR_EMBEDDING &&
        existingReasoning.length >= MIN_REASONING_LENGTH_FOR_EMBEDDING
      ) {
        embeddable.push(opp);
      }
      // Short reasoning + no shared intents (Phase 1 missed) → not related
    }

    if (embeddable.length > 0) {
      try {
        const textsToEmbed = [
          newReasoning,
          ...embeddable.map((o) => (o.interpretation?.reasoning ?? '').trim()),
        ];
        const vectors = (await embedder.generate(textsToEmbed)) as number[][];
        const newVec = vectors[0];
        if (newVec?.length) {
          for (let i = 0; i < embeddable.length; i++) {
            const existingVec = vectors[i + 1];
            if (existingVec?.length && cosineSimilarity(newVec, existingVec) >= threshold) {
              related.push(embeddable[i]);
            }
          }
        }
      } catch (e) {
        logger.warn('[Enricher] Embedding check failed; intent-matched opportunities already captured', { error: e });
        // Phase 1 matches are preserved; remaining opps without shared intents are not related
      }
    }
  }

  if (related.length === 0) {
    return { enriched: false, data: newData };
  }

  const mergedActors = mergeActors(newData, related);
  const mergedInterpretation = mergeInterpretation(newData, related);
  const enrichedFrom = related.map((o) => o.id);
  const mergedConfidence =
    typeof mergedInterpretation.confidence === 'number'
      ? String(mergedInterpretation.confidence)
      : mergedInterpretation.confidence;

  const enrichedData: CreateOpportunityData = {
    ...newData,
    detection: {
      ...newData.detection,
      source: 'enrichment',
      enrichedFrom,
    },
    actors: mergedActors,
    interpretation: mergedInterpretation,
    confidence: mergedConfidence,
  };

  const resolvedStatus = resolveEnrichedStatus(related.map((o) => o.status), newData.status);

  logger.verbose('[Enricher] Enriched opportunity', {
    enrichedFrom,
    actorCount: mergedActors.length,
  });

  return {
    enriched: true,
    data: enrichedData,
    expiredIds: enrichedFrom,
    resolvedStatus,
  };
}
