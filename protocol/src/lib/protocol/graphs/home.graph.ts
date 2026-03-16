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

import type { HomeGraphDatabase } from '../interfaces/database.interface';
import type { OpportunityCache } from '../interfaces/cache.interface';
import {
  HomeGraphState,
  type HomeCardItem,
  type HomeSection,
  type HomeSectionProposal,
  type HomeSectionItem,
} from '../states/home.state';
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from '../agents/opportunity.presenter';
import { HomeCategorizerAgent } from '../agents/home.categorizer';
import { canUserSeeOpportunity, isActionableForViewer } from '../support/opportunity.utils';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON } from '../support/lucide.icon-catalog';
import { protocolLogger } from '../support/protocol.logger';
import { timed } from '../../performance';

const logger = protocolLogger('HomeGraph');

/** Database must satisfy both HomeGraphDatabase and presenter context (getProfile, getActiveIntents, getIndex, getUser). */
type HomeGraphDb = HomeGraphDatabase;

export type HomeGraphInvokeInput = {
  userId: string;
  indexId?: string;
  limit?: number;
};

export type HomeGraphInvokeResult = {
  sections: HomeSection[];
  meta: { totalOpportunities: number; totalSections: number };
  error?: string;
};

const MAX_ITEMS_PER_SECTION = 20;
const PRESENTATION_CONCURRENCY = 50;
const MAX_REASONING_SNIPPET_LENGTH = 240;
const HOME_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

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

const toIntentArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toIntentKey = (intent: unknown): string | null => {
  if (typeof intent === 'string' || typeof intent === 'number') {
    return String(intent);
  }
  if (!intent || typeof intent !== 'object') {
    return null;
  }

  const record = intent as Record<string, unknown>;
  const candidate =
    record.intentId ?? record.id ?? record.payload ?? record.summary ?? record.title ?? record.name;

  if (typeof candidate === 'string' || typeof candidate === 'number') {
    return String(candidate);
  }
  return null;
};

