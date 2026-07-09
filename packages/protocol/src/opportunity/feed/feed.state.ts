import { Annotation } from '@langchain/langgraph';
import type { Opportunity, OpportunityStatus } from '../../shared/interfaces/database.interface.js';
import type { DebugMetaAgent } from '../../chat/chat-streaming.types.js';

/**
 * Home view card item: one opportunity with full presenter-driven display contract.
 */
export interface HomeCardItem {
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
  /** Second party in introducer arrow layout. Present when viewerRole is 'introducer'. */
  secondParty?: { name: string; avatar?: string | null; userId?: string };
  /**
   * True when this card was produced by a skeleton-presentation run: identity
   * fields (name/avatar/status) are real but mainText/cta are empty because the
   * presenter LLM was skipped. Clients render a shimmer body and re-fetch the
   * full view. Skeleton cards are never written to the presenter cache.
   */
  presentationPending?: boolean;
  /** For section assignment from LLM */
  _cardIndex: number;
}

/**
 * Dynamic section from LLM categorization.
 */
export interface HomeSectionProposal {
  id: string;
  title: string;
  subtitle?: string;
  iconName: string;
  itemIndices: number[];
}

/** Card item as returned in API (no internal _cardIndex). */
export type HomeSectionItem = Omit<HomeCardItem, '_cardIndex'>;

/**
 * Final section for API response.
 */
export interface HomeSection {
  id: string;
  title: string;
  subtitle?: string;
  iconName: string;
  items: HomeSectionItem[];
}

/**
 * Home Graph State (Annotation-based).
 * Flow: loadOpportunities → generateCardText → categorizeDynamically → normalizeAndSort → finalizeResponse.
 */
export const HomeGraphState = Annotation.Root({
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

  /** When true, bypass presenter and categorizer Redis caches. */
  noCache: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /**
   * Presentation depth. 'full' (default) runs the presenter LLM and categorizer.
   * 'skeleton' skips both for cache misses: uncached cards come back with
   * resolved identity (name/avatar/status) and `presentationPending: true`,
   * cached cards come back complete, and all cards land in one flat section.
   */
  presentation: Annotation<'full' | 'skeleton'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'full',
  }),

  /** Optional status filter. When undefined, the graph uses `DEFAULT_HOME_STATUSES`. */
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
  cards: Annotation<HomeCardItem[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** LLM output: dynamic sections with icon and item indices. */
  sectionProposals: Annotation<HomeSectionProposal[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Final sections for response. */
  sections: Annotation<HomeSection[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Presenter results retrieved from cache (opportunityId → HomeCardItem). */
  cachedCards: Annotation<Map<string, HomeCardItem>>({
    reducer: (curr, next) => next ?? curr,
    default: () => new Map(),
  }),

  /** Opportunities that had no cache hit and need presenter generation. */
  uncachedOpportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Whether categorizer results were found in cache. */
  categoryCacheHit: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Meta for response (e.g. totalOpportunities, totalSections). */
  meta: Annotation<{ totalOpportunities: number; totalSections: number }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ totalOpportunities: 0, totalSections: 0 }),
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),
});
