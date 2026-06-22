import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import db from '../lib/drizzle/drizzle';
import { agentTestMessages } from '../schemas/database.schema';

const RESERVATION_TTL_SECONDS = 60;

/** Result returned by {@link AgentTestMessageService.pickup}. */
export interface PickupResult {
  id: string;
  content: string;
  reservationToken: string;
  reservationExpiresAt: Date;
}

/**
 * Manages the lifecycle of test messages sent to personal agents.
 *
 * Supports an at-least-once delivery guarantee via a reservation/confirm
 * pattern: {@link pickup} claims the oldest undelivered message with a
 * short-lived token; {@link confirmDelivered} marks it done. Expired
 * reservations are re-claimable automatically.
 */
export class AgentTestMessageService {
  /**
   * Enqueue a new test message for an agent.
   *
   * @param agentId - Target agent ID.
   * @param requestedByUserId - User who requested the test.
   * @param content - Message content to deliver.
   * @returns The ID of the newly created record.
   */
  async enqueue(agentId: string, requestedByUserId: string, content: string): Promise<{ id: string }> {
    const [row] = await db
      .insert(agentTestMessages)
      .values({ agentId, requestedByUserId, content })
      .returning({ id: agentTestMessages.id });
    return { id: row.id };
  }

  /**
   * Claim the oldest undelivered (or expired-reservation) message for an agent.
   *
   * Uses `FOR UPDATE SKIP LOCKED` to avoid phantom picks under concurrent pollers.
   *
   * @param agentId - Agent to pick up a message for.
   * @returns The claimed message with a reservation token, or `null` if none available.
   */
  async pickup(agentId: string): Promise<PickupResult | null> {
    const reservationToken = randomUUID();
    const reservedAt = new Date();
    const ttlCutoff = new Date(Date.now() - RESERVATION_TTL_SECONDS * 1000);

    const rows = await db
      .update(agentTestMessages)
      .set({ reservationToken, reservedAt })
      .where(
        and(
          eq(agentTestMessages.agentId, agentId),
          isNull(agentTestMessages.deliveredAt),
          or(isNull(agentTestMessages.reservedAt), lt(agentTestMessages.reservedAt, ttlCutoff)),
          sql`${agentTestMessages.id} = (
            SELECT id FROM ${agentTestMessages}
            WHERE agent_id = ${agentId}
              AND delivered_at IS NULL
              AND (reserved_at IS NULL OR reserved_at < ${ttlCutoff.toISOString()})
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )`,
        ),
      )
      .returning();

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      content: row.content,
      reservationToken,
      reservationExpiresAt: new Date(reservedAt.getTime() + RESERVATION_TTL_SECONDS * 1000),
    };
  }

  /**
   * Mark a previously claimed message as delivered.
   *
   * @param id - The message ID.
   * @param reservationToken - Token received during {@link pickup}.
   * @throws {Error} `invalid_reservation_token_or_already_delivered` if the
   *   token doesn't match or the message was already confirmed.
   */
  async confirmDelivered(id: string, reservationToken: string): Promise<void> {
    const rows = await db
      .update(agentTestMessages)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(agentTestMessages.id, id),
          eq(agentTestMessages.reservationToken, reservationToken),
          isNull(agentTestMessages.deliveredAt),
        ),
      )
      .returning({ id: agentTestMessages.id });

    if (rows.length === 0) {
      throw new Error('invalid_reservation_token_or_already_delivered');
    }
  }
}
