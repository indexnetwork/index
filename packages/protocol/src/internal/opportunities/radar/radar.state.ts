import type { Opportunity, OpportunityStatus } from '../../../platform/database.js';
import type { DebugMetaAgent } from "../../../protocol/core.js";

/**
 * Radar card item: one opportunity with full presenter-driven display contract.
 */
export interface RadarCardItem {
  opportunityId: string;
  /** Lifecycle status of the underlying opportunity at render time (client bucketing, e.g. intent radar). */
  status?: OpportunityStatus;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline?: string;
  /** Presenter-generated; primary button (accept) and secondary button (dismiss). */
  primaryActionLabel: string;
  secondaryActionLabel: string;
  /** Presenter-generated subtitle under the other party name (e.g. "1 mutual intent"). */
  mutualIntentsLabel: string;
  /** Narrator chip for human-introduced opportunities; avatar set when narrator is a user */
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  /** Viewer's role in this opportunity (e.g. 'party', 'agent', 'patient', 'peer'). */
  viewerRole?: string;
  /**
   * True when this card was produced by a skeleton-presentation run: identity
   * fields (name/avatar/status) are real but mainText/cta are empty because the
   * presenter LLM was skipped. Clients render a shimmer body and re-fetch the
   * full view. Skeleton cards are never written to the presenter cache.
   */
  presentationPending?: boolean;
  /** Internal marker: safe deterministic fallback rendered, but must not be cached. */
  _presentationFallback?: boolean;
  /** Internal: original position in the loaded opportunity list, for stable ordering. */
  _cardIndex: number;
}

/** Card item as returned in API responses (no internal fields). */
export type RadarResponseItem = Omit<RadarCardItem, '_cardIndex' | '_presentationFallback'>;

/**
 * Radar Graph State (Annotation-based).
 * Flow: loadOpportunities → checkPresenterCache → [generateCardText if misses]
 * → cachePresenterResults → normalizeItems.
 */
export interface RadarState {
  userId: string;
  networkId: string | undefined;
  scopeType: 'intent' | undefined;
  scopeId: string | undefined;
  limit: number;
  /** When true, bypass the presenter Redis cache. */
  noCache: boolean;
  /** Presentation depth. 'full' (default) runs the presenter LLM for cache misses. 'skeleton' skips it: uncached cards come back with resolved identity (name/avatar/status) and `presentationPending: true`, cached cards come back complete. */
  presentation: 'full' | 'skeleton';
  /** Optional status filter. When undefined, the graph uses `DEFAULT_RADAR_STATUSES`. */
  statuses: OpportunityStatus[] | undefined;
  /** Raw opportunities visible to the viewer (after visibility filter). */
  opportunities: Opportunity[];
  /** Cards with presenter output and narrator chip. */
  cards: RadarCardItem[];
  /** Final items for response (internal fields stripped). */
  items: RadarResponseItem[];
  /** Presenter results retrieved from cache (opportunityId → RadarCardItem). */
  cachedCards: Map<string, RadarCardItem>;
  /** Opportunities that had no cache hit and need presenter generation. */
  uncachedOpportunities: Opportunity[];
  error: string | undefined;
  /** Meta for response (e.g. totalOpportunities). */
  meta: { totalOpportunities: number };
  /** Timing records for each agent invocation within this graph run. */
  agentTimings: DebugMetaAgent[];
}

export function radarDefaults(): RadarState {
  return {
    userId: '',
    networkId: undefined,
    scopeType: undefined,
    scopeId: undefined,
    limit: 50,
    noCache: false,
    presentation: 'full',
    statuses: undefined,
    opportunities: [],
    cards: [],
    items: [],
    cachedCards: new Map(),
    uncachedOpportunities: [],
    error: undefined,
    meta: ({ totalOpportunities: 0 }),
    agentTimings: [],
  };
}

