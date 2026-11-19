import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

const { contacts, users, negotiationTurns, opportunityEvents } = schema;

export interface ContactInput {
  email: string;
  name: string | null;
  organization: string | null;
  title: string | null;
  source: 'google_contacts' | 'google_other';
}

export interface PairCandidate {
  networkId: string;
  networkTitle: string;
  a: PairSide;
  b: PairSide;
  score: number;
}

export interface PairSide {
  userId: string;
  name: string;
  avatar: string | null;
  intentId: string;
  intentText: string;
  /** In the viewer's imported contacts. */
  isContact: boolean;
}

export interface IntroductionRow {
  opportunityId: string;
  status: string;
  createdAt: Date;
  context: string;
  negotiationId: string | null;
  awaitingUserId: string | null;
  outcome: string | null;
  settledAt: Date | null;
  a: { userId: string; name: string; avatar: string | null; intentText: string };
  b: { userId: string; name: string; avatar: string | null; intentText: string };
}

export interface TurnMeta {
  negotiationId: string;
  turnIndex: number;
  seatUserId: string;
  action: string;
  at: Date;
}

export interface EventMeta {
  opportunityId: string;
  type: string;
  actorUserId: string | null;
  at: Date;
}

/** Candidate intents considered per request; bounds the pair cross join. */
const CANDIDATE_LIMIT = 400;

/**
 * Storage for the introducer: a member's imported contacts, the intent pairs
 * they could introduce, and the shape (never the wording) of the
 * introductions they opened.
 */
export class IntroducerDatabaseAdapter {
  /** Replace-or-insert contacts by (owner, email) and match them to Index accounts. */
  async upsertContacts(ownerUserId: string, rows: ContactInput[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db.insert(contacts)
        .values(chunk.map((r) => ({ ownerUserId, ...r })))
        .onConflictDoUpdate({
          target: [contacts.ownerUserId, contacts.email],
          set: {
            name: sql`coalesce(excluded.name, ${contacts.name})`,
            organization: sql`coalesce(excluded.organization, ${contacts.organization})`,
            title: sql`coalesce(excluded.title, ${contacts.title})`,
            // A saved contact outranks someone you've only emailed.
            source: sql`case when ${contacts.source} = 'google_contacts' then ${contacts.source} else excluded.source end`,
            updatedAt: sql`now()`,
          },
        });
    }
    await db.execute(sql`
      update contacts c set matched_user_id = u.id
      from users u
      where c.owner_user_id = ${ownerUserId}
        and lower(u.email) = c.email
        and u.deleted_at is null
        and u.id <> ${ownerUserId}
    `);
  }