const computeMutualIntentCount = (ctx: Record<string, unknown>): number => {
  const actorIntents = toIntentArray(ctx.intents ?? ctx.viewerIntents ?? ctx.actorIntents);
  const partnerIntents = toIntentArray(ctx.otherIntents ?? ctx.partnerIntents ?? ctx.otherPartyIntents);

  const actorIntentSet = new Set(
    actorIntents.map((intent) => toIntentKey(intent)).filter((key): key is string => key !== null)
  );
  const partnerIntentSet = new Set(
    partnerIntents.map((intent) => toIntentKey(intent)).filter((key): key is string => key !== null)
  );

  let overlap = 0;
  for (const key of actorIntentSet) {
    if (partnerIntentSet.has(key)) {
      overlap += 1;
    }
  }

  return overlap;
};

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
          const fetchLimit = Math.min(150, Math.max(state.limit * 3, state.limit));
          const options: { limit?: number; indexId?: string } = {
            limit: fetchLimit,
          };
          if (state.indexId) options.indexId = state.indexId;
          // Do not pass conversationId: home view excludes draft opportunities (chat-only drafts).
          const raw = await this.database.getOpportunitiesForUser(state.userId, options);
          const visible = raw.filter((opp) =>
            canUserSeeOpportunity(opp.actors, opp.status, state.userId)
          );
          const visibleForFeed = visible.filter((opp) =>
            isActionableForViewer(opp.actors, opp.status, state.userId)
          );
          const expired = raw.filter(
            (opp) =>
              opp.status === 'expired' && canUserSeeOpportunity(opp.actors, opp.status, state.userId)
          );
          const sorted = [...visibleForFeed].sort((a, b) => {
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
          const opportunities = deduped.slice(0, state.limit);
          return { opportunities, expired };
        } catch (e) {
          logger.error('HomeGraph loadOpportunities failed', { error: e });
          return { error: 'Failed to load opportunities', opportunities: [], expired: [] };
        }
      });
    };

    const checkPresenterCacheNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.checkPresenterCache", async () => {
        const { opportunities, userId } = state;
        if (opportunities.length === 0) {
          return { cachedCards: new Map(), uncachedOpportunities: [] };
        }

        try {
          const keys = opportunities.map(
            (opp) => `home:card:${opp.id}:${userId}`
          );
          const results = await this.cache.mget<HomeCardItem>(keys);

          const cachedCards = new Map<string, HomeCardItem>();
          const uncachedOpportunities: typeof opportunities = [];

          for (let i = 0; i < opportunities.length; i++) {
            const cached = results[i];
            if (cached) {
              cachedCards.set(opportunities[i].id, { ...cached, _cardIndex: i });
            } else {
              uncachedOpportunities.push(opportunities[i]);
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
      const db = this.database as PresenterDatabase;
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

      const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];

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
            const participantNames = introducerCounterparts
              .map((actor) => userMap.get(actor.userId)?.name ?? 'Unknown')
              .sort();
            // Introducer always sees both party names (e.g. "Alice ↔ Bob"), regardless of status
            let userName = isIntroducer && participantNames.length > 0
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

            const isCounterpartGhost = otherUser?.isGhost ?? false;
            const fallbackCard = (): HomeCardItem => ({
              opportunityId: opportunity.id,
              userId: otherActor?.userId ?? '',
              name: userName,
              avatar: userAvatar,
              mainText: reasoningSnippet.slice(0, 300),
              cta: isIntroducer
                ? 'Share this introduction to get things started.'
                : 'Take a look and decide whether to reach out.',
              primaryActionLabel: isIntroducer ? 'Good match' : (isCounterpartGhost ? 'Invite to chat' : 'Start Chat'),
              secondaryActionLabel: isIntroducer ? 'Pass' : 'Skip',
              mutualIntentsLabel: isIntroducer ? 'Connector match' : 'Shared interests',
              narratorChip: { name: 'Index', text: 'Worth a look.' },
              viewerRole,
              isGhost: isCounterpartGhost,
              _cardIndex: cardIndex,
            });

            try {
              const ctx = await gatherPresenterContext(
                db,
                opportunity,
                state.userId,
                otherActor?.userId,
              );
              const mutualIntentCount = computeMutualIntentCount(ctx as unknown as Record<string, unknown>);
              const homeInput = {
                ...ctx,
                mutualIntentCount,
                opportunityStatus: opportunity.status,
              };
              const presenterStart = Date.now();
              const presentation = await presenter.presentHomeCard(homeInput);
              agentTimingsAccum.push({ name: 'opportunity.presenter', durationMs: Date.now() - presenterStart });
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
                primaryActionLabel: isCounterpartGhost && !isIntroducer ? 'Invite to chat' : presentation.primaryActionLabel,
                secondaryActionLabel: presentation.secondaryActionLabel,
                mutualIntentsLabel: presentation.mutualIntentsLabel,
                narratorChip,
                viewerRole,
                isGhost: isCounterpartGhost,
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
        const { cards, cachedCards, userId } = state;

        // Only cache cards that weren't already from cache
        const newCards = cards.filter((card) => !cachedCards.has(card.opportunityId));

        try {
          await Promise.all(
            newCards.map((card) =>
              this.cache.set(
                `home:card:${card.opportunityId}:${userId}`,
                card,
                { ttl: HOME_CACHE_TTL }
              )
            )
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

        try {
          const oppIds = state.cards
            .map((c) => c.opportunityId)
            .join(',');
          const hash = createHash('sha256').update(oppIds).digest('hex').slice(0, 16);
          const key = `home:categories:${state.userId}:${hash}`;

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
        const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];
        const categorizerInput = state.cards.map((c) => ({
          index: c._cardIndex,
          headline: c.headline,
          mainText: c.mainText,
          name: c.name,
          viewerRole:
            c.primaryActionLabel === 'Good match' && c.secondaryActionLabel === 'Pass'
              ? 'introducer'
              : undefined,
          opportunityStatus:
            c.primaryActionLabel === 'Good match' && c.secondaryActionLabel === 'Pass'
              ? 'pending'
              : undefined,
        }));
        const categorizerStart = Date.now();
        const { sections } = await categorizer.categorize(categorizerInput);
        agentTimingsAccum.push({ name: 'home.categorizer', durationMs: Date.now() - categorizerStart });
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
          const oppIds = state.cards
            .map((c) => c.opportunityId)
            .join(',');
          const hash = createHash('sha256').update(oppIds).digest('hex').slice(0, 16);
          const key = `home:categories:${state.userId}:${hash}`;

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
