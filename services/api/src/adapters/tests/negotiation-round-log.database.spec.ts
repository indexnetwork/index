/**
 * Integration test for NegotiationRoundLogDatabaseAdapter (negotiation
 * round-log refactor, #1494 follow-up).
 *
 * Requires a live database connection (.env.test). Covers: append + read in
 * append order, and scoping reads to a single intent/batch pair.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';
import { randomUUID } from 'crypto';
import { NegotiationRoundLogDatabaseAdapter } from '../negotiation-round-log.database.adapter';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { eq } from 'drizzle-orm/sql';

describe('NegotiationRoundLogDatabaseAdapter', () => {
  const adapter = new NegotiationRoundLogDatabaseAdapter();

  it('appends events and reads them back in append order', async () => {
    const intentId = randomUUID();
    const batchId = randomUUID();

    await adapter.appendNegotiationRoundLogEvent(intentId, {
      kind: 'opened',
      taskId: randomUUID(),
      batchId,
    });
    await adapter.appendNegotiationRoundLogEvent(intentId, {
      kind: 'stopped',
      taskId: randomUUID(),
      batchId,
      via: 'completed',
    });

    const events = await adapter.readNegotiationRoundLogEvents(intentId, batchId);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('opened');
    expect(events[0].via).toBeUndefined();
    expect(events[1].kind).toBe('stopped');
    expect(events[1].via).toBe('completed');

    await db.delete(schema.negotiationRoundLogEvents).where(eq(schema.negotiationRoundLogEvents.intentId, intentId));
  });

  it('carries the pause reason on a stopped/paused event', async () => {
    const intentId = randomUUID();
    const batchId = randomUUID();

    await adapter.appendNegotiationRoundLogEvent(intentId, {
      kind: 'stopped',
      taskId: randomUUID(),
      batchId,
      via: 'paused',
      reason: 'counterparty_unreachable',
    });

    const events = await adapter.readNegotiationRoundLogEvents(intentId, batchId);
    expect(events).toHaveLength(1);
    expect(events[0].via).toBe('paused');
    expect(events[0].reason).toBe('counterparty_unreachable');

    await db.delete(schema.negotiationRoundLogEvents).where(eq(schema.negotiationRoundLogEvents.intentId, intentId));
  });

  it('scopes reads to the given intent/batch pair — no cross-batch or cross-intent leaks', async () => {
    const intentId = randomUUID();
    const batchA = randomUUID();
    const batchB = randomUUID();
    const otherIntentId = randomUUID();

    await adapter.appendNegotiationRoundLogEvent(intentId, { kind: 'opened', taskId: randomUUID(), batchId: batchA });
    await adapter.appendNegotiationRoundLogEvent(intentId, { kind: 'opened', taskId: randomUUID(), batchId: batchB });
    await adapter.appendNegotiationRoundLogEvent(otherIntentId, { kind: 'opened', taskId: randomUUID(), batchId: batchA });

    const forBatchA = await adapter.readNegotiationRoundLogEvents(intentId, batchA);
    expect(forBatchA).toHaveLength(1);

    const forUnknownBatch = await adapter.readNegotiationRoundLogEvents(intentId, randomUUID());
    expect(forUnknownBatch).toHaveLength(0);

    await db.delete(schema.negotiationRoundLogEvents).where(eq(schema.negotiationRoundLogEvents.intentId, intentId));
    await db.delete(schema.negotiationRoundLogEvents).where(eq(schema.negotiationRoundLogEvents.intentId, otherIntentId));
  });

  it('appends an opening_complete marker with no taskId and stamps a createdAt', async () => {
    const intentId = randomUUID();
    const batchId = randomUUID();

    await adapter.appendNegotiationRoundLogEvent(intentId, { kind: 'opening_complete', batchId });

    const events = await adapter.readNegotiationRoundLogEvents(intentId, batchId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('opening_complete');
    expect(events[0].taskId).toBeUndefined();
    expect(events[0].createdAt).toBeInstanceOf(Date);

    await db.delete(schema.negotiationRoundLogEvents).where(eq(schema.negotiationRoundLogEvents.intentId, intentId));
  });
});
