/**
 * Radar Graph: Build the opportunity radar view — a flat, presenter-texted
 * list of opportunity cards for a viewer, optionally scoped to one intent.
 *
 * Independent of ChatGraph. Flow:
 * loadOpportunities → checkPresenterCache → [generateCardText if misses]
 * → cachePresenterResults → normalizeItems
 *
 * Uses OpportunityPresenter for card text and caches presenter results via
 * OpportunityCache. Responses are a flat `items` array; clients bucket by
 * lifecycle status themselves.
 */

import { StateGraph, START, END } from '@langchain/langgraph';

import type { RadarGraphDatabase, OpportunityStatus } from '../../../platform/database.js';
import type { OpportunityCache } from '../../../platform/discovery/cache.js';
import { RadarGraphState, type RadarCardItem, type RadarResponseItem } from './radar.state.js';
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from '../opportunity.presentation.js';
import { loadNegotiationContext } from '../negotiation-context.loader.js';
import { canUserSeeOpportunity, isActionableForViewer, selectByComposition } from '../opportunity.utils.js';
import { getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from '../opportunity.labels.js';
import { safeFallbackSummary } from '../opportunity.presentation.js';
import { buildRadarCardPresentationCacheKey } from '../opportunity.presentation.js';
import type { DebugMetaAgent } from "../../../protocol/core.js";
import { protocolLogger } from '../../shared/observability/protocol.logger.js';
import { timed } from '../../shared/observability/performance.js';
import { requestContext } from "../../shared/observability/request-context.js";

const logger = protocolLogger('RadarGraph');
const checkPresenterCacheLog = protocolLogger('RadarGraph:checkPresenterCache');
const cachePresenterResultsLog = protocolLogger('RadarGraph:cachePresenterResults');
const generateCardTextLog = protocolLogger('RadarGraph:generateCardText');
const normalizeItemsLog = protocolLogger('RadarGraph:normalizeItems');

/** Database must satisfy both RadarGraphDatabase and presenter context (getProfile, getActiveIntents, getNetwork, getUser). */
type RadarGraphDb = RadarGraphDatabase;

export type RadarGraphInvokeInput = {
  userId: string;
  networkId?: string;
  scopeType?: 'intent';
  scopeId?: string;
  limit?: number;
  noCache?: boolean;
  /**
   * 'skeleton' returns immediately without LLM work: cached cards complete,
   * uncached cards with identity fields only + `presentationPending: true`.
   * Meant as the fast first phase of a two-phase fetch — follow up with a
   * full request to fill in the text.
   */
  presentation?: 'full' | 'skeleton';
  /**
   * When set, filter loaded opportunities to these lifecycle statuses. Defaults to `DEFAULT_RADAR_STATUSES`.
   * Explicit statuses switch the graph to "lifecycle view" mode: terminal/internal
   * statuses pass through (only latent/pending stay gated by viewer actionability),
   * ordering is newest-first, and composition capping is skipped.
   */
  statuses?: OpportunityStatus[];
};

export type RadarGraphInvokeResult = {
  items: RadarResponseItem[];
  meta: { totalOpportunities: number };
  error?: string;
};

/** Default radar statuses: the lifecycle stages a viewer can act on today. */
export const DEFAULT_RADAR_STATUSES: OpportunityStatus[] = ['pending'];

// Exhaustive registry — keys must cover every OpportunityStatus union member.
// Adding a new status to OpportunityStatus without adding a key here is a TS error,
// which is the whole point: prevents ALL_OPPORTUNITY_STATUSES from silently drifting.
const OPPORTUNITY_STATUS_REGISTRY: Record<OpportunityStatus, true> = {
  negotiating: true,
  pending: true,
  stalled: true,
  accepted: true,
  rejected: true,
  expired: true,
};

/** Full status enumeration. Pass this to `RadarGraphInvokeInput.statuses` to restore pre-Issue-3 (unfiltered) behavior. */
export const ALL_OPPORTUNITY_STATUSES: OpportunityStatus[] = Object.keys(
  OPPORTUNITY_STATUS_REGISTRY,
) as OpportunityStatus[];

const PRESENTATION_CONCURRENCY = 50;
const MAX_REASONING_SNIPPET_LENGTH = 240;
const RADAR_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

/** Pure cache policy for presenter cards; degraded current-request copy retries later. */
export function isRadarPresentationCacheable(
  card: Pick<RadarCardItem, 'presentationPending' | '_presentationFallback' | 'name'>,
  status: OpportunityStatus | undefined,
): boolean {
  return Boolean(
    status &&
    status !== 'negotiating' &&
    !card.presentationPending &&
    !card._presentationFallback &&
    card.name &&
    card.name !== 'Unknown',
  );
}

/**
 * Strip leading narrator name from remark when the UI already prepends "Name: " to the chip.
 * Avoids duplication like "Yankı Ekin Yüksel: Yankı Ekin Yüksel introduced you two..."
 * Repeats until no leading name (handles "Name: Name rest").
 */
export function stripLeadingNarratorName(remark: string, narratorName: string): string {
  let t = remark.trim();
  if (!t || !narratorName.trim()) return remark;
  const name = narratorName.trim();
  const nameLower = name.toLowerCase();
  for (;;) {
    const lower = t.toLowerCase();
    if (!lower.startsWith(nameLower)) break;
    const rest = t.slice(name.length).replace(/^\s*[:,\-–—]\s*/i, '').trim();
    if (rest.length === 0 || rest === t) break;
    t = rest;
  }
  return t;
}

/** Normalize timestamp for sorting; returns numeric ms or 0 for invalid/missing. */
const safeParseDate = (value: unknown): number => {
  if (value == null) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
};

/** Confidence score for sorting (interpretation.confidence or opportunity.confidence). */
const getRawConfidence = (opp: typeof RadarGraphState.State['opportunities'][number]): number => {
  const fromInterp = opp.interpretation?.confidence;
  if (typeof fromInterp === 'number' && !Number.isNaN(fromInterp)) return fromInterp;
  if (typeof fromInterp === 'string') {
    const n = parseFloat(fromInterp);
    if (!Number.isNaN(n)) return n;
  }
  const fromRow = opp.confidence;
  if (typeof fromRow === 'number' && !Number.isNaN(fromRow)) return fromRow;
  if (typeof fromRow === 'string') {
    const n = parseFloat(fromRow);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
};

/** Unique non-viewer userIds for an opportunity (actors can repeat). */
const getUniqueCounterpartUserIds = (
  opp: typeof RadarGraphState.State['opportunities'][number],
  viewerId: string
): Set<string> => {
  const ids = new Set<string>();
  for (const a of opp.actors) {
    if (a.userId !== viewerId && a.userId) {
      ids.add(a.userId);
    }
  }
  return ids;
};

const pickDisplayCounterpartActor = (
  opportunity: typeof RadarGraphState.State['opportunities'][number],
  viewerId: string
): { userId: string; role: string } | null => {
  const candidates = opportunity.actors.filter(
    (actor) => actor.userId !== viewerId
  );
  if (candidates.length === 0) {
    return null;
  }

  // Prefer direct counterpart roles when available, then stable sort by user id.
  const rolePriority = new Map<string, number>([
    ['patient', 0],
    ['party', 1],
    ['agent', 2],
    ['peer', 3],
  ]);

  const sorted = [...candidates].sort((a, b) => {
    const aPriority = rolePriority.get(a.role) ?? 99;
    const bPriority = rolePriority.get(b.role) ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.userId.localeCompare(b.userId);
  });
  return sorted[0] ?? null;
};

/** The graph's channel state, as every node sees it. */
export type RadarState = typeof RadarGraphState.State;

/** Everything the radar nodes reach for. */
export interface RadarGraphDeps {
  database: RadarGraphDb;
  cache: OpportunityCache;
  /** Card-copy presenter, shared across the run. */
  presenter: OpportunityPresenter;
}

export class RadarGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: RadarGraphDeps;

  constructor(database: RadarGraphDb, cache: OpportunityCache) {
    this.deps = { database, cache, presenter: new OpportunityPresenter() };
  }

  createGraph() {
    const deps = this.deps;
    const graph = new StateGraph(RadarGraphState)
      .addNode('loadOpportunities', (state: RadarState) => loadOpportunitiesNode(state, deps))
      .addNode('checkPresenterCache', (state: RadarState) => checkPresenterCacheNode(state, deps))
      .addNode('generateCardText', (state: RadarState) => generateCardTextNode(state, deps))
      .addNode('cachePresenterResults', (state: RadarState) => cachePresenterResultsNode(state, deps))
      .addNode('normalizeItems', normalizeItemsNode)
      .addEdge(START, 'loadOpportunities')
      .addEdge('loadOpportunities', 'checkPresenterCache')
      .addConditionalEdges('checkPresenterCache', (state: RadarState) => shouldGenerateCards(state, deps), {
        generate: 'generateCardText',
        skip: 'cachePresenterResults',
      })
      .addEdge('generateCardText', 'cachePresenterResults')
      .addEdge('cachePresenterResults', 'normalizeItems')
      .addEdge('normalizeItems', END);

    return graph.compile();
  }
}

export async function loadOpportunitiesNode(state: RadarState, deps: RadarGraphDeps) {
  return timed("RadarGraph.loadOpportunities", async () => {
    if (!state.userId) {
      return { error: 'userId is required' };
    }
    try {
      // Minimum of 50 ensures enough candidates across all radar categories
      // (connection, expired) for selectByComposition to fill
      // its soft targets, even after visibility filtering and dedup.
      const fetchLimit = Math.min(150, Math.max(50, state.limit * 3));
      const statuses = state.statuses ?? DEFAULT_RADAR_STATUSES;
      const options: { limit?: number; networkId?: string; scopeType?: 'intent'; scopeId?: string; statuses?: OpportunityStatus[] } = {
        limit: fetchLimit,
        statuses,
      };
      if (state.networkId) options.networkId = state.networkId;
      if (state.scopeType === 'intent' && state.scopeId) {
        options.scopeType = 'intent';
        options.scopeId = state.scopeId;
      }
      // Do not pass conversationId: radar view excludes draft opportunities (chat-only drafts).
      const raw = await deps.database.getOpportunitiesForUser(state.userId, options);
      const visible = raw.filter((opp) =>
        canUserSeeOpportunity(opp.actors, opp.status, state.userId)
      );
      // Actionability only gates the live statuses a viewer could act on:
      // latent/pending cards the viewer cannot act on are noise, but
      // terminal/internal statuses (accepted, rejected, expired, negotiating,
      // stalled, draft) are deliberate history — when a caller explicitly
      // requests them via `statuses`, they must pass through (they are never
      // actionable by rule 5, so filtering them here would return nothing).
      // The requested-status membership check is defense-in-depth: rows
      // outside the requested set are dropped even if the adapter drifts.
      const requestedStatuses = new Set<OpportunityStatus>(statuses);
      const visibleForRadar = visible.filter((opp) => {
        if (!requestedStatuses.has(opp.status)) return false;
        if (opp.status === 'pending') {
          return isActionableForViewer(opp.actors, opp.status, state.userId);
        }
        return true;
      });
      const explicitStatuses = (state.statuses?.length ?? 0) > 0;
      if (explicitStatuses) {
        // Lifecycle view (e.g. intent radar): newest-first so counterpart
        // dedup keeps each person's most recent state (an accepted
        // opportunity supersedes an older pending one), no composition
        // capping — the caller wants the full pipeline up to `limit`.
        const newestFirst = [...visibleForRadar].sort(
          (a, b) => safeParseDate(b.updatedAt) - safeParseDate(a.updatedAt)
        );
        const seenIds = new Set<string>();
        const dedupedByCounterpart = newestFirst.filter((opp) => {
          const counterpartIds = getUniqueCounterpartUserIds(opp, state.userId);
          const hasOverlap = [...counterpartIds].some((id) => seenIds.has(id));
          if (hasOverlap) return false;
          for (const id of counterpartIds) seenIds.add(id);
          return true;
        });
        return { opportunities: dedupedByCounterpart.slice(0, state.limit) };
      }
      const sorted = [...visibleForRadar].sort((a, b) => {
        const confA = getRawConfidence(a);
        const confB = getRawConfidence(b);
        if (confB !== confA) return confB - confA;
        const aTime = safeParseDate(a.updatedAt);
        const bTime = safeParseDate(b.updatedAt);
        return bTime - aTime;
      });
      const seenUserIds = new Set<string>();
      const deduped = sorted.filter((opp) => {
        const counterpartIds = getUniqueCounterpartUserIds(opp, state.userId);
        const hasOverlap = [...counterpartIds].some((id) => seenUserIds.has(id));
        if (hasOverlap) return false;
        for (const id of counterpartIds) seenUserIds.add(id);
        return true;
      });
      const opportunities = selectByComposition(deduped, state.userId);
      return { opportunities };
    } catch (e) {
      logger.error('RadarGraph loadOpportunities failed', { error: e });
      return { error: 'Failed to load opportunities', opportunities: [] };
    }
  });
}

export async function checkPresenterCacheNode(state: RadarState, deps: RadarGraphDeps) {
  return timed("RadarGraph.checkPresenterCache", async () => {
    const { opportunities, userId, scopeId } = state;
    if (opportunities.length === 0) {
      return { cachedCards: new Map(), uncachedOpportunities: [] };
    }

    if (state.noCache) {
      checkPresenterCacheLog.verbose('noCache=true, skipping cache');
      return { cachedCards: new Map(), uncachedOpportunities: opportunities };
    }

    try {
      // Negotiating cards are templated (no LLM call) and their text
      // depends on the live turn count, which changes between requests
      // without changing the opportunity status. Skip cache entirely
      // for them so each render reflects the current turn.
      //
      // For all other statuses, include status in the key so status
      // transitions (e.g. negotiating → pending) don't serve stale cards.
      const cacheable = opportunities.filter((opp) => opp.status !== 'negotiating');
      const liveNegotiating = opportunities.filter((opp) => opp.status === 'negotiating');

      const keys = cacheable.map((opp) =>
        buildRadarCardPresentationCacheKey(opp.id, opp.status, userId, scopeId)
      );
      const results = keys.length > 0 ? await deps.cache.mget<RadarCardItem>(keys) : [];

      const cachedCards = new Map<string, RadarCardItem>();
      const uncachedOpportunities: typeof opportunities = [...liveNegotiating];

      for (let i = 0; i < cacheable.length; i++) {
        const cached = results[i];
        if (cached) {
          const originalIndex = opportunities.indexOf(cacheable[i]);
          // Stamp the live status: pre-status cache entries lack the field,
          // and the key already guarantees it matches the current status.
          cachedCards.set(cacheable[i].id, {
            ...cached,
            status: cacheable[i].status,
            _cardIndex: originalIndex,
          });
        } else {
          uncachedOpportunities.push(cacheable[i]);
        }
      }

      checkPresenterCacheLog.verbose('', {
        total: opportunities.length,
        cacheHits: cachedCards.size,
        cacheMisses: uncachedOpportunities.length,
      });

      return { cachedCards, uncachedOpportunities };
    } catch (e) {
      checkPresenterCacheLog.warn('cache unavailable, skipping', { error: e });
      return { cachedCards: new Map(), uncachedOpportunities: opportunities };
    }
  });
}

export function shouldGenerateCards(state: RadarState, deps: RadarGraphDeps): string {
  if (state.uncachedOpportunities.length > 0) {
    return 'generate';
  }
  logger.verbose('All presenter results cached, skipping generation');
  return 'skip';
}

export async function generateCardTextNode(state: RadarState, deps: RadarGraphDeps) {
  return timed("RadarGraph.generateCardText", async () => {
  const opportunities = state.uncachedOpportunities.length > 0
    ? state.uncachedOpportunities
    : state.opportunities;
  generateCardTextLog.verbose('entry', { opportunitiesLength: opportunities.length, userId: state.userId });
  if (opportunities.length === 0) {
    generateCardTextLog.verbose('exit', { totalOpportunities: 0 });
    return { cards: [], agentTimings: [], meta: { totalOpportunities: 0 } };
  }
  const db = deps.database as PresenterDatabase & RadarGraphDb;
  const cards: RadarCardItem[] = [];
  const relevantActorIds = new Set<string>();
  for (const opp of opportunities) {
    for (const a of opp.actors) {
      if (a.userId) relevantActorIds.add(a.userId);
    }
  }

  const userEntries = await Promise.all(
    Array.from(relevantActorIds).map(async (userId) => {
      try {
        const user = await deps.database.getUser(userId);
        return [userId, user ?? null] as const;
      } catch {
        return [userId, null] as const;
      }
    })
  );
  const userMap = new Map(userEntries);

  const oppIndexMap = new Map(
    state.opportunities.map((opp, idx) => [opp.id, idx])
  );

  const agentTimingsAccum: DebugMetaAgent[] = [];

  for (let i = 0; i < opportunities.length; i += PRESENTATION_CONCURRENCY) {
    const chunk = opportunities.slice(i, i + PRESENTATION_CONCURRENCY);
    const chunkCards = await Promise.all(
      chunk.map(async (opportunity, offset) => {
        const cardIndex = oppIndexMap.get(opportunity.id) ?? (i + offset);
        const viewerActor = opportunity.actors.find((a) => a.userId === state.userId);
        const viewerRole = viewerActor?.role ?? 'party';
        const preferredActor = pickDisplayCounterpartActor(opportunity, state.userId)
          ?? opportunity.actors.find((a) => a.userId !== state.userId);
        const actorWithProfile = opportunity.actors.find(
          (a) => a.userId !== state.userId && !!userMap.get(a.userId)
        );
        const otherActor = (preferredActor && userMap.get(preferredActor.userId))
          ? preferredActor
          : (actorWithProfile ?? preferredActor);
        const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
        const counterparts = opportunity.actors.filter((a) => a.userId !== state.userId);
        // Deduplicate by userId — actors array can contain multiple rows per user
        // (e.g. from different intents), which would produce repeated names.
        const uniqueCounterpartIds = [...new Set(counterparts.map((a) => a.userId))];
        const participantNames = uniqueCounterpartIds
          .map((uid) => userMap.get(uid)?.name ?? 'Unknown')
          .sort();
        let userName = otherUser?.name ?? 'Unknown';
        // Fallback to profile identity name when users.name is missing (e.g. profile has display name, users row does not)
        if ((userName === 'Unknown' || !userName?.trim()) && otherActor?.userId && db.getProfile) {
          const profile = await db.getProfile(otherActor.userId).catch((err) => {
            logger.debug('getProfile fallback failed', { otherActorUserId: otherActor.userId, error: err });
            return null;
          });
          const profileName = profile?.identity?.name?.trim();
          if (profileName) userName = profileName;
        }
        // Unresolvable display counterpart (deleted user: no users row, no
        // profile fallback). Drop the card entirely instead of rendering an
        // "Unknown" placeholder: such cards are unusable, excluded from the
        // deps.presenter cache (see cachePresenterResults), and would otherwise
        // trigger a fresh deps.presenter LLM call on every request — a permanent
        // cache miss that keeps the whole radar slow (~9s per load).
        if (userName === 'Unknown' || !userName?.trim()) {
          logger.verbose('[RadarGraph:generateCardText] dropping card with unresolvable counterpart', {
            opportunityId: opportunity.id,
            otherActorUserId: otherActor?.userId,
          });
          return null;
        }
        const userAvatar = otherUser?.avatar ?? null;
        // Shared sanitization standard (UUID strip, viewer-centric rewrite,
        // boundary truncation) — raw reasoning must never render verbatim.
        const reasoningSnippet = safeFallbackSummary(
          typeof opportunity.interpretation?.reasoning === 'string'
            ? opportunity.interpretation.reasoning
            : '',
          {
            counterpartName: userName !== 'Unknown' ? userName : undefined,
            maxChars: MAX_REASONING_SNIPPET_LENGTH,
            emptyText: 'A promising connection.',
          },
        );


        // Skeleton presentation: return an identity-only card without the
        // deps.presenter LLM or negotiation-context load. Name resolution and
        // the unresolvable-counterpart drop above still apply, so the card
        // set matches what the follow-up full request will return.
        if (state.presentation === 'skeleton') {
          return {
            opportunityId: opportunity.id,
            status: opportunity.status,
            userId: otherActor?.userId ?? '',
            name: userName,
            avatar: userAvatar,
            mainText: '',
            cta: '',
            primaryActionLabel: getPrimaryActionLabel(viewerRole),
            secondaryActionLabel: SECONDARY_ACTION_LABEL,
            mutualIntentsLabel: 'Shared interests',
            viewerRole,
            presentationPending: true,
            _cardIndex: cardIndex,
          } satisfies RadarCardItem;
        }
        const fallbackCard = (outcomeReasoning?: string): RadarCardItem => ({
          opportunityId: opportunity.id,
          status: opportunity.status,
          userId: otherActor?.userId ?? '',
          name: userName,
          avatar: userAvatar,
          mainText: outcomeReasoning ?? reasoningSnippet,
          cta: 'Take a look and decide whether to reach out.',
          primaryActionLabel: getPrimaryActionLabel(viewerRole),
          secondaryActionLabel: SECONDARY_ACTION_LABEL,
          mutualIntentsLabel: 'Shared interests',
          narratorChip: { name: 'Index', text: 'Worth a look.' },
          viewerRole,
          _presentationFallback: true,
          _cardIndex: cardIndex,
        });

        try {
          const [ctx, negotiationContext] = await Promise.all([
            gatherPresenterContext(
              db,
              opportunity,
              state.userId,
              otherActor?.userId,
              state.scopeId,
            ),
            loadNegotiationContext(db, opportunity.id, opportunity.status, state.userId),
          ]);
          const presenterInput = {
            ...ctx,
            mutualIntentCount: undefined,
            opportunityStatus: opportunity.status,
            ...(negotiationContext ? { negotiationContext } : {}),
          };
          const _traceEmitterPresenter = requestContext.getStore()?.traceEmitter;
          const presenterStart = Date.now();
          _traceEmitterPresenter?.({ type: "agent_start", name: "opportunity-presenter" });
          const presentation = await deps.presenter.presentCard(presenterInput);
          const _presenterDuration = Date.now() - presenterStart;
          agentTimingsAccum.push({ name: 'opportunity.presenter', durationMs: _presenterDuration });
          _traceEmitterPresenter?.({ type: "agent_end", name: "opportunity-presenter", durationMs: _presenterDuration, summary: `Presented: ${userName}` });
          if (presentation.isFallback) {
            return fallbackCard(negotiationContext?.outcomeReasoning);
          }
          // Every card is system-discovered now: one narrator.
          const narratorChip: { name: string; text: string; avatar?: string | null; userId?: string } =
            { name: 'Index', text: presentation.narratorRemark };
          return {
            opportunityId: opportunity.id,
            status: opportunity.status,
            userId: otherActor?.userId ?? '',
            name: userName,
            avatar: userAvatar,
            // Resolve reasoning is private and already authorization-scoped by
            // the loader. Rendering it directly makes the resolved card explain
            // the owner's verdict instead of losing it to a completed task.
            mainText: negotiationContext?.outcomeReasoning ?? presentation.personalizedSummary,
            cta: presentation.suggestedAction,
            headline: presentation.headline,
            primaryActionLabel: getPrimaryActionLabel(viewerRole),
            secondaryActionLabel: SECONDARY_ACTION_LABEL,
            mutualIntentsLabel: presentation.mutualIntentsLabel,
            narratorChip,
            viewerRole,
            _cardIndex: cardIndex,
          } satisfies RadarCardItem;
        } catch (e) {
          logger.warn('RadarGraph presenter failed for opportunity', { opportunityId: opportunity.id, error: e });
          return fallbackCard();
        }
      })
    );
    cards.push(...chunkCards.filter((c): c is RadarCardItem => c !== null));
  }
  generateCardTextLog.verbose('exit', { totalOpportunities: state.opportunities.length });
  return {
    cards,
    agentTimings: agentTimingsAccum,
    meta: { totalOpportunities: state.opportunities.length },
  };
  });
}

export async function cachePresenterResultsNode(state: RadarState, deps: RadarGraphDeps) {
  return timed("RadarGraph.cachePresenterResults", async () => {
    const { cards, cachedCards, userId, opportunities, scopeId } = state;

    // Only cache cards that weren't already from cache
    const newCards = cards.filter((card) => !cachedCards.has(card.opportunityId));
    const statusById = new Map(opportunities.map((opp) => [opp.id, opp.status]));

    try {
      await Promise.all(
        newCards.map((card) => {
          const status = statusById.get(card.opportunityId);
          // Negotiating, skeleton, fallback, and unresolved-name cards are
          // safe for the current response but must not become 24h entries.
          if (!status || !isRadarPresentationCacheable(card, status)) return Promise.resolve();
          return deps.cache.set(
            buildRadarCardPresentationCacheKey(card.opportunityId, status, userId, scopeId),
            card,
            { ttl: RADAR_CACHE_TTL }
          );
        })
      );
    } catch (e) {
      cachePresenterResultsLog.warn('cache write failed, continuing', { error: e });
    }

    // Merge cached cards into full card list
    const allCards: RadarCardItem[] = [...cards];
    for (const [oppId, cachedCard] of cachedCards) {
      if (!cards.some((card) => card.opportunityId === oppId)) {
        allCards.push(cachedCard);
      }
    }

    // Re-sort by _cardIndex to maintain original ordering
    allCards.sort((a, b) => a._cardIndex - b._cardIndex);

    cachePresenterResultsLog.verbose('', {
      newlyCached: newCards.length,
      totalCards: allCards.length,
    });

    return {
      cards: allCards,
      meta: { totalOpportunities: state.opportunities.length },
    };
  });
}

export async function normalizeItemsNode(state: RadarState) {
  return timed("RadarGraph.normalizeItems", async () => {
    normalizeItemsLog.verbose('entry', { cardsLength: state.cards.length });
    const items: RadarResponseItem[] = state.cards.map((card) => {
      const { _cardIndex, _presentationFallback, ...rest } = card;
      return rest;
    });
    const meta = { totalOpportunities: state.opportunities.length };
    normalizeItemsLog.verbose('exit', { totalOpportunities: meta.totalOpportunities, totalItems: items.length });
    return { items, meta };
  });
}
