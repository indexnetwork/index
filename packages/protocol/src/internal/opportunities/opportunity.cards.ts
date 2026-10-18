/**
 * Opportunity cards: presenter-texted cards for a viewer, as a list or one at
 * a time. The list loads, filters, and dedupes the viewer's opportunities,
 * serves cached cards, and presents the misses through OpportunityPresenter.
 */

import type { Opportunity, OpportunityCardsDatabase, OpportunityStatus, PeerChat, PriorOpportunity } from '../../platform/database.js';
import type { OpportunityCache } from '../../platform/discovery/cache.js';

import { protocolLogger } from '../shared/observability/protocol.logger.js';
import { OpportunityPresenter, buildOpportunityCardCacheKey, gatherPresenterContext } from './opportunity.presentation.js';
import { loadNegotiationContext } from './negotiation-context.loader.js';
import { canUserSeeOpportunity } from './opportunity.utils.js';
import { getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from './opportunity.labels.js';

const logger = protocolLogger('OpportunityCards');

const PRESENTATION_CONCURRENCY = 50;

/** One opportunity with its presenter-driven display contract. */
export interface OpportunityCard {
  opportunityId: string;
  createdAt?: string;
  /** Lifecycle status of the underlying opportunity at render time. */
  status?: OpportunityStatus;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline?: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  /** Viewer's role in this opportunity (e.g. 'party', 'agent', 'patient', 'peer'). */
  viewerRole?: string;
  /** This viewer already committed. Status can still be pending until the other person accepts. */
  viewerCommitted?: boolean;
  /**
   * True for a skeleton card: identity fields are real but mainText/cta are
   * empty because the presenter was skipped. Never cached.
   */
  presentationPending?: boolean;
  /** An earlier opportunity with this person. Stamped live on every read, never cached. */
  priorOpportunity?: PriorOpportunity | null;
  /** The direct-message chat with this person. Stamped live on every read, never cached. */
  peerChat?: PeerChat | null;
  /** Which prior opportunity the cached copy was written against, so a changed one regenerates it. */
  presentedPrior?: string | null;
}

/** What the viewer already has with one counterpart, besides the opportunity being shown. */
interface PeerContext {
  priorOpportunity: PriorOpportunity | null;
  peerChat: PeerChat | null;
}

const priorKey = (prior: PriorOpportunity | null | undefined) => prior ? `${prior.opportunityId}:${prior.status}` : null;

/** Everything card presentation reaches for. */
export interface OpportunityCardsDeps {
  database: OpportunityCardsDatabase;
  cache: OpportunityCache;
  presenter: OpportunityPresenter;
}

const ROLE_PRIORITY = new Map<string, number>([
  ['patient', 0],
  ['party', 1],
  ['agent', 2],
  ['peer', 3],
]);

/** Prefer direct counterpart roles, then a stable sort by user id. */
function pickDisplayCounterpartActor(opportunity: Opportunity, viewerId: string) {
  const candidates = opportunity.actors.filter((actor) => actor.userId !== viewerId);
  return [...candidates].sort((a, b) => {
    const aPriority = ROLE_PRIORITY.get(a.role) ?? 99;
    const bPriority = ROLE_PRIORITY.get(b.role) ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.userId.localeCompare(b.userId);
  })[0] ?? null;
}

function counterpartUserIds(opportunity: Opportunity, viewerId: string): Set<string> {
  return new Set(opportunity.actors.map((a) => a.userId).filter((id) => id && id !== viewerId));
}

function viewerHasCommitted(opportunity: Opportunity, viewerId: string): boolean {
  return (opportunity.committedActorIds ?? []).includes(viewerId);
}

/**
 * Which row keeps a person's single radar slot.
 * Accepted first, then a pending row this viewer already committed to,
 * then other live rows. Rejected and expired never take the slot from those.
 */
function counterpartSlotRank(opportunity: Opportunity, viewerId: string): number {
  if (opportunity.status === 'rejected' || opportunity.status === 'expired') return 3;
  if (opportunity.status === 'accepted') return 0;
  if (opportunity.status === 'pending' && viewerHasCommitted(opportunity, viewerId)) return 1;
  return 2;
}

function stampViewerCommitted(card: OpportunityCard, viewerCommitted: boolean): OpportunityCard {
  return { ...card, viewerCommitted };
}

function stampPeerContext(card: OpportunityCard, context: PeerContext): OpportunityCard {
  return { ...card, ...context };
}

/** One batched read of prior opportunities and chats for the counterparts of `opportunities`. */
async function loadPeerContext(
  database: OpportunityCardsDatabase,
  viewerId: string,
  opportunities: Opportunity[],
): Promise<Map<string, PeerContext>> {
  const peerOf = new Map(opportunities.map((opp) => [opp.id, pickDisplayCounterpartActor(opp, viewerId)?.userId]));
  const peerIds = [...new Set([...peerOf.values()].filter((id): id is string => !!id))];
  const [priors, chats] = await Promise.all([
    database.findPriorOpportunities(viewerId, peerIds, opportunities.map((opp) => opp.id)),
    database.findPeerChats(viewerId, peerIds),
  ]).catch((error) => {
    logger.warn('peer context read failed, presenting without it', { error });
    return [new Map<string, PriorOpportunity>(), new Map<string, PeerChat>()] as const;
  });
  return new Map(opportunities.map((opp) => {
    const peerId = peerOf.get(opp.id);
    return [opp.id, { priorOpportunity: (peerId && priors.get(peerId)) || null, peerChat: (peerId && chats.get(peerId)) || null }];
  }));
}

/**
 * Present one opportunity as a card for the viewer.
 *
 * @param deps - Database, cache, and presenter.
 * @param opportunity - The opportunity to present.
 * @param viewerId - The viewing user.
 * @param options - `intentId` focuses viewer context on one intent; `skeleton` skips the presenter; `noCache` skips the stored-card read; `peerContext` is the prior opportunity and chat when the caller already loaded them.
 * @returns The card, or null when the counterpart's name cannot be resolved.
 * @throws When the presenter fails.
 */
export async function presentOpportunityCard(
  deps: OpportunityCardsDeps,
  opportunity: Opportunity,
  viewerId: string,
  options: { intentId?: string; skeleton?: boolean; noCache?: boolean; peerContext?: PeerContext } = {},
): Promise<OpportunityCard | null> {
  const { database } = deps;
  const viewerRole = opportunity.actors.find((a) => a.userId === viewerId)?.role ?? 'party';
  const counterpart = pickDisplayCounterpartActor(opportunity, viewerId);
  if (!counterpart) return null;

  const viewerCommitted = viewerHasCommitted(opportunity, viewerId);
  const peerContext = options.peerContext
    ?? (await loadPeerContext(database, viewerId, [opportunity])).get(opportunity.id)!;
  const cacheable = opportunity.status !== 'negotiating';
  const cacheKey = buildOpportunityCardCacheKey(opportunity.id, viewerId, options.intentId);
  if (cacheable && !options.skeleton && !options.noCache) {
    try {
      const hit = await deps.cache.get<OpportunityCard>(cacheKey);
      if (hit && (hit.presentedPrior ?? null) === priorKey(peerContext.priorOpportunity)) {
        return stampPeerContext(stampViewerCommitted({ ...hit, status: opportunity.status }, viewerCommitted), peerContext);
      }
    } catch (error) {
      logger.warn('card cache read failed, presenting', { opportunityId: opportunity.id, error });
    }
  }

  const user = await database.getUser(counterpart.userId).catch(() => null);
  let name = user?.name?.trim();
  if (!name) {
    const profile = await database.getProfile(counterpart.userId).catch(() => null);
    name = profile?.identity?.name?.trim();
  }
  if (!name) return null;

  const identity = {
    opportunityId: opportunity.id,
    createdAt: opportunity.createdAt.toISOString(),
    status: opportunity.status,
    userId: counterpart.userId,
    name,
    avatar: user?.avatar ?? null,
    primaryActionLabel: getPrimaryActionLabel(viewerRole),
    secondaryActionLabel: SECONDARY_ACTION_LABEL,
    viewerRole,
  };

  if (options.skeleton) {
    return stampPeerContext(stampViewerCommitted(
      { ...identity, mainText: '', cta: '', mutualIntentsLabel: 'Shared interests', presentationPending: true },
      viewerCommitted,
    ), peerContext);
  }

  const [context, negotiationContext] = await Promise.all([
    gatherPresenterContext(database, opportunity, viewerId, counterpart.userId, options.intentId),
    loadNegotiationContext(database, opportunity.id, opportunity.status, viewerId),
  ]);
  const presentation = await deps.presenter.presentCard({
    ...context,
    opportunityStatus: opportunity.status,
    ...(negotiationContext ? { negotiationContext } : {}),
    ...(peerContext.priorOpportunity ? { priorOpportunity: peerContext.priorOpportunity } : {}),
  });
  const card: OpportunityCard = stampViewerCommitted({
    ...identity,
    mainText: presentation.personalizedSummary,
    cta: presentation.suggestedAction,
    headline: presentation.headline,
    mutualIntentsLabel: presentation.mutualIntentsLabel,
    narratorChip: { name: 'Index', text: presentation.narratorRemark },
    presentedPrior: priorKey(peerContext.priorOpportunity),
  }, viewerCommitted);
  if (cacheable) {
    await deps.cache.set(cacheKey, card).catch((error) => {
      logger.warn('card cache write failed', { opportunityId: opportunity.id, error });
    });
  }
  return stampPeerContext(card, peerContext);
}

/**
 * List the viewer's opportunities in the given statuses as presented cards,
 * one card per counterpart. An accepted row keeps that person's slot over a
 * newer pending or negotiating one, and a pending row this viewer already
 * committed to keeps it over a newer unanswered one. Among the same rank,
 * newest wins. A rejected or expired row never takes the slot from a live
 * one. Cards whose presentation fails are dropped.
 *
 * @param deps - Database, cache, and presenter.
 * @param input - Viewer, statuses, optional network/intent scope, limit, cache bypass, skeleton mode. Accepted rows are read without the recency window.
 * @returns The cards and the number of opportunities selected.
 */
export async function listOpportunityCards(
  deps: OpportunityCardsDeps,
  input: {
    viewerId: string;
    statuses: OpportunityStatus[];
    networkId?: string;
    intentId?: string;
    limit: number;
    noCache?: boolean;
    skeleton?: boolean;
  },
): Promise<{ cards: OpportunityCard[]; totalOpportunities: number }> {
  const { viewerId, intentId } = input;
  const scope = {
    ...(input.networkId ? { networkId: input.networkId } : {}),
    ...(intentId ? { scopeType: 'intent' as const, scopeId: intentId } : {}),
  };
  // Accepted rows are few and always win a person's slot, so they are read apart,
  // not left to fall outside the newest-rows window the other statuses share.
  const others = input.statuses.filter((status) => status !== 'accepted');
  const [accepted, rest] = await Promise.all([
    input.statuses.includes('accepted')
      ? deps.database.getOpportunitiesForUser(viewerId, { statuses: ['accepted'], ...scope })
      : [],
    others.length
      ? deps.database.getOpportunitiesForUser(viewerId, {
        limit: Math.min(150, Math.max(50, input.limit * 3)),
        statuses: others,
        ...scope,
      })
      : [],
  ]);
  const raw = [...accepted, ...rest];

  const requested = new Set(input.statuses);
  const visible = raw
    .filter((opp) => requested.has(opp.status) && canUserSeeOpportunity(opp.actors, opp.status, viewerId))
    .sort((a, b) => {
      const rank = counterpartSlotRank(a, viewerId) - counterpartSlotRank(b, viewerId);
      if (rank !== 0) return rank;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  const seen = new Set<string>();
  const opportunities = visible.filter((opp) => {
    const ids = counterpartUserIds(opp, viewerId);
    if ([...ids].some((id) => seen.has(id))) return false;
    for (const id of ids) seen.add(id);
    return true;
  }).slice(0, input.limit);

  const peerContexts = await loadPeerContext(deps.database, viewerId, opportunities);
  const cacheable = (opp: Opportunity) => opp.status !== 'negotiating';
  const keyFor = (opp: Opportunity) => buildOpportunityCardCacheKey(opp.id, viewerId, intentId);
  const cacheableOpps = input.noCache ? [] : opportunities.filter(cacheable);
  const cached = new Map<string, OpportunityCard>();
  if (cacheableOpps.length > 0) {
    try {
      const hits = await deps.cache.mget<OpportunityCard>(cacheableOpps.map(keyFor));
      cacheableOpps.forEach((opp, i) => {
        const hit = hits[i];
        const peerContext = peerContexts.get(opp.id)!;
        if (hit && (hit.presentedPrior ?? null) === priorKey(peerContext.priorOpportunity)) {
          cached.set(opp.id, stampPeerContext(stampViewerCommitted({ ...hit, status: opp.status }, viewerHasCommitted(opp, viewerId)), peerContext));
        }
      });
    } catch (error) {
      logger.warn('card cache read failed, presenting all', { error });
    }
  }

  const cards: (OpportunityCard | null)[] = [];
  for (let i = 0; i < opportunities.length; i += PRESENTATION_CONCURRENCY) {
    const chunk = opportunities.slice(i, i + PRESENTATION_CONCURRENCY);
    cards.push(...await Promise.all(chunk.map(async (opp) => {
      const hit = cached.get(opp.id);
      if (hit) return hit;
      try {
        const card = await presentOpportunityCard(deps, opp, viewerId, {
          intentId,
          skeleton: input.skeleton,
          noCache: input.noCache,
          peerContext: peerContexts.get(opp.id),
        });
        return card;
      } catch (error) {
        logger.warn('presenter failed, dropping card', { opportunityId: opp.id, error });
        return null;
      }
    })));
  }

  return {
    cards: cards.filter((card): card is OpportunityCard => card !== null),
    totalOpportunities: opportunities.length,
  };
}
