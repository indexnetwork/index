/**
 * IntentAgent act ledger — append-only accountability substrate
 * (docs/plans/2026-08-21-holistic-intent-agent.md, "The ledger").
 *
 * Written by the agent loop after every executed act — including `wait`, so
 * silence is auditable. Read ONLY by the agent's own context assembly ("what
 * did I already ask"); nothing else may treat it as a logic input.
 */
import { and, db, desc, eq, schema } from './database.shared';

export interface IntentAgentLedgerRow {
  id: string;
  event: Record<string, unknown>;
  act: Record<string, unknown>;
  createdAt: Date;
}

export class IntentAgentLedgerAdapter {
  async append(input: {
    userId: string;
    intentId: string;
    event: Record<string, unknown>;
    act: Record<string, unknown>;
  }): Promise<string> {
    const [row] = await db.insert(schema.intentAgentActs).values(input)
      .returning({ id: schema.intentAgentActs.id });
    return row.id;
  }

  /** The scope's most recent acts, newest first. */
  async readRecent(userId: string, intentId: string, limit = 20): Promise<IntentAgentLedgerRow[]> {
    const rows = await db
      .select({
        id: schema.intentAgentActs.id,
        event: schema.intentAgentActs.event,
        act: schema.intentAgentActs.act,
        createdAt: schema.intentAgentActs.createdAt,
      })
      .from(schema.intentAgentActs)
      .where(and(
        eq(schema.intentAgentActs.userId, userId),
        eq(schema.intentAgentActs.intentId, intentId),
      ))
      .orderBy(desc(schema.intentAgentActs.createdAt), desc(schema.intentAgentActs.id))
      .limit(limit);
    return rows;
  }
}

export const intentAgentLedgerAdapter = new IntentAgentLedgerAdapter();
