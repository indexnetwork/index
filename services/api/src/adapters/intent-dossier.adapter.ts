/**
 * Intent dossier adapter — the disclosure boundary's store
 * (docs/plans/2026-08-21-holistic-intent-agent.md, "The dossier").
 *
 * Negotiation-facing material may come only from rows here. The agent's
 * `answer_negotiation` executor writes the answer as an entry BEFORE the
 * resume is fed from it, and `note_dossier`/`retire_dossier` curate the
 * rest. Entries are retired (retiredAt stamped), never deleted — the
 * boundary's history stays auditable.
 */
import { and, asc, db, eq, isNull, schema } from './database.shared';

export type IntentDossierSource = 'user_message' | 'answer' | 'agent_note';

export interface IntentDossierEntryRow {
  id: string;
  text: string;
  source: IntentDossierSource;
  createdAt: Date;
}

export class IntentDossierAdapter {
  /** Append one entry; returns its id. */
  async addEntry(input: {
    userId: string;
    intentId: string;
    text: string;
    source: IntentDossierSource;
  }): Promise<string> {
    const [row] = await db.insert(schema.intentDossier).values({
      userId: input.userId,
      intentId: input.intentId,
      text: input.text,
      source: input.source,
    }).returning({ id: schema.intentDossier.id });
    return row.id;
  }

  /** Active (unretired) entries for one scope, oldest first. */
  async readActiveEntries(userId: string, intentId: string): Promise<IntentDossierEntryRow[]> {
    const rows = await db
      .select({
        id: schema.intentDossier.id,
        text: schema.intentDossier.text,
        source: schema.intentDossier.source,
        createdAt: schema.intentDossier.createdAt,
      })
      .from(schema.intentDossier)
      .where(and(
        eq(schema.intentDossier.userId, userId),
        eq(schema.intentDossier.intentId, intentId),
        isNull(schema.intentDossier.retiredAt),
      ))
      .orderBy(asc(schema.intentDossier.createdAt), asc(schema.intentDossier.id));
    return rows as IntentDossierEntryRow[];
  }

  /**
   * Retire one entry. Scoped to the owner so the agent can only retire its
   * own client's facts; returns false when nothing matched (already retired,
   * or not this user's).
   */
  async retireEntry(input: { userId: string; entryId: string }): Promise<boolean> {
    const rows = await db
      .update(schema.intentDossier)
      .set({ retiredAt: new Date() })
      .where(and(
        eq(schema.intentDossier.id, input.entryId),
        eq(schema.intentDossier.userId, input.userId),
        isNull(schema.intentDossier.retiredAt),
      ))
      .returning({ id: schema.intentDossier.id });
    return rows.length > 0;
  }
}

export const intentDossierAdapter = new IntentDossierAdapter();
