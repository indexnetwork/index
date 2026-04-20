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
  gatherPresenterContext,
  type PresenterDatabase,
} from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../adapters/database.adapter';
import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { agents, opportunities, opportunityDeliveries } from '../schemas/database.schema';

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
  rendered: RenderedCard;
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

  constructor(
    private readonly presenter: OpportunityPresenter = new OpportunityPresenter(),
    presenterDb?: PresenterDatabase,
  ) {
    this.presenterDb = presenterDb ?? (chatDatabaseAdapter as unknown as PresenterDatabase);
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
   * @param opportunityId - The opportunity being confirmed as delivered.
   * @param userId - The user the opportunity was delivered to.
   * @param agentId - The agent performing the delivery.
   * @returns `'confirmed'` on first delivery, `'already_delivered'` on duplicates.
   * @throws Error `'opportunity_not_found'` when the opportunity does not exist.
   * @throws Error `'not_authorized'` when userId is not an actor on the opportunity.
   */
  async commitDelivery(
    opportunityId: string,
    userId: string,
    agentId: string | null,
  ): Promise<'confirmed' | 'already_delivered'> {
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
        trigger: TRIGGER_PENDING,
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
   * to the delivery ledger. Suitable for batch delivery flows where the caller
   * decides which candidates to commit via `commitDelivery`.
   *
   * @param agentId - The agent whose owner's pending opportunities are fetched.
   * @returns Array of candidates with rendered cards, ordered oldest-first (up to 20).
   */
  async fetchPendingCandidates(agentId: string): Promise<PendingCandidate[]> {
    const userId = await this.resolveAgentOwner(agentId);

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
            AND d.delivered_at IS NOT NULL
        )
      ORDER BY o.updated_at ASC
      LIMIT 20
    `);

    const rows = result as unknown as Array<{
      id: string;
      actors: unknown;
      status: string;
      interpretation: unknown;
      detection: unknown;
    }>;

    const visible = rows.filter((row) => {
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

    const candidates = await Promise.all(
      visible.map(async (row) => ({
        opportunityId: row.id,
        rendered: await this.renderOpportunityCard(row.id, userId),
      })),
    );

    return candidates;
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