  async contactCounts(ownerUserId: string): Promise<{ total: number; onIndex: number; lastImportAt: Date | null }> {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        onIndex: sql<number>`count(${contacts.matchedUserId})::int`,
        lastImportAt: sql<Date | null>`max(${contacts.updatedAt})`,
      })
      .from(contacts)
      .where(eq(contacts.ownerUserId, ownerUserId));
    return { total: row?.total ?? 0, onIndex: row?.onIndex ?? 0, lastImportAt: row?.lastImportAt ? new Date(row.lastImportAt) : null };
  }

  /** The viewer's Google account scope string, if they linked Google. */
  async googleScope(userId: string): Promise<string | null | undefined> {
    const [row] = await db
      .select({ scope: schema.accounts.scope })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, 'google')))
      .limit(1);
    return row ? row.scope : undefined;
  }

  /**
   * Intent pairs the viewer could introduce: two other people's public intents
   * seated in one network the viewer belongs to, at least one owned by a
   * contact, with no negotiation between them yet and no exclusion either way.
   * One row per pair of people, their closest two intents.
   */
  async pairCandidates(viewerId: string, limit: number): Promise<PairCandidate[]> {
    const result = await db.execute(sql`
      with my_networks as (
        select network_id from network_members
        where user_id = ${viewerId} and deleted_at is null
      ),
      cand as (
        select i.id, i.user_id, coalesce(nullif(i.summary, ''), i.payload) as text, i.embedding,
               inw.network_id,
               exists (select 1 from contacts c where c.owner_user_id = ${viewerId} and c.matched_user_id = i.user_id) as is_contact
        from intents i
        join intent_networks inw on inw.intent_id = i.id
        join my_networks mn on mn.network_id = inw.network_id
        join users u on u.id = i.user_id
        where i.archived_at is null
          and (i.status is null or i.status = 'active')
          and i.is_private = false
          and inw.visibility = 'networks_only'
          and i.embedding is not null
          and i.user_id <> ${viewerId}
          and u.deleted_at is null
          and u.shadowbanned_at is null
        order by is_contact desc, i.created_at desc
        limit ${CANDIDATE_LIMIT}
      ),
      pairs as (
        select a.id as a_intent, b.id as b_intent, a.network_id,
               a.user_id as a_user, b.user_id as b_user,
               a.text as a_text, b.text as b_text,
               a.is_contact as a_contact, b.is_contact as b_contact,
               1 - (a.embedding <=> b.embedding) as score
        from cand a
        join cand b on b.network_id = a.network_id and a.user_id < b.user_id
        where (a.is_contact or b.is_contact)
          and not exists (
            select 1 from negotiations n
            where (n.initiator_intent_id = a.id and n.responder_intent_id = b.id)
               or (n.initiator_intent_id = b.id and n.responder_intent_id = a.id)
          )
          and not exists (
            select 1 from intent_exclusions x
            where (x.intent_id = a.id and x.excluded_user_id = b.user_id)
               or (x.intent_id = b.id and x.excluded_user_id = a.user_id)
          )
      ),
      best as (
        select distinct on (a_user, b_user) *
        from pairs
        order by a_user, b_user, score desc
      )
      select best.*, nw.title as network_title,
             ua.name as a_name, ua.avatar as a_avatar,
             ub.name as b_name, ub.avatar as b_avatar
      from best
      join networks nw on nw.id = best.network_id
      join users ua on ua.id = best.a_user
      join users ub on ub.id = best.b_user
      order by (best.a_contact::int + best.b_contact::int) desc, best.score desc
      limit ${limit}
    `);
    const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? (result as unknown as Record<string, unknown>[]);
    return rows.map((r) => ({
      networkId: String(r.network_id),
      networkTitle: String(r.network_title),
      score: Number(r.score),
      a: {
        userId: String(r.a_user), name: String(r.a_name), avatar: (r.a_avatar as string | null) ?? null,
        intentId: String(r.a_intent), intentText: String(r.a_text), isContact: Boolean(r.a_contact),
      },
      b: {
        userId: String(r.b_user), name: String(r.b_name), avatar: (r.b_avatar as string | null) ?? null,
        intentId: String(r.b_intent), intentText: String(r.b_text), isContact: Boolean(r.b_contact),
      },
    }));
  }

  /** Introductions the viewer opened, newest first, with each side's person and intent. */
  async introductions(viewerId: string, opportunityId?: string, limit = 20): Promise<IntroductionRow[]> {
    const result = await db.execute(sql`
      select o.id as opportunity_id, o.status, o.created_at,
             o.metadata->'introducer'->>'context' as context,
             n.id as negotiation_id, n.awaiting_user_id, n.outcome, n.settled_at,
             n.initiator_user_id as a_user, ua.name as a_name, ua.avatar as a_avatar,
             coalesce(nullif(ia.summary, ''), ia.payload) as a_text,
             n.responder_user_id as b_user, ub.name as b_name, ub.avatar as b_avatar,
             coalesce(nullif(ib.summary, ''), ib.payload) as b_text
      from opportunities o
      join negotiations n on n.opportunity_id = o.id
      join users ua on ua.id = n.initiator_user_id
      join users ub on ub.id = n.responder_user_id
      join intents ia on ia.id = n.initiator_intent_id
      join intents ib on ib.id = n.responder_intent_id
      where o.metadata->'introducer'->>'userId' = ${viewerId}
        ${opportunityId ? sql`and o.id = ${opportunityId}` : sql``}
      order by o.created_at desc
      limit ${limit}
    `);
    const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? (result as unknown as Record<string, unknown>[]);
    return rows.map((r) => ({
      opportunityId: String(r.opportunity_id),
      status: String(r.status),
      createdAt: new Date(String(r.created_at)),
      context: String(r.context ?? ''),
      negotiationId: (r.negotiation_id as string | null) ?? null,
      awaitingUserId: (r.awaiting_user_id as string | null) ?? null,
      outcome: (r.outcome as string | null) ?? null,
      settledAt: r.settled_at ? new Date(String(r.settled_at)) : null,
      a: { userId: String(r.a_user), name: String(r.a_name), avatar: (r.a_avatar as string | null) ?? null, intentText: String(r.a_text) },
      b: { userId: String(r.b_user), name: String(r.b_name), avatar: (r.b_avatar as string | null) ?? null, intentText: String(r.b_text) },
    }));
  }

  /** Turn shape only: who moved, which action, when. The message column is never read. */
  async turnMeta(negotiationIds: string[]): Promise<TurnMeta[]> {
    if (!negotiationIds.length) return [];
    return db
      .select({
        negotiationId: negotiationTurns.negotiationId,
        turnIndex: negotiationTurns.turnIndex,
        seatUserId: negotiationTurns.seatUserId,
        action: negotiationTurns.action,
        at: negotiationTurns.createdAt,
      })
      .from(negotiationTurns)
      .where(inArray(negotiationTurns.negotiationId, negotiationIds))
      .orderBy(negotiationTurns.negotiationId, negotiationTurns.turnIndex);
  }

  /** Lifecycle facts only (opened, agreed, committed, declined, expired); no client data. */
  async eventMeta(opportunityIds: string[]): Promise<EventMeta[]> {
    if (!opportunityIds.length) return [];
    return db
      .select({
        opportunityId: opportunityEvents.opportunityId,
        type: opportunityEvents.type,
        actorUserId: opportunityEvents.actorUserId,
        at: opportunityEvents.at,
      })
      .from(opportunityEvents)
      .where(and(
        inArray(opportunityEvents.opportunityId, opportunityIds),
        inArray(opportunityEvents.type, ['opened', 'agreed', 'committed', 'declined', 'expired']),
      ))
      .orderBy(opportunityEvents.at);
  }

  /** Display names for a set of users. */
  async names(userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, userIds), isNotNull(users.name)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

export const introducerDatabaseAdapter = new IntroducerDatabaseAdapter();
