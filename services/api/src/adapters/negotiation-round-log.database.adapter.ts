/**
 * Adapter for `@indexnetwork/protocol`'s `NegotiationRoundLogDatabase` port
 * (negotiation round-log refactor, #1494).
 *
 * Append-only: append writes one row, read returns a batch's rows in append
 * order — the order `foldNegotiationRoundLog` requires.
 *
 * Adapters may not import from `@indexnetwork/protocol` (see the lint rule),
 * so `NegotiationRoundLogEventRecord` is a local structural mirror of the
 * protocol's type of the same name; compatibility is verified by TypeScript
 * duck typing at the composition root.
 */

import { and, asc, eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

export interface NegotiationRoundLogEventRecord {
  kind: 'opened' | 'stopped' | 'resumed' | 'opening_complete';
  /** Absent only for 'opening_complete', which has no task. */
  taskId?: string;
  batchId: string;
  /** Only set on 'stopped' events. */
  via?: 'paused' | 'completed';
  /** Only set on 'stopped' events whose `via` is 'paused'. */
  reason?: string;
  /** When this event was appended — the staleness clock for an in-flight batch. */
  createdAt: Date;
}

export class NegotiationRoundLogDatabaseAdapter {
  async appendNegotiationRoundLogEvent(intentId: string, event: Omit<NegotiationRoundLogEventRecord, 'createdAt'>): Promise<void> {
    await db.insert(schema.negotiationRoundLogEvents).values({
      intentId,
      batchId: event.batchId,
      taskId: event.taskId ?? null,
      kind: event.kind,
      via: event.via ?? null,
      reason: event.reason ?? null,
    });
  }

  async readNegotiationRoundLogEvents(intentId: string, batchId: string): Promise<NegotiationRoundLogEventRecord[]> {
    const rows = await db
      .select()
      .from(schema.negotiationRoundLogEvents)
      .where(and(
        eq(schema.negotiationRoundLogEvents.intentId, intentId),
        eq(schema.negotiationRoundLogEvents.batchId, batchId),
      ))
      .orderBy(asc(schema.negotiationRoundLogEvents.createdAt), asc(schema.negotiationRoundLogEvents.id));

    return rows.map((row) => ({
      kind: row.kind,
      batchId: row.batchId,
      createdAt: row.createdAt,
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.via ? { via: row.via } : {}),
      ...(row.reason ? { reason: row.reason } : {}),
    }));
  }
}

export const negotiationRoundLogDatabaseAdapter = new NegotiationRoundLogDatabaseAdapter();
