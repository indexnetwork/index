/**
 * Home Graph: Build the opportunity home view with dynamic sections.
 *
 * Independent of ChatGraph. Flow:
 * loadOpportunities → checkPresenterCache → [generateCardText if misses] → cachePresenterResults
 * → checkCategorizerCache → [categorizeDynamically if miss] → cacheCategorizerResults → normalizeAndSort
 *
 * Uses OpportunityPresenter for card text and an LLM to categorize cards into dynamic sections
 * with titles and Lucide icon names. Caches presenter and categorizer results via OpportunityCache.
 */

import { createHash } from 'crypto';

import { StateGraph, START, END } from '@langchain/langgraph';

import type { HomeGraphDatabase, OpportunityStatus } from '../../shared/interfaces/database.interface.js';
import type { OpportunityCache } from '../../shared/interfaces/cache.interface.js';
import { HomeGraphState, type HomeCardItem, type HomeSection, type HomeSectionProposal, type HomeSectionItem } from './feed.state.js';
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from '../opportunity.presenter.js';
import { loadNegotiationContext } from '../negotiation-context.loader.js';
import { HomeCategorizerAgent } from './feed.categorizer.js';
import { canUserSeeOpportunity, isActionableForViewer, selectByComposition } from '../opportunity.utils.js';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON } from '../../shared/ui/lucide.icon-catalog.js';
import { getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from '../opportunity.labels.js';
import type { DebugMetaAgent } from '../../chat/chat-streaming.types.js';
import { protocolLogger } from '../../shared/observability/protocol.logger.js';
import { timed } from '../../shared/observability/performance.js';
import { requestContext } from "../../shared/observability/request-context.js";

const logger = protocolLogger('HomeGraph');

/** Database must satisfy both HomeGraphDatabase and presenter context (getProfile, getActiveIntents, getNetwork, getUser). */
type HomeGraphDb = HomeGraphDatabase;

export type HomeGraphInvokeInput = {
  userId: string;
  networkId?: string;
  scopeType?: 'intent';
  scopeId?: string;
  limit?: number;
  noCache?: boolean;
  /** When set, filter loaded opportunities to these lifecycle statuses. Defaults to `DEFAULT_HOME_STATUSES`. */
  statuses?: OpportunityStatus[];
};

export type HomeGraphInvokeResult = {
  sections: HomeSection[];
  meta: { totalOpportunities: number; totalSections: number };
  error?: string;
};

/** Default home-feed statuses: the lifecycle stages a viewer can act on today. */
export const DEFAULT_HOME_STATUSES: OpportunityStatus[] = ['latent', 'pending'];

// Exhaustive registry — keys must cover every OpportunityStatus union member.
// Adding a new status to OpportunityStatus without adding a key here is a TS error,
// which is the whole point: prevents ALL_OPPORTUNITY_STATUSES from silently drifting.
const OPPORTUNITY_STATUS_REGISTRY: Record<OpportunityStatus, true> = {
  latent: true,
  draft: true,
  negotiating: true,
  pending: true,
  stalled: true,
  accepted: true,
  rejected: true,
  expired: true,
};

/** Full status enumeration. Pass this to `HomeGraphInvokeInput.statuses` to restore pre-Issue-3 (unfiltered) behavior. */
export const ALL_OPPORTUNITY_STATUSES: OpportunityStatus[] = Object.keys(
  OPPORTUNITY_STATUS_REGISTRY,
) as OpportunityStatus[];

const MAX_ITEMS_PER_SECTION = 20;
const PRESENTATION_CONCURRENCY = 50;
const MAX_REASONING_SNIPPET_LENGTH = 240;
const HOME_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

/** Redis key for the categorizer cache, derived from the user and the ordered opportunity-id set. */
function buildCategorizerCacheKey(userId: string, cards: HomeCardItem[]): string {
  const oppIds = cards.map((c) => c.opportunityId).join(',');
  const hash = createHash('sha256').update(oppIds).digest('hex').slice(0, 16);
  return `home:categories:${userId}:${hash}`;
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
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
};

/** Confidence score for sorting (interpretation.confidence or opportunity.confidence). */
const getConfidence = (opp: typeof HomeGraphState.State['opportunities'][number]): number => {
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

/** Unique non-introducer, non-viewer userIds for an opportunity (actors can repeat). */
const getUniqueCounterpartUserIds = (
  opp: typeof HomeGraphState.State['opportunities'][number],
  viewerId: string
): Set<string> => {
  const ids = new Set<string>();
  for (const a of opp.actors) {
    if (a.role !== 'introducer' && a.userId !== viewerId && a.userId) {
      ids.add(a.userId);
    }
  }
  return ids;
};

const pickDisplayCounterpartActor = (
  opportunity: typeof HomeGraphState.State['opportunities'][number],
  viewerId: string
): { userId: string; role: string } | null => {
  const candidates = opportunity.actors.filter(
    (actor) => actor.userId !== viewerId && actor.role !== 'introducer'
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

export class HomeGraphFactory {
  constructor(private database: HomeGraphDb, private cache: OpportunityCache) {}

  createGraph() {
    const presenter = new OpportunityPresenter();
    const categorizer = new HomeCategorizerAgent();

    const loadOpportunitiesNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.loadOpportunities", async () => {
        if (!state.userId) {
          return { error: 'userId is required' };
        }
        try {
          // Minimum of 50 ensures enough candidates across all feed categories
          // (connection, connector-flow, expired) for selectByComposition to fill
          // its soft targets, even after visibility filtering and dedup.
          const fetchLimit = Math.min(150, Math.max(50, state.limit * 3));
          const statuses = state.statuses ?? DEFAULT_HOME_STATUSES;
          const options: { limit?: number; networkId?: string; scopeType?: 'intent'; scopeId?: string; statuses?: OpportunityStatus[] } = {
            limit: fetchLimit,
            statuses,
          };
          if (state.networkId) options.networkId = state.networkId;
          if (state.scopeType === 'intent' && state.scopeId) {
            options.scopeType = 'intent';
            options.scopeId = state.scopeId;
          }
          // Do not pass conversationId: home view excludes draft opportunities (chat-only drafts).
          const raw = await this.database.getOpportunitiesForUser(state.userId, options);
          const visible = raw.filter((opp) =>
            canUserSeeOpportunity(opp.actors, opp.status, state.userId)
          );
          const visibleForFeed = visible.filter((opp) =>
            isActionableForViewer(opp.actors, opp.status, state.userId)
          );
          const sorted = [...visibleForFeed].sort((a, b) => {
            // Connections before connector-flow so dedup claims counterpart IDs
            // for direct connections first — prevents introducer cards from
            // shadowing a user's own connection opportunities.
            const aIsIntroducer = a.actors.some((ac) => ac.userId === state.userId && ac.role === 'introducer');
            const bIsIntroducer = b.actors.some((ac) => ac.userId === state.userId && ac.role === 'introducer');
            if (aIsIntroducer !== bIsIntroducer) return aIsIntroducer ? 1 : -1;
            const confA = getConfidence(a);
            const confB = getConfidence(b);
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
          logger.error('HomeGraph loadOpportunities failed', { error: e });
          return { error: 'Failed to load opportunities', opportunities: [] };
        }
      });
    };

    const checkPresenterCacheNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.checkPresenterCache", async () => {
        const { opportunities, userId } = state;
        if (opportunities.length === 0) {
          return { cachedCards: new Map(), uncachedOpportunities: [] };
        }

        if (state.noCache) {
          logger.verbose('[HomeGraph:checkPresenterCache] noCache=true, skipping cache');
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

          const keys = cacheable.map(
            (opp) => `home:card:${opp.id}:${opp.status}:${userId}`
          );
          const results = keys.length > 0 ? await this.cache.mget<HomeCardItem>(keys) : [];

          const cachedCards = new Map<string, HomeCardItem>();
          const uncachedOpportunities: typeof opportunities = [...liveNegotiating];

          for (let i = 0; i < cacheable.length; i++) {
            const cached = results[i];
            if (cached) {
              const originalIndex = opportunities.indexOf(cacheable[i]);
              cachedCards.set(cacheable[i].id, { ...cached, _cardIndex: originalIndex });
            } else {
              uncachedOpportunities.push(cacheable[i]);
            }
          }

          logger.verbose('[HomeGraph:checkPresenterCache]', {
            total: opportunities.length,
            cacheHits: cachedCards.size,
            cacheMisses: uncachedOpportunities.length,
          });

          return { cachedCards, uncachedOpportunities };
        } catch (e) {
          logger.warn('[HomeGraph:checkPresenterCache] cache unavailable, skipping', { error: e });
          return { cachedCards: new Map(), uncachedOpportunities: opportunities };
        }
      });
    };

    const shouldGenerateCards = (state: typeof HomeGraphState.State): string => {
      if (state.uncachedOpportunities.length > 0) {
        return 'generate';
      }
      logger.verbose('[HomeGraph] All presenter results cached, skipping generation');
      return 'skip';
    };

    const generateCardTextNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.generateCardText", async () => {
      const opportunities = state.uncachedOpportunities.length > 0
        ? state.uncachedOpportunities
        : state.opportunities;
      logger.verbose('[HomeGraph:generateCardText] entry', { opportunitiesLength: opportunities.length, userId: state.userId });
      if (opportunities.length === 0) {
        logger.verbose('[HomeGraph:generateCardText] exit', { totalOpportunities: 0, totalSections: 0 });
        return { cards: [], agentTimings: [], meta: { totalOpportunities: 0, totalSections: 0 } };
      }
      const db = this.database as PresenterDatabase & HomeGraphDb;
      const cards: HomeCardItem[] = [];
      const relevantActorIds = new Set<string>();
      for (const opp of opportunities) {
        for (const a of opp.actors) {
          if (a.userId) relevantActorIds.add(a.userId);
        }
      }

      const userEntries = await Promise.all(
        Array.from(relevantActorIds).map(async (userId) => {
          try {
            const user = await this.database.getUser(userId);
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
            const isIntroducer = viewerRole === 'introducer';
            const isPendingIntroducer = isIntroducer && opportunity.status === 'pending';
            const preferredActor = pickDisplayCounterpartActor(opportunity, state.userId)
              ?? opportunity.actors.find((a) => a.userId !== state.userId && a.role !== 'introducer');
            const actorWithProfile = opportunity.actors.find(
              (a) => a.userId !== state.userId && a.role !== 'introducer' && !!userMap.get(a.userId)
            );
            const introducer = opportunity.actors.find((a) => a.role === 'introducer');
            let otherActor = (preferredActor && userMap.get(preferredActor.userId))
              ? preferredActor
              : (actorWithProfile ?? preferredActor);
            // When the only other participant is the introducer (no separate party), use introducer as display counterpart so the card shows a name instead of "Unknown"
            if (!otherActor && introducer && introducer.userId !== state.userId && introducer.userId) {
              otherActor = { userId: introducer.userId, role: introducer.role };
            }
            const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
            const introducerCounterparts = opportunity.actors.filter(
              (a) => a.userId !== state.userId && a.role !== 'introducer'
            );
            // Deduplicate by userId — actors array can contain multiple rows per user
            // (e.g. from different intents), which would produce repeated names.
            const uniqueCounterpartIds = [...new Set(introducerCounterparts.map((a) => a.userId))];
            const participantNames = uniqueCounterpartIds
              .map((uid) => userMap.get(uid)?.name ?? 'Unknown')
              .sort();
            // When secondPartyData will be present (2+ counterparts), use single counterpart name
            // because the frontend arrow layout renders "card.name → secondParty.name".
            // Using the joined "A ↔ B" format here would produce redundant "A ↔ B → B".
            // Only use the joined format when there is a single counterpart (no arrow layout).
            const willHaveSecondParty = isIntroducer && uniqueCounterpartIds.length > 1;
            let userName = isIntroducer && participantNames.length > 0 && !willHaveSecondParty
              ? participantNames.join(' ↔ ')
              : (otherUser?.name ?? 'Unknown');
            // Fallback to profile identity name when users.name is missing (e.g. profile has display name, users row does not)
            if ((userName === 'Unknown' || !userName?.trim()) && otherActor?.userId && db.getProfile) {
              const profile = await db.getProfile(otherActor.userId).catch((err) => {
                logger.debug('[HomeGraph] getProfile fallback failed', { otherActorUserId: otherActor.userId, error: err });
                return null;
              });
              const profileName = profile?.identity?.name?.trim();
              if (profileName) userName = profileName;
            }
            const userAvatar = otherUser?.avatar ?? null;
            const reasoningSnippet =
              (typeof opportunity.interpretation?.reasoning === 'string'
                ? opportunity.interpretation.reasoning.replace(/\s+/g, ' ').trim().slice(0, MAX_REASONING_SNIPPET_LENGTH)
                : '') || 'A promising connection.';

            // Build secondParty for introducer arrow layout (the party that isn't the display counterpart)
            let secondPartyData: { name: string; avatar?: string | null; userId?: string } | undefined;
            if (isIntroducer && introducerCounterparts.length > 1 && otherActor) {
              const secondActor = introducerCounterparts.find((a) => a.userId !== otherActor.userId);
              if (secondActor) {
                const secondUser = userMap.get(secondActor.userId) ?? null;
                secondPartyData = {
                  name: secondUser?.name ?? 'Unknown',
                  avatar: secondUser?.avatar ?? null,
                  userId: secondActor.userId,
                };
              }
            }

            const isCounterpartGhost = otherUser?.isGhost ?? false;
            const isPendingIntroducerFallback = isIntroducer && opportunity.status !== 'latent';
            const fallbackCard = (): HomeCardItem => ({
              opportunityId: opportunity.id,
              userId: otherActor?.userId ?? '',
              name: userName,
              avatar: userAvatar,
              mainText: reasoningSnippet.slice(0, 300),
              cta: isIntroducer
                ? (isPendingIntroducerFallback ? 'Share this introduction to get things started.' : 'Take a look and decide if this is a good match.')
                : 'Take a look and decide whether to reach out.',
              primaryActionLabel: getPrimaryActionLabel(viewerRole),
              secondaryActionLabel: SECONDARY_ACTION_LABEL,
              mutualIntentsLabel: isIntroducer ? 'Connector match' : 'Shared interests',
              narratorChip: isIntroducer
                ? { name: 'You', text: 'Worth a look.', userId: state.userId }
                : { name: 'Index', text: 'Worth a look.' },
              viewerRole,
              isGhost: isCounterpartGhost,
              ...(secondPartyData ? { secondParty: secondPartyData } : {}),
              _cardIndex: cardIndex,
            });

            try {
              const [ctx, negotiationContext] = await Promise.all([
                gatherPresenterContext(
                  db,
                  opportunity,
                  state.userId,
                  otherActor?.userId,
                ),
                loadNegotiationContext(db, opportunity.id, opportunity.status),
              ]);
              const homeInput = {
                ...ctx,
                mutualIntentCount: undefined,
                opportunityStatus: opportunity.status,
                ...(negotiationContext ? { negotiationContext } : {}),
              };
              const _traceEmitterPresenter = requestContext.getStore()?.traceEmitter;
              const presenterStart = Date.now();
              _traceEmitterPresenter?.({ type: "agent_start", name: "opportunity-presenter" });
              const presentation = await presenter.presentHomeCard(homeInput);
              const _presenterDuration = Date.now() - presenterStart;
              agentTimingsAccum.push({ name: 'opportunity.presenter', durationMs: _presenterDuration });
              _traceEmitterPresenter?.({ type: "agent_end", name: "opportunity-presenter", durationMs: _presenterDuration, summary: `Presented: ${userName}` });
              let narratorChip: { name: string; text: string; avatar?: string | null; userId?: string } | undefined;
              // Only show a person as narrator when they are the introducer and not the display counterpart
              // (bad data can have same user as introducer and party, e.g. "Amina introduced you to Amina")
              const introducerIsCounterpart = introducer && otherActor && introducer.userId === otherActor.userId;
              if (introducer && introducer.userId !== state.userId && !introducerIsCounterpart) {
                const introUser = userMap.get(introducer.userId) ?? null;
                const narratorName = introUser?.name ?? 'Someone';
                narratorChip = {
                  name: narratorName,
                  text: stripLeadingNarratorName(presentation.narratorRemark, narratorName),
                  avatar: introUser?.avatar ?? null,
                  userId: introducer.userId,
                };
              } else if (introducer?.userId === state.userId) {
                narratorChip = { name: 'You', text: presentation.narratorRemark, userId: state.userId };
              } else {
                narratorChip = { name: 'Index', text: presentation.narratorRemark };
              }
              return {
                opportunityId: opportunity.id,
                userId: otherActor?.userId ?? '',
                name: userName,
                avatar: userAvatar,
                mainText: presentation.personalizedSummary,
                cta: presentation.suggestedAction,
                headline: presentation.headline,
                primaryActionLabel: getPrimaryActionLabel(viewerRole),
                secondaryActionLabel: SECONDARY_ACTION_LABEL,
                mutualIntentsLabel: presentation.mutualIntentsLabel,
                narratorChip,
                viewerRole,
                isGhost: isCounterpartGhost,
                ...(secondPartyData ? { secondParty: secondPartyData } : {}),
                _cardIndex: cardIndex,
              } satisfies HomeCardItem;
            } catch (e) {
              logger.warn('HomeGraph presenter failed for opportunity', { opportunityId: opportunity.id, error: e });
              return fallbackCard();
            }
          })
        );
        cards.push(...chunkCards);
      }
      logger.verbose('[HomeGraph:generateCardText] exit', { totalOpportunities: state.opportunities.length, totalSections: 0 });
      return {
        cards,
        agentTimings: agentTimingsAccum,
        meta: { totalOpportunities: state.opportunities.length, totalSections: 0 },
      };
      });
    };

    const cachePresenterResultsNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.cachePresenterResults", async () => {
        const { cards, cachedCards, userId, opportunities } = state;

        // Only cache cards that weren't already from cache
        const newCards = cards.filter((card) => !cachedCards.has(card.opportunityId));
        const statusById = new Map(opportunities.map((opp) => [opp.id, opp.status]));

        try {
          await Promise.all(
            newCards.map((card) => {
              const status = statusById.get(card.opportunityId);
              // Skip persisting negotiating cards — see read-side note.
              if (!status || status === 'negotiating') return Promise.resolve();
              // Skip caching cards with unresolved names — transient DB failures
              // would persist "Unknown" placeholders for the full TTL.
              if (!card.name || card.name === 'Unknown') return Promise.resolve();
              return this.cache.set(
                `home:card:${card.opportunityId}:${status}:${userId}`,
                card,
                { ttl: HOME_CACHE_TTL }
              );
            })
          );
        } catch (e) {
          logger.warn('[HomeGraph:cachePresenterResults] cache write failed, continuing', { error: e });
        }

        // Merge cached cards into full card list
        const allCards: HomeCardItem[] = [...cards];
        for (const [oppId, cachedCard] of cachedCards) {
          if (!cards.some((c) => c.opportunityId === oppId)) {
            allCards.push(cachedCard);
          }
        }

        // Re-sort by _cardIndex to maintain original ordering
        allCards.sort((a, b) => a._cardIndex - b._cardIndex);

        logger.verbose('[HomeGraph:cachePresenterResults]', {
          newlyCached: newCards.length,
          totalCards: allCards.length,
        });

        return {
          cards: allCards,
          meta: { totalOpportunities: state.opportunities.length, totalSections: 0 },
        };
      });
    };

    const checkCategorizerCacheNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.checkCategorizerCache", async () => {
        if (state.cards.length === 0) {
          return { categoryCacheHit: false };
        }

        if (state.noCache) {
          logger.verbose('[HomeGraph:checkCategorizerCache] noCache=true, skipping cache');
          return { categoryCacheHit: false };
        }

        try {
          const key = buildCategorizerCacheKey(state.userId, state.cards);

          const cached = await this.cache.get<HomeSectionProposal[]>(key);
          if (cached) {
            logger.verbose('[HomeGraph:checkCategorizerCache] cache hit');
            return { sectionProposals: cached, categoryCacheHit: true };
          }

          logger.verbose('[HomeGraph:checkCategorizerCache] cache miss');
        } catch (e) {
          logger.warn('[HomeGraph:checkCategorizerCache] cache unavailable, skipping', { error: e });
        }
        return { categoryCacheHit: false };
      });
    };

    const shouldCategorize = (state: typeof HomeGraphState.State): string => {
      if (state.categoryCacheHit) {
        logger.verbose('[HomeGraph] Categorizer results cached, skipping');
        return 'skip';
      }
      return 'categorize';
    };

    const categorizeDynamicallyNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.categorizeDynamically", async () => {
        logger.verbose('[HomeGraph:categorizeDynamically] entry', { cardsLength: state.cards.length });
        if (state.cards.length === 0) {
          logger.verbose('[HomeGraph:categorizeDynamically] exit', { sectionProposalsCount: 0 });
          return { sectionProposals: [], agentTimings: [] };
        }
        const agentTimingsAccum: DebugMetaAgent[] = [];
        const categorizerInput = state.cards.map((c) => ({
          index: c._cardIndex,
          headline: c.headline,
          mainText: c.mainText,
          name: c.name,
          viewerRole: c.viewerRole === 'introducer' ? 'introducer' : undefined,
          opportunityStatus: c.viewerRole === 'introducer' ? 'pending' : undefined,
        }));
        const _traceEmitterCategorizer = requestContext.getStore()?.traceEmitter;
        const categorizerStart = Date.now();
        _traceEmitterCategorizer?.({ type: "agent_start", name: "home-categorizer" });
        const { sections } = await categorizer.categorize(categorizerInput);
        const _categorizerDuration = Date.now() - categorizerStart;
        agentTimingsAccum.push({ name: 'home.categorizer', durationMs: _categorizerDuration });
        _traceEmitterCategorizer?.({ type: "agent_end", name: "home-categorizer", durationMs: _categorizerDuration, summary: `Categorized into ${sections.length} section(s)` });
        const proposals: HomeSectionProposal[] = sections.map((s) => ({
          ...s,
          itemIndices: s.itemIndices.filter((i) => i >= 0 && i < state.cards.length),
        }));
        logger.verbose('[HomeGraph:categorizeDynamically] exit', { sectionProposalsCount: proposals.length });
        return { sectionProposals: proposals, agentTimings: agentTimingsAccum };
      });
    };

    const cacheCategorizerResultsNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.cacheCategorizerResults", async () => {
        if (state.categoryCacheHit || state.sectionProposals.length === 0) {
          return {};
        }

        try {
          const key = buildCategorizerCacheKey(state.userId, state.cards);

          await this.cache.set(key, state.sectionProposals, { ttl: HOME_CACHE_TTL });

          logger.verbose('[HomeGraph:cacheCategorizerResults] cached', {
            sectionCount: state.sectionProposals.length,
          });
        } catch (e) {
          logger.warn('[HomeGraph:cacheCategorizerResults] cache write failed, continuing', { error: e });
        }

        return {};
      });
    };

    const normalizeAndSortNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.normalizeAndSort", async () => {
        const cards = state.cards;
        const proposals = state.sectionProposals;
        logger.verbose('[HomeGraph:normalizeAndSort] entry', { cardsLength: cards.length, proposalsLength: proposals.length });
        if (cards.length === 0) {
          logger.verbose('[HomeGraph:normalizeAndSort] exit', { totalOpportunities: 0, totalSections: 0 });
          return { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } };
        }
        const usedIndices = new Set<number>();
        const sections: HomeSection[] = proposals.map((p) => {
          const iconName = resolveHomeSectionIcon(p.iconName);
          const items: HomeSectionItem[] = p.itemIndices
            .filter((i) => i >= 0 && i < cards.length && !usedIndices.has(i))
            .slice(0, MAX_ITEMS_PER_SECTION)
            .map((i) => {
              usedIndices.add(i);
              const card = cards[i];
              const { _cardIndex, ...rest } = card;
              return rest;
            });
          return {
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            iconName,
            items,
          };
        });

        // Enforce category ordering: sections with connections first, then
        // connector-flow only, then expired only. This prevents the LLM
        // categorizer from placing introducer sections before connection sections.
        const sectionCategoryPriority = (section: HomeSection): number => {
          const hasConnection = section.items.some((item) => item.viewerRole !== 'introducer');
          if (hasConnection) return 0; // mixed or connection-only sections first
          const hasConnectorFlow = section.items.some((item) => item.viewerRole === 'introducer');
          if (hasConnectorFlow) return 1; // connector-flow only sections next
          return 2; // empty or expired sections last
        };
        sections.sort((a, b) => sectionCategoryPriority(a) - sectionCategoryPriority(b));
        const meta = {
          totalOpportunities: state.opportunities.length,
          totalSections: sections.length,
        };
        logger.verbose('[HomeGraph:normalizeAndSort] exit', { totalOpportunities: meta.totalOpportunities, totalSections: meta.totalSections });
        return { sections, meta };
      });
    };

    const graph = new StateGraph(HomeGraphState)
      .addNode('loadOpportunities', loadOpportunitiesNode)
      .addNode('checkPresenterCache', checkPresenterCacheNode)
      .addNode('generateCardText', generateCardTextNode)
      .addNode('cachePresenterResults', cachePresenterResultsNode)
      .addNode('checkCategorizerCache', checkCategorizerCacheNode)
      .addNode('categorizeDynamically', categorizeDynamicallyNode)
      .addNode('cacheCategorizerResults', cacheCategorizerResultsNode)
      .addNode('normalizeAndSort', normalizeAndSortNode)
      .addEdge(START, 'loadOpportunities')
      .addEdge('loadOpportunities', 'checkPresenterCache')
      .addConditionalEdges('checkPresenterCache', shouldGenerateCards, {
        generate: 'generateCardText',
        skip: 'cachePresenterResults',
      })
      .addEdge('generateCardText', 'cachePresenterResults')
      .addEdge('cachePresenterResults', 'checkCategorizerCache')
      .addConditionalEdges('checkCategorizerCache', shouldCategorize, {
        categorize: 'categorizeDynamically',
        skip: 'normalizeAndSort',
      })
      .addEdge('categorizeDynamically', 'cacheCategorizerResults')
      .addEdge('cacheCategorizerResults', 'normalizeAndSort')
      .addEdge('normalizeAndSort', END);

    return graph.compile();
  }
}
