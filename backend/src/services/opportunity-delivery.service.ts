/**
 * OpportunityDeliveryService
 *
 * Manages reservation and committed delivery of opportunities to agent channels.
 * Implements a two-phase pickup → confirm pattern backed by the `opportunity_deliveries` ledger.
 *
 * Reservation flow:
 *   1. `pickupPending` — finds an eligible pending opportunity, writes a reservation row,
 *      and returns the rendered card plus a one-time reservation token.
 *   2. `confirmDelivered` — marks the reservation as committed (sets `delivered_at`).
 *      The partial unique index `uniq_opp_deliveries_committed` then prevents a second
 *      committed row for the same (user, opportunity, channel, deliveredAtStatus) tuple.
 */

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  OpportunityPresenter,
  canUserSeeOpportunity,
  classifyOpportunity,
  gatherPresenterContext,
  getOrCreateDeliveryCardBatch,
  isActionableForViewer,
  type PresenterDatabase,
} from '@indexnetwork/protocol';

import type { Cache } from '../adapters/cache.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { chatDatabaseAdapter } from '../adapters/database.adapter';
import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { normalizeTelegramHandle } from '@indexnetwork/protocol';
import { conversations } from '../schemas/conversation.schema';
import { agents, opportunities, opportunityDeliveries, userSocials, users } from '../schemas/database.schema';

const logger = log.service.from('OpportunityDeliveryService');

const RESERVATION_TTL_SECONDS = 60;
const CHANNEL = 'openclaw';
const TRIGGER_PENDING = 'pending_pickup';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderedCard {
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
}

export interface PickupPendingResult {
  opportunityId: string;
  reservationToken: string;
  reservationExpiresAt: Date;
  rendered: RenderedCard;
}

export interface PendingCandidate {
  opportunityId: string;
  counterpartUserId: string | null;
  feedCategory: 'connection' | 'connector-flow';
  rendered: RenderedCard;
}

export interface PendingCandidatesResult {
  opportunities: PendingCandidate[];
  totalPending: number;
}

