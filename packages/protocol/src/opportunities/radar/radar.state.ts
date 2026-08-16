import { Annotation } from '@langchain/langgraph';
import type { Opportunity, OpportunityStatus } from '../../shared/interfaces/database.interface.js';
import type { DebugMetaAgent } from '../../agents/index.js';

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
  /** Viewer's role in this opportunity (e.g. 'introducer', 'party', 'agent', 'patient', 'peer'). */
  viewerRole?: string;
  /** Whether the counterpart is a ghost (not yet onboarded) user. */
  isGhost?: boolean;
  /** Template-only explanation for a pool-answer demotion (never evaluator reasoning). */
  deprioritizedReason?: string;
  /** Second party in introducer arrow layout. Present when viewerRole is 'introducer'. */
  secondParty?: { name: string; avatar?: string | null; userId?: string };
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
export const RadarGraphState = Annotation.Root({
  userId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => '',
  }),
  networkId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  scopeType: Annotation<'intent' | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  scopeId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  limit: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 50,
  }),

  /** When true, bypass the presenter Redis cache. */
  noCache: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /**
   * Presentation depth. 'full' (default) runs the presenter LLM for cache
   * misses. 'skeleton' skips it: uncached cards come back with resolved
   * identity (name/avatar/status) and `presentationPending: true`, cached
   * cards come back complete.
   */
  presentation: Annotation<'full' | 'skeleton'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'full',
  }),

  /** Optional status filter. When undefined, the graph uses `DEFAULT_RADAR_STATUSES`. */
  statuses: Annotation<OpportunityStatus[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Raw opportunities visible to the viewer (after visibility filter). */
  opportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Cards with presenter output and narrator chip. */
  cards: Annotation<RadarCardItem[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Final items for response (internal fields stripped). */
  items: Annotation<RadarResponseItem[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Presenter results retrieved from cache (opportunityId → RadarCardItem). */
  cachedCards: Annotation<Map<string, RadarCardItem>>({
    reducer: (curr, next) => next ?? curr,
    default: () => new Map(),
  }),

  /** Opportunities that had no cache hit and need presenter generation. */
  uncachedOpportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Meta for response (e.g. totalOpportunities). */
  meta: Annotation<{ totalOpportunities: number }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ totalOpportunities: 0 }),
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),
});
