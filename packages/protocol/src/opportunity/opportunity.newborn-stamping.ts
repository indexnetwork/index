import type { CreateOpportunityData } from '../shared/interfaces/database.interface.js';

/** Input for the host-side newborn pool-preference stamper (IND-420 P4b). */
export interface StampNewbornOpportunitiesInput {
  ownerUserId: string;
  intentId: string;
  items: CreateOpportunityData[];
}

/**
 * Optional host callback that stamps call-local create items before INSERT.
 * It must preserve array length/order and may only enrich metadata/signals.
 */
export type StampNewbornOpportunitiesFn = (
  input: StampNewbornOpportunitiesInput,
) => Promise<CreateOpportunityData[]>;

/** Persist-node facts that determine whether a new item may cross the host stamping boundary. */
export interface NewbornStampingEligibility {
  ownerUserId: string;
  operationMode?: string;
  hasIntroductionContext: boolean;
  onBehalfOfUserId?: string;
  targetUserId?: string;
  discoverySource?: string;
  resolvedTriggerIntentId?: string;
  indexedIntentIds: readonly string[];
}

/** Fail-open events are injected so the graph retains its owning observability policy. */
export interface NewbornStampingObserver {
  onUnsafeResult?: (details: { expected: number; actual: number | null }) => void;
  onFailure?: (details: { intentId: string; error: unknown }) => void;
}

function copyCreateOpportunityData(item: CreateOpportunityData): CreateOpportunityData {
  return {
    ...item,
    detection: { ...item.detection },
    actors: item.actors.map((actor) => ({ ...actor })),
    interpretation: {
      ...item.interpretation,
      signals: item.interpretation.signals?.map((signal) => ({ ...signal })),
    },
    context: { ...item.context },
    metadata: item.metadata ? { ...item.metadata } : item.metadata,
  };
}

/** Fields a stamper is not allowed to change; this also protects candidate order. */
function newbornItemIdentity(item: CreateOpportunityData): string {
  return JSON.stringify({
    detection: item.detection,
    actors: item.actors,
    interpretation: {
      category: item.interpretation.category,
      reasoning: item.interpretation.reasoning,
      confidence: item.interpretation.confidence,
    },
    context: item.context,
    confidence: item.confidence,
    status: item.status,
    expiresAt: item.expiresAt?.toISOString(),
  });
}

/**
 * Stamps only newly-created, owned-intent discovery items. Reactivations and
 * manual, introducer, on-behalf-of, context-only, and continuation flows never
 * cross this host boundary. Unsafe callback output and callback failures retain
 * the original create items without changing their order.
 */
export async function stampEligibleNewbornOpportunities(
  itemsToPersist: CreateOpportunityData[],
  eligibility: NewbornStampingEligibility,
  stamper?: StampNewbornOpportunitiesFn,
  observer?: NewbornStampingObserver,
): Promise<CreateOpportunityData[]> {
  const stampIntentId = eligibility.resolvedTriggerIntentId;
  const mayStamp = Boolean(
    stamper
    && eligibility.operationMode === 'create'
    && !eligibility.hasIntroductionContext
    && !eligibility.onBehalfOfUserId
    && !eligibility.targetUserId
    && eligibility.discoverySource === 'intent'
    && stampIntentId
    && eligibility.indexedIntentIds.includes(stampIntentId),
  );
  if (!mayStamp || !stampIntentId || itemsToPersist.length === 0 || !stamper) {
    return itemsToPersist;
  }

  const eligibleIndexes = itemsToPersist.flatMap((item, index) =>
    item.detection.source === 'opportunity_graph' && item.detection.triggeredBy === stampIntentId
      ? [index]
      : []);
  if (eligibleIndexes.length === 0) return itemsToPersist;

  const originals = eligibleIndexes.map((index) => itemsToPersist[index]);
  try {
    const stamped = await stamper({
      ownerUserId: eligibility.ownerUserId,
      intentId: stampIntentId,
      items: originals.map(copyCreateOpportunityData),
    });
    const valid = Array.isArray(stamped)
      && stamped.length === originals.length
      && stamped.every((item, index) => newbornItemIdentity(item) === newbornItemIdentity(originals[index]));
    if (!valid) {
      observer?.onUnsafeResult?.({
        expected: originals.length,
        actual: Array.isArray(stamped) ? stamped.length : null,
      });
      return itemsToPersist;
    }

    const itemsForPersistence = [...itemsToPersist];
    eligibleIndexes.forEach((itemIndex, stampedIndex) => {
      itemsForPersistence[itemIndex] = stamped[stampedIndex];
    });
    return itemsForPersistence;
  } catch (error) {
    observer?.onFailure?.({ intentId: stampIntentId, error });
    return itemsToPersist;
  }
}