export interface AcceptedCandidate {
  opportunityId: string;
  accepterUserId: string;
  accepterName: string;
  conversationUrl: string;
  telegramHandle: string | null;
  rendered: {
    headline: string;
    personalizedSummary: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core service for reserving and committing opportunity deliveries via the
 * `opportunity_deliveries` ledger. One instance is safe to share across requests.
 */
export class OpportunityDeliveryService {
  private readonly presenterDb: PresenterDatabase;
  private readonly cache: Cache | null;

  constructor(
    private readonly presenter: OpportunityPresenter = new OpportunityPresenter(),
    presenterDb?: PresenterDatabase,
    cache?: Cache,
  ) {
    this.presenterDb = presenterDb ?? (chatDatabaseAdapter as unknown as PresenterDatabase);
    this.cache = cache ?? null;
  }

  /**
   * Find the next pending opportunity for the agent owner and reserve it.
   *
   * Returns `null` when no eligible opportunity is available.
   *
   * @param agentId - The agent making the pickup request (must have an owner).
   */
  async pickupPending(agentId: string): Promise<PickupPendingResult | null> {
    const userId = await this.resolveAgentOwner(agentId);
    const ttlCutoff = new Date(Date.now() - RESERVATION_TTL_SECONDS * 1000);

    // Fetch candidate opportunities where:
    //  - status IN ('pending', 'draft')
    //  - user appears in actors JSONB array
    //  - for 'draft' rows, user is NOT the initiator (detection->>'createdBy')
    //  - the agent has notify_on_opportunity = true (muted agents get no results)
    //  - no committed delivery row (delivered_at IS NOT NULL) exists for this (user, opp, channel, status)
    //  - no live reservation exists (reserved_at within TTL window, delivered_at IS NULL)
    // We limit to 20 and filter with canUserSeeOpportunity in JS to stay consistent with protocol rules.
    const result = await db.execute(sql`
      SELECT o.id, o.actors, o.status, o.interpretation, o.detection
      FROM opportunities o
      WHERE o.status IN ('pending', 'draft')
        AND o.actors::jsonb @> ${JSON.stringify([{ userId }])}::jsonb
        AND (
          o.status = 'pending'
          OR (
            (o.detection->>'createdBy') IS NOT NULL
            AND (o.detection->>'createdBy') <> ${userId}
          )
        )
        AND EXISTS (
          SELECT 1 FROM agents a
          WHERE a.id = ${agentId}
            AND a.notify_on_opportunity = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM opportunity_deliveries d
          WHERE d.opportunity_id = o.id
            AND d.user_id = ${userId}
            AND d.channel = ${CHANNEL}
            AND d.delivered_at_status = o.status::text
            AND (
              d.delivered_at IS NOT NULL
              OR (d.reserved_at IS NOT NULL AND d.reserved_at >= ${ttlCutoff.toISOString()})
            )
        )
      ORDER BY o.updated_at ASC
      LIMIT 20
    `);

    const rows = result as unknown as Array<{ id: string; actors: unknown; status: string; interpretation: unknown; detection: unknown }>;

    // Filter in JS via canUserSeeOpportunity (consistent with maintenance.graph.ts pattern).
    // Defense-in-depth: if a 'draft' row reaches this filter with a missing detection.createdBy
    // (shouldn't happen given the SQL guard above), log loudly and skip it rather than throwing,
    // so one malformed row cannot block delivery of the other valid rows in the batch.
    const visible = rows.filter((row: { id: string; actors: unknown; status: string; detection: unknown }) => {
      if (row.status === 'draft') {
        const detection = (row as { detection?: { createdBy?: string } }).detection;
        if (!detection?.createdBy) {
          logger.error('Skipping draft opportunity with missing detection.createdBy', {
            opportunityId: row.id,
            userId,
          });
          return false;
        }
      }
      const actors = row.actors as Array<{ userId: string; role: string }>;
      return canUserSeeOpportunity(actors, row.status, userId);
    });

    const chosen = visible[0];
    if (!chosen) return null;

    const reservationToken = randomUUID();
    const reservedAt = new Date();

    // Insert reservation row. The uniqueIndex is partial (WHERE delivered_at IS NOT NULL),
    // so multiple reservation rows can co-exist — only the first confirmDelivered wins.
    // Record the actual opp status so draft deliveries don't re-deliver after promotion to pending.
    await db.insert(opportunityDeliveries).values({
      opportunityId: chosen.id,
      userId,
      agentId,
      channel: CHANNEL,
      trigger: TRIGGER_PENDING,
      deliveredAtStatus: chosen.status,
      reservationToken,
      reservedAt,
    });

    const rendered = await this.renderOpportunityCard(chosen.id, userId);

    return {
      opportunityId: chosen.id,
      reservationToken,
      reservationExpiresAt: new Date(reservedAt.getTime() + RESERVATION_TTL_SECONDS * 1000),
      rendered,
    };
  }

  /**
   * Commit an earlier reservation as delivered.
   *
   * The partial unique index `uniq_opp_deliveries_committed` prevents a second committed row
   * for the same (user, opportunity, channel, deliveredAtStatus) tuple, so duplicate
   * confirms (e.g. two agents racing) will fail at the DB level.
   *
   * @param opportunityId - The opportunity that was delivered.
   * @param userId - The user the opportunity was delivered to.
   * @param reservationToken - The one-time token issued at pickup time.
   * @throws Error when the token is invalid or the row is already committed.
   */
  async confirmDelivered(
    opportunityId: string,
    userId: string,
    reservationToken: string,
  ): Promise<void> {
    const rows = await db
      .update(opportunityDeliveries)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(opportunityDeliveries.opportunityId, opportunityId),
          eq(opportunityDeliveries.userId, userId),
          eq(opportunityDeliveries.reservationToken, reservationToken),
          isNull(opportunityDeliveries.deliveredAt),
        ),
      )
      .returning({ id: opportunityDeliveries.id });

    if (rows.length === 0) {
      throw new Error('invalid_reservation_token_or_already_delivered');
    }
  }

