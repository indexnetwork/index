import { and, eq, inArray, isNull, sql } from 'drizzle-orm/sql';

import { db, type OpportunityRow, toOpportunityRow } from './database.shared';
import { intentNetworks, intents, networkMembers, networks, opportunities, questions, users } from '../schemas/database.schema';

export interface UptakeIntentRow {
  id: string;
  userId: string;
  payload: string;
  summary: string | null;
  status: string | null;
  archivedAt: Date | null;
  felicityAuthority: number | null;
}

export interface UptakePublicUserHint {
  bio: string | null;
  location: string | null;
}

/** Narrow data-access adapter for pending-opportunity uptake eligibility. */
export class UptakeQuestionDatabaseAdapter {
  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    const rows = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    return rows[0] ? toOpportunityRow(rows[0]) : null;
  }

  async getIntent(id: string, networkId: string): Promise<UptakeIntentRow | null> {
    const rows = await db.select({
      id: intents.id,
      userId: intents.userId,
      payload: intents.payload,
      summary: intents.summary,
      status: intents.status,
      archivedAt: intents.archivedAt,
      felicityAuthority: intents.felicityAuthority,
    })
      .from(intents)
      .innerJoin(intentNetworks, and(
        eq(intentNetworks.intentId, intents.id),
        eq(intentNetworks.networkId, networkId),
      ))
      .where(eq(intents.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPublicUserHint(userId: string): Promise<UptakePublicUserHint | null> {
    const rows = await db.select({ bio: users.intro, location: users.location })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async resolveSafeCommonNetwork(
    recipientUserId: string,
    counterpartyUserId: string,
    actorNetworkIds: string[],
  ): Promise<{ id: string; title: string } | null> {
    const candidates = [...new Set(actorNetworkIds.filter(Boolean))];
    if (candidates.length === 0) return null;
    const rows = await db.select({
      networkId: networkMembers.networkId,
      userId: networkMembers.userId,
      title: networks.title,
      isPersonal: networks.isPersonal,
    })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(and(
        inArray(networkMembers.networkId, candidates),
        inArray(networkMembers.userId, [recipientUserId, counterpartyUserId]),
        isNull(networkMembers.deletedAt),
        isNull(networks.deletedAt),
      ));

    for (const networkId of candidates) {
      const anchored = rows.filter((row) => row.networkId === networkId && !row.isPersonal);
      const members = new Set(anchored.map((row) => row.userId));
      if (members.has(recipientUserId) && members.has(counterpartyUserId)) {
        return { id: networkId, title: anchored[0].title };
      }
    }
    return null;
  }

  async hasQuestionForRecipientSourcePurpose(
    recipientUserId: string,
    sourceType: string,
    sourceId: string,
    purpose: 'uptake',
  ): Promise<boolean> {
    const rows = await db.select({ id: questions.id })
      .from(questions)
      .where(and(
        sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: recipientUserId }])}::jsonb`,
        sql`${questions.detection}->>'sourceType' = ${sourceType}`,
        sql`${questions.detection}->>'sourceId' = ${sourceId}`,
        sql`${questions.detection}->>'purpose' = ${purpose}`,
      ))
      .limit(1);
    return rows.length > 0;
  }
}

export const uptakeQuestionDatabaseAdapter = new UptakeQuestionDatabaseAdapter();