  /**
   * Write a committed delivery row directly, without a prior reservation phase.
   * Idempotent: returns `'already_delivered'` when a committed row already exists
   * for the same (user, opportunity, channel, status) tuple.
   *
   * @param params - Delivery parameters.
   * @param params.opportunityId - The opportunity being confirmed as delivered.
   * @param params.userId - The user the opportunity was delivered to.
   * @param params.agentId - The agent performing the delivery.
   * @param params.trigger - Which dispatch path produced this delivery: 'ambient' for
   *                         real-time critical alerts, 'digest' for the daily sweep,
   *                         'accepted' for accepted-opportunity notifications to the counterparty.
   * @returns `'confirmed'` on first delivery, `'already_delivered'` on duplicates.
   * @throws Error `'opportunity_not_found'` when the opportunity does not exist.
   * @throws Error `'not_authorized'` when userId is not an actor on the opportunity.
   */
  async confirmOpportunityDelivery({
    opportunityId,
    userId,
    agentId,
    trigger,
  }: {
    opportunityId: string;
    userId: string;
    agentId: string | null;
    trigger: 'ambient' | 'digest' | 'accepted';
  }): Promise<'confirmed' | 'already_delivered'> {
    const [opp] = await db
      .select({ id: opportunities.id, status: opportunities.status, actors: opportunities.actors })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId));

    if (!opp) throw new Error('opportunity_not_found');

    const actors = opp.actors as Array<{ userId: string; role: string }>;
    if (!actors.some((a) => a.userId === userId)) {
      throw new Error('not_authorized');
    }

    const existing = await db
      .select({ id: opportunityDeliveries.id })
      .from(opportunityDeliveries)
      .where(
        and(
          eq(opportunityDeliveries.opportunityId, opportunityId),
          eq(opportunityDeliveries.userId, userId),
          eq(opportunityDeliveries.channel, CHANNEL),
          eq(opportunityDeliveries.deliveredAtStatus, opp.status),
          isNotNull(opportunityDeliveries.deliveredAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) return 'already_delivered';

    try {
      await db.insert(opportunityDeliveries).values({
        opportunityId,
        userId,
        agentId,
        channel: CHANNEL,
        trigger,
        deliveredAtStatus: opp.status,
        reservationToken: randomUUID(),
        reservedAt: new Date(),
        deliveredAt: new Date(),
      });
    } catch (err) {
      // Postgres unique_violation (23505) — a concurrent call already committed this delivery.
      if ((err as { code?: string }).code === '23505') {
        return 'already_delivered';
      }
      throw err;
    }

    return 'confirmed';
  }

  /**
   * Fetch all undelivered eligible opportunities for an agent owner without writing
   * to the delivery ledger. Uses the same `getOpportunitiesForUser` adapter as the
   * feed graph, widened to include `latent` status alongside `pending` and `draft`.
   * JS filters mirror the feed graph: canUserSeeOpportunity + isActionableForViewer.
   * Delivery dedup is applied as a batch JS filter after visibility checks.
   *
   * @param agentId - The agent whose owner's pending opportunities are fetched.
   * @param limit - Optional maximum number of candidates to return. Clamped to [1, 20]. Defaults to 20.
   * @returns Result with candidates (rendered cards + feedCategory), totalPending count, ordered oldest-first.
   */
  async fetchPendingCandidates(agentId: string, limit?: number): Promise<PendingCandidatesResult> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new Error('agent_not_found');
    if (!agent.notifyOnOpportunity) return { opportunities: [], totalPending: 0 };

    const userId = agent.ownerId;
    const raw = limit !== undefined && Number.isFinite(limit) ? Math.trunc(limit) : 20;
    const effectiveLimit = Math.min(20, Math.max(1, raw));

    // Step 1: Fetch via adapter — same as feed graph
    const rows = await chatDatabaseAdapter.getOpportunitiesForUser(userId, {
      statuses: ['latent', 'pending', 'draft'],
      limit: 150,
    });

    // Step 2: JS filter chain (mirrors feed graph)
    const visible = rows.filter((row) => {
      const actors = row.actors as Array<{ userId: string; role: string; approved?: boolean }>;

      // canUserSeeOpportunity — read-level ACL
      if (!canUserSeeOpportunity(actors, row.status, userId)) return false;

      // isActionableForViewer — actionability gate
      if (!isActionableForViewer(actors, row.status, userId)) return false;

      // Draft createdBy exclusion — skip drafts where user is the creator
      if (row.status === 'draft') {
        const detection = row.detection as { createdBy?: string } | null;
        if (detection?.createdBy === userId) return false;
      }

      return true;
    });

    // Step 3: Delivery dedup — batch query then filter
    const deduped = await this.filterAlreadyDelivered(visible, userId);

    // Step 4: Classify + count + slice
    const totalPending = deduped.length;

    // Sort oldest-first by updatedAt
    deduped.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

    const sliced = deduped.slice(0, effectiveLimit);

    // Step 5: Render cards and classify
    const candidates = await Promise.all(
      sliced.map(async (row) => {
        const actors = row.actors as Array<{ userId: string; role: string }>;
        const counterpart = actors.find((a) => a.userId !== userId && a.role !== 'introducer');
        const feedCategory = classifyOpportunity(
          { actors, status: row.status },
          userId,
        ) as 'connection' | 'connector-flow';
        return {
          opportunityId: row.id,
          counterpartUserId: counterpart?.userId ?? null,
          feedCategory,
          rendered: await this.renderOpportunityCard(row.id, userId),
        };
      }),
    );

    return { opportunities: candidates, totalPending };
  }

  /**
   * Batch-filter opportunities that have already been delivered to the user.
   * Queries the delivery ledger once for all candidate IDs, then removes
   * candidates whose `id:status` key has a committed delivery row.
   */
  private async filterAlreadyDelivered<T extends { id: string; status: string }>(
    candidates: T[],
    userId: string,
  ): Promise<T[]> {
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => c.id);
    const deliveryRows = await db.execute(sql`
      SELECT opportunity_id, delivered_at_status
      FROM opportunity_deliveries
      WHERE opportunity_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND user_id = ${userId}
        AND channel = ${CHANNEL}
        AND delivered_at IS NOT NULL
    `);

    const delivered = new Set(
      (deliveryRows as unknown as Array<{ opportunity_id: string; delivered_at_status: string }>)
        .map((r) => `${r.opportunity_id}:${r.delivered_at_status}`),
    );

    return candidates.filter((c) => !delivered.has(`${c.id}:${c.status}`));
  }

  /**
   * Fetch accepted opportunities where the agent's owner is the counterparty
   * (not the accepter) and no delivery with deliveredAtStatus='accepted' exists.
   *
   * @param agentId - The agent whose owner's accepted opportunities are fetched.
   * @param frontendUrl - Base URL for constructing conversation links.
   * @param limit - Optional maximum number of candidates to return. Clamped to [1, 20]. Defaults to 10.
   * @returns Array of candidates with enriched accepter info and rendered cards.
   */
  async fetchAcceptedCandidates(agentId: string, frontendUrl: string, limit?: number): Promise<AcceptedCandidate[]> {
    const userId = await this.resolveAgentOwner(agentId);
    const raw = limit !== undefined && Number.isFinite(limit) ? Math.trunc(limit) : 10;
    const effectiveLimit = Math.min(20, Math.max(1, raw));

    const result = await db.execute(sql`
      SELECT o.id, o.actors, o.accepted_by
      FROM opportunities o
      WHERE o.status = 'accepted'
        AND o.accepted_by IS NOT NULL
        AND o.accepted_by <> ${userId}
        AND o.actors::jsonb @> ${JSON.stringify([{ userId }])}::jsonb
        AND NOT (o.actors::jsonb @> ${JSON.stringify([{ userId, role: 'introducer' }])}::jsonb)
        AND EXISTS (
          SELECT 1 FROM agents a
          WHERE a.id = ${agentId}
            AND a.notify_on_opportunity = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM opportunity_deliveries d
          WHERE d.opportunity_id = o.id
            AND d.user_id = ${userId}
            AND d.channel = ${CHANNEL}
            AND d.delivered_at_status = 'accepted'
            AND d.delivered_at IS NOT NULL
        )
      ORDER BY o.updated_at DESC
      LIMIT ${effectiveLimit}
    `);

    const rows = result as unknown as Array<{
      id: string;
      actors: Array<{ userId: string; role: string }>;
      accepted_by: string;
    }>;

    const candidates = await Promise.all(
      rows.map(async (row) => {
        const accepterUserId = row.accepted_by;

        // Fetch accepter name and Telegram handle in a single query
        const [userData] = await db
          .select({
            name: users.name,
            telegramHandle: userSocials.value,
          })
          .from(users)
          .leftJoin(userSocials, and(
            eq(userSocials.userId, users.id),
            eq(userSocials.label, 'telegram'),
          ))
          .where(and(eq(users.id, accepterUserId), isNull(users.deletedAt)))
          .limit(1);
        const accepterName = userData?.name ?? '';
        const telegramHandle = normalizeTelegramHandle(userData?.telegramHandle);

        // Resolve conversation URL from existing DM between the two users (read-only)
        const dmPair = [userId, accepterUserId].sort().join(':');
        const [existingConv] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.dmPair, dmPair))
          .limit(1);
        const conversationUrl = existingConv
          ? `${frontendUrl}/conversations/${existingConv.id}`
          : frontendUrl;

        const rendered = await this.renderOpportunityCard(row.id, userId);

        return {
          opportunityId: row.id,
          accepterUserId,
          accepterName,
          conversationUrl,
          telegramHandle,
          rendered: {
            headline: rendered.headline,
            personalizedSummary: rendered.personalizedSummary,
          },
        };
      }),
    );

    return candidates;
  }

  /**
   * Count committed deliveries for an agent grouped by trigger since `since`.
   * Rows where `delivered_at IS NULL` (open reservations) are excluded.
   *
   * @param agentId - Agent whose deliveries to count.
   * @param since - Lower bound (inclusive) on `delivered_at`.
   */
  async countDeliveriesSince(
    agentId: string,
    since: Date,
  ): Promise<{ ambient: number; digest: number }> {
    const result = await db.execute(sql`
      SELECT trigger, COUNT(*)::int AS count
      FROM opportunity_deliveries
      WHERE agent_id = ${agentId}
        AND delivered_at IS NOT NULL
        AND delivered_at >= ${since.toISOString()}
        AND trigger IN ('ambient', 'digest')
      GROUP BY trigger
    `);

    const rows = result as unknown as Array<{ trigger: string; count: number }>;
    const counts = { ambient: 0, digest: 0 };
    for (const row of rows) {
      if (row.trigger === 'ambient' || row.trigger === 'digest') {
        counts[row.trigger] = row.count;
      }
    }
    return counts;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Resolve the owner user ID of an agent.
   *
   * @param agentId - Agent to look up.
   * @throws Error when the agent does not exist.
   */
  private async resolveAgentOwner(agentId: string): Promise<string> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new Error('agent_not_found');
    return agent.ownerId;
  }

  /**
   * Load the opportunity and invoke the presenter to produce a user-facing card.
   * Falls back to raw reasoning text when the LLM call fails.
   *
   * @param opportunityId - The opportunity to render.
   * @param userId - The user the card is being rendered for (determines role context).
   */
  private async renderOpportunityCard(
    opportunityId: string,
    userId: string,
  ): Promise<RenderedCard> {
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId));

    if (!opp) throw new Error('opportunity_not_found');

    // Use cache-aside utility if cache is available; fall through on cache failure.
    if (this.cache) {
      try {
        const oppWithContext = {
          id: opp.id,
          status: opp.status,
          actors: opp.actors as Array<{ userId: string; role: string }>,
          interpretation: opp.interpretation,
          detection: opp.detection,
        };

        const cards = await getOrCreateDeliveryCardBatch(
          this.cache,
          this.presenter,
          this.presenterDb,
          [oppWithContext],
          userId,
        );

        const card = cards.get(opp.id);
        if (card) {
          return {
            headline: card.headline,
            personalizedSummary: card.personalizedSummary,
            suggestedAction: card.suggestedAction,
            narratorRemark: card.narratorRemark,
          };
        }
      } catch (err) {
        log.warn('Cache-aside render failed, falling back to direct presenter', {
          opportunityId: opp.id,
          error: (err as Error).message,
        });
      }
    }

    // Fallback to direct presenter call (no cache)
    try {
      const presenterInput = await gatherPresenterContext(
        this.presenterDb,
        opp as unknown as Parameters<typeof gatherPresenterContext>[1],
        userId,
      );
      presenterInput.opportunityStatus = 'pending';

      const presented = await this.presenter.presentHomeCard(presenterInput);
      return {
        headline: presented.headline,
        personalizedSummary: presented.personalizedSummary,
        suggestedAction: presented.suggestedAction,
        narratorRemark: presented.narratorRemark,
      };
    } catch {
      // LLM fallback — follow opportunity.service.ts:getChatContext fallback shape
      const rawReasoning =
        (opp.interpretation as { reasoning?: string } | null)?.reasoning ?? '';
      return {
        headline: rawReasoning.substring(0, 80) || 'Connection opportunity',
        personalizedSummary: rawReasoning,
        suggestedAction: 'Open Index Network to see the full context and decide.',
        narratorRemark: '',
      };
    }
  }
}

/** Shared singleton wired with the Redis cache adapter. */
export const opportunityDeliveryService = new OpportunityDeliveryService(
  undefined,
  undefined,
  new RedisCacheAdapter(),
);
