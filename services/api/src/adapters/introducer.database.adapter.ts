import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import type { IntroSuggestionStatus } from '../schemas/database.schema';

const { contacts, users, introSuggestions } = schema;

export interface ContactInput {
  email: string;
  name: string | null;
  organization: string | null;
  title: string | null;
  source: 'google_contacts' | 'google_other';
}

/** A contact as the matcher and the desk see them. Email stays server-side. */
export interface ContactCard {
  id: string;
  email: string;
  name: string | null;
  organization: string | null;
  title: string | null;
}

/**
 * One possible introduction, before the screen: a public intent the
 * introducer can see in `networkId`, and one of the introducer's contacts who
 * is not on Index.
 */
export interface MatchCandidate {
  introducerUserId: string;
  networkId: string;
  score: number;
  member: { userId: string; name: string; intentId: string; intentText: string };
  contact: ContactCard;
}

/** A stored suggestion with everything the Intro Desk card shows. */
export interface SuggestionRow {
  id: string;
  status: IntroSuggestionStatus;
  failure: string | null;
  score: number;
  intentLine: string;
  contactLine: string;
  draft: string;
  networkId: string;
  networkTitle: string;
  opportunityId: string | null;
  member: { userId: string; name: string; avatar: string | null; intentId: string; intentText: string };
  contact: ContactCard;
  createdAt: Date;
}

export interface IntroductionRow {
  opportunityId: string;
  status: string;
  createdAt: Date;
  context: string;
  a: { userId: string; name: string; avatar: string | null; intentText: string };
  b: { userId: string; name: string; avatar: string | null; intentText: string };
}

/** An introduction a member said yes to, whose contact has not heard yet. */
export interface OutreachRow {
  opportunityId: string;
  seatUserId: string;
  email: string;
  contactName: string | null;
  introducerName: string;
  memberName: string;
  memberIntent: string;
  context: string;
}

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => (result as { rows?: Row[] }).rows ?? (result as Row[]);

/** Mailboxes anyone can have; their domain says nothing about the person. */
const FREEMAIL = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
  'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'hey.com', 'fastmail.com',
];

/** A shared inbox is a team, not a person; the regex matches the local part. */
const SHARED_INBOX = '^(info|hello|contact|team|press|office|support|hi|careers|jobs|media|pr|partners|invest|investment|investments|admin|enquiries|inquiries|sales|founders|noreply|no-reply|notifications|billing|help|community|events|marketing|ops|hr|legal|accounts|newsletter)$';

/** Public, live intents whose owners verified their email: the only side the matcher reads. */
const LIVE_PUBLIC_INTENT = sql`
  i.archived_at is null and (i.status is null or i.status = 'active') and i.is_private = false
  and i.embedding is not null and u.email_verified and u.deleted_at is null and u.shadowbanned_at is null`;

/**
 * Storage for the introducer: a member's imported contacts, the introductions
 * the matcher suggests to them, the seats of contacts they introduce, and the
 * status (never the wording) of the introductions they opened.
 */
export class IntroducerDatabaseAdapter {
  /**
   * Make the owner's contacts equal Google's list: insert or update each row,
   * drop rows Google no longer returns, then match emails to Index accounts.
   * A changed card loses its embedding so the matcher reads it again.
   */
  async replaceContacts(ownerUserId: string, rows: ContactInput[]): Promise<void> {
    // Every row this sync touches gets a later updated_at; the rest are gone from Google.
    const [{ started }] = await db.execute<{ started: string }>(sql`select now()::text as started`) as unknown as { started: string }[];
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
            embedding: sql`case when (coalesce(excluded.name, ${contacts.name}), coalesce(excluded.organization, ${contacts.organization}), coalesce(excluded.title, ${contacts.title}))
              is distinct from (${contacts.name}, ${contacts.organization}, ${contacts.title}) then null else ${contacts.embedding} end`,
            updatedAt: sql`now()`,
          },
        });
    }
    await db.delete(contacts).where(and(
      eq(contacts.ownerUserId, ownerUserId),
      sql`${contacts.updatedAt} < ${started}::timestamptz`,
    ));
    // On Index means a verified account. Unclaimed seats (people introduced or
    // found who never signed up) stay contacts you can introduce.
    await db.execute(sql`
      update contacts c set matched_user_id = u.id
      from users u
      where c.owner_user_id = ${ownerUserId}
        and lower(u.email) = c.email
        and u.email_verified
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

  // ─── matching ──────────────────────────────────────────────────────────────

  /**
   * Contacts not on Index whose card has not been embedded yet, and that say
   * something beyond a name: a title, an organization, or a work domain.
   */
  async contactsToEmbed(limit: number, ownerUserId?: string): Promise<ContactCard[]> {
    const freemail = sql.join(FREEMAIL.map((d) => sql`${d}`), sql`, `);
    return db
      .select({ id: contacts.id, email: contacts.email, name: contacts.name, organization: contacts.organization, title: contacts.title })
      .from(contacts)
      .where(and(
        ownerUserId ? eq(contacts.ownerUserId, ownerUserId) : sql`true`,
        isNull(contacts.matchedUserId),
        isNull(contacts.embedding),
        // A person: a real name and a personal address, not a team inbox.
        sql`${contacts.name} is not null and position('@' in ${contacts.name}) = 0
             and ${contacts.name} <> split_part(${contacts.email}, '@', 1)
             and split_part(${contacts.email}, '@', 1) !~* ${SHARED_INBOX}`,
        sql`(${contacts.title} is not null or ${contacts.organization} is not null
             or split_part(${contacts.email}, '@', 2) not in (${freemail}))`,
      ))
      .limit(limit);
  }

  async setContactEmbeddings(rows: { id: string; embedding: number[] }[]): Promise<void> {
    for (const row of rows) {
      await db.update(contacts).set({ embedding: row.embedding }).where(eq(contacts.id, row.id));
    }
  }

  /**
   * For one public intent: the closest contacts, not on Index, held by people
   * who share one of the intent's networks. Pairs already suggested are skipped.
   */
  async candidatesForIntent(intentId: string, limit: number): Promise<MatchCandidate[]> {
    const result = await db.execute(sql`
      with it as (
        select i.id, i.user_id, i.embedding, coalesce(nullif(i.summary, ''), i.payload) as text, u.name as member_name
        from intents i join users u on u.id = i.user_id
        where i.id = ${intentId} and ${LIVE_PUBLIC_INTENT}
      ),
      introducers as (
        select distinct on (m.user_id) m.user_id, m.network_id
        from intent_networks inw
        join network_members m on m.network_id = inw.network_id and m.deleted_at is null
        join networks n on n.id = inw.network_id and n.deleted_at is null
        where inw.intent_id = ${intentId} and inw.visibility = 'networks_only'
          and m.user_id <> (select user_id from it)
        order by m.user_id, m.network_id
      )
      select c.id as contact_id, c.email, c.name, c.organization, c.title,
             c.owner_user_id, intr.network_id,
             it.id as intent_id, it.user_id as member_id, it.member_name, it.text,
             1 - (c.embedding <=> it.embedding) as score
      from it
      join contacts c on c.embedding is not null and c.matched_user_id is null
      join introducers intr on intr.user_id = c.owner_user_id
      where not exists (
        select 1 from intro_suggestions s
        where s.introducer_user_id = c.owner_user_id and s.intent_id = it.id and s.contact_id = c.id
      )
      order by c.embedding <=> it.embedding
      limit ${limit}
    `);
    return rowsOf(result).map(toCandidate);
  }

  /**
   * For some of one member's contacts: the closest public intents the member
   * can see, a few per contact. Runs after a contact sync.
   */
  async candidatesForContacts(ownerUserId: string, contactIds: string[], perContact: number): Promise<MatchCandidate[]> {
    if (!contactIds.length) return [];
    const result = await db.execute(sql`
      with nets as (
        select m.network_id from network_members m
        join networks n on n.id = m.network_id and n.deleted_at is null
        where m.user_id = ${ownerUserId} and m.deleted_at is null
      )
      select c.id as contact_id, c.email, c.name, c.organization, c.title,
             c.owner_user_id, x.network_id,
             x.intent_id, x.member_id, x.member_name, x.text, x.score
      from contacts c
      cross join lateral (
        select i.id as intent_id, i.user_id as member_id, u.name as member_name,
               coalesce(nullif(i.summary, ''), i.payload) as text,
               (select inw.network_id from intent_networks inw join nets on nets.network_id = inw.network_id
                 where inw.intent_id = i.id and inw.visibility = 'networks_only' limit 1) as network_id,
               1 - (i.embedding <=> c.embedding) as score
        from intents i join users u on u.id = i.user_id
        where ${LIVE_PUBLIC_INTENT}
          and i.user_id <> ${ownerUserId}
          and exists (select 1 from intent_networks inw join nets on nets.network_id = inw.network_id
                      where inw.intent_id = i.id and inw.visibility = 'networks_only')
        order by i.embedding <=> c.embedding
        limit ${perContact}
      ) x
      where c.owner_user_id = ${ownerUserId}
        and c.id in (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})
        and c.embedding is not null
        and not exists (
          select 1 from intro_suggestions s
          where s.introducer_user_id = c.owner_user_id and s.intent_id = x.intent_id and s.contact_id = c.id
        )
    `);
    return rowsOf(result).map(toCandidate);
  }

  /** Public intents created since a moment, oldest first: the matcher's work queue. */
  async publicIntentsSince(since: Date, limit: number): Promise<{ id: string; createdAt: Date }[]> {
    const result = await db.execute(sql`
      select i.id, i.created_at from intents i join users u on u.id = i.user_id
      where i.created_at > ${since.toISOString()}::timestamptz and ${LIVE_PUBLIC_INTENT}
        and exists (select 1 from intent_networks inw where inw.intent_id = i.id and inw.visibility = 'networks_only')
      order by i.created_at asc
      limit ${limit}
    `);
    return rowsOf(result).map((r) => ({ id: String(r.id), createdAt: new Date(String(r.created_at)) }));
  }

  async insertSuggestions(rows: {
    introducerUserId: string; intentId: string; contactId: string; networkId: string; score: number;
    intentLine: string; contactLine: string; draft: string;
  }[]): Promise<void> {
    if (!rows.length) return;
    await db.insert(introSuggestions).values(rows).onConflictDoNothing();
  }

  // ─── the desk ──────────────────────────────────────────────────────────────

  /** The desk: open and in-flight suggestions, best first, plus recent wakes. */
  async suggestions(introducerUserId: string, id?: string): Promise<SuggestionRow[]> {
    const result = await db.execute(sql`
      select s.id, s.status, s.failure, s.score, s.intent_line, s.contact_line, s.draft,
             s.network_id, n.title as network_title, s.opportunity_id, s.created_at,
             u.id as member_id, u.name as member_name, u.avatar as member_avatar,
             i.id as intent_id, coalesce(nullif(i.summary, ''), i.payload) as intent_text,
             c.id as contact_id, c.email, c.name, c.organization, c.title
      from intro_suggestions s
      join intents i on i.id = s.intent_id
      join users u on u.id = i.user_id
      join contacts c on c.id = s.contact_id
      join networks n on n.id = s.network_id
      where s.introducer_user_id = ${introducerUserId}
        ${id ? sql`and s.id = ${id}` : sql`
        and (s.status in ('open', 'waking', 'failed') or (s.status = 'woken' and s.updated_at > now() - interval '7 days'))
        and (s.status <> 'open' or (i.archived_at is null and (i.status is null or i.status = 'active') and c.matched_user_id is null))`}
      order by (s.status = 'open') desc, s.score desc
      limit 50
    `);
    return rowsOf(result).map((r) => ({
      id: String(r.id),
      status: String(r.status) as IntroSuggestionStatus,
      failure: (r.failure as string | null) ?? null,
      score: Number(r.score),
      intentLine: String(r.intent_line),
      contactLine: String(r.contact_line),
      draft: String(r.draft),
      networkId: String(r.network_id),
      networkTitle: String(r.network_title),
      opportunityId: (r.opportunity_id as string | null) ?? null,
      createdAt: new Date(String(r.created_at)),
      member: {
        userId: String(r.member_id), name: String(r.member_name), avatar: (r.member_avatar as string | null) ?? null,
        intentId: String(r.intent_id), intentText: String(r.intent_text),
      },
      contact: {
        id: String(r.contact_id), email: String(r.email), name: (r.name as string | null) ?? null,
        organization: (r.organization as string | null) ?? null, title: (r.title as string | null) ?? null,
      },
    }));
  }

  async setSuggestion(id: string, patch: Partial<{
    status: IntroSuggestionStatus; failure: string | null; seatUserId: string; opportunityId: string;
  }>): Promise<void> {
    await db.update(introSuggestions).set({ ...patch, updatedAt: new Date() }).where(eq(introSuggestions.id, id));
  }

  /** Move a suggestion from one status to another; false when it was not in `from`. */
  async claimSuggestion(id: string, introducerUserId: string, from: IntroSuggestionStatus[], to: IntroSuggestionStatus): Promise<boolean> {
    const rows = await db.update(introSuggestions)
      .set({ status: to, failure: null, updatedAt: new Date() })
      .where(and(
        eq(introSuggestions.id, id),
        eq(introSuggestions.introducerUserId, introducerUserId),
        inArray(introSuggestions.status, from),
      ))
      .returning({ id: introSuggestions.id });
    return rows.length > 0;
  }

  /** Whether the introducer can still see this intent in this network. */
  async canIntroduce(introducerUserId: string, intentId: string, networkId: string): Promise<boolean> {
    const result = await db.execute(sql`
      select 1 from intents i
      join users u on u.id = i.user_id
      join intent_networks inw on inw.intent_id = i.id and inw.network_id = ${networkId} and inw.visibility = 'networks_only'
      join network_members m on m.network_id = ${networkId} and m.user_id = ${introducerUserId} and m.deleted_at is null
      where i.id = ${intentId} and ${LIVE_PUBLIC_INTENT} and i.user_id <> ${introducerUserId}
      limit 1
    `);
    return rowsOf(result).length > 0;
  }

  // ─── seats ─────────────────────────────────────────────────────────────────

  /** The account an email already has, if any, with whether it is claimed or gone. */
  async accountByEmail(email: string): Promise<{ id: string; emailVerified: boolean; deleted: boolean } | null> {
    const [row] = await db.select({ id: users.id, emailVerified: users.emailVerified, deletedAt: users.deletedAt })
      .from(users).where(eq(users.email, email)).limit(1);
    return row ? { id: row.id, emailVerified: row.emailVerified, deleted: row.deletedAt !== null } : null;
  }

  /**
   * Seat someone outside Index: an unverified account with intents in no
   * network, so discovery never finds them and only an introduction reaches
   * them. Morning briefs are off; signing in with the email claims it.
   */
  async createSeat(person: {
    email: string; name: string; intro: string | null; socials: { label: string; value: string }[];
    intents: { payload: string; embedding: number[] }[];
  }): Promise<{ userId: string; intentIds: string[] } | null> {
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(users)
        .values({ email: person.email, name: person.name, intro: person.intro, emailVerified: false })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!user) return null;
      if (person.socials.length) await tx.insert(schema.userSocials).values(person.socials.map((s) => ({ userId: user.id, ...s })));
      await tx.insert(schema.userNotificationSettings).values({ userId: user.id, preferences: { morningBrief: false } });
      const rows = await tx.insert(schema.intents)
        .values(person.intents.map((intent) => ({ payload: intent.payload, userId: user.id, embedding: intent.embedding })))
        .returning({ id: schema.intents.id });
      return { userId: user.id, intentIds: rows.map((r) => r.id) };
    });
  }

  /** An existing seat's live intent closest to the member's, if it has one. */
  async closestSeatIntent(seatUserId: string, memberIntentId: string): Promise<string | null> {
    const result = await db.execute(sql`
      select g.id from intents g
      where g.user_id = ${seatUserId} and g.archived_at is null and (g.status is null or g.status = 'active')
      order by g.embedding <=> (select embedding from intents where id = ${memberIntentId}) nulls last
      limit 1
    `);
    const [row] = rowsOf(result);
    return row ? String(row.id) : null;
  }

  async addSeatIntent(seatUserId: string, payload: string, embedding: number[]): Promise<string> {
    const [row] = await db.insert(schema.intents).values({ payload, userId: seatUserId, embedding }).returning({ id: schema.intents.id });
    return row!.id;
  }

  /** Woken introductions a member said yes to, whose contact was not emailed yet. */
  async outreachDue(limit: number): Promise<OutreachRow[]> {
    const result = await db.execute(sql`
      select o.id as opportunity_id, seat.id as seat_id, seat.email, c.name as contact_name,
             intro.name as introducer_name, mu.name as member_name,
             coalesce(nullif(mi.summary, ''), mi.payload) as member_intent,
             coalesce(o.metadata->'introducer'->>'context', '') as context
      from intro_suggestions s
      join opportunities o on o.id = s.opportunity_id
      join users seat on seat.id = s.seat_user_id and not seat.email_verified and seat.deleted_at is null
      join contacts c on c.id = s.contact_id
      join users intro on intro.id = s.introducer_user_id
      join intents mi on mi.id = s.intent_id
      join users mu on mu.id = mi.user_id
      where s.status = 'woken'
        and o.metadata->>'introOutreachAt' is null
        and exists (
          select 1 from opportunity_events e
          where e.opportunity_id = o.id and e.type = 'committed' and e.actor_user_id = mu.id
        )
      limit ${limit}
    `);
    return rowsOf(result).map((r) => ({
      opportunityId: String(r.opportunity_id),
      seatUserId: String(r.seat_id),
      email: String(r.email),
      contactName: (r.contact_name as string | null) ?? null,
      introducerName: String(r.introducer_name),
      memberName: String(r.member_name),
      memberIntent: String(r.member_intent),
      context: String(r.context),
    }));
  }

  async markOpportunity(opportunityId: string, key: 'introOutreachAt' | 'introSeatScrubbedAt'): Promise<void> {
    await db.execute(sql`
      update opportunities
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(${key}::text, now()::text)
      where id = ${opportunityId}
    `);
  }

  /**
   * Seats whose introduction ended without a match (no fit or went quiet),
   * not claimed, with nothing else open: what research said about them goes.
   */
  async seatsToScrub(limit: number): Promise<{ opportunityId: string; seatUserId: string }[]> {
    const result = await db.execute(sql`
      select o.id as opportunity_id, seat.id as seat_id
      from intro_suggestions s
      join opportunities o on o.id = s.opportunity_id and o.status in ('rejected', 'expired')
      join users seat on seat.id = s.seat_user_id and not seat.email_verified and seat.deleted_at is null
      where o.metadata->>'introSeatScrubbedAt' is null
        and not exists (
          select 1 from opportunities o2
          where o2.id <> o.id and o2.status in ('negotiating', 'pending', 'accepted')
            and o2.actors::jsonb @> jsonb_build_array(jsonb_build_object('userId', seat.id))
        )
      limit ${limit}
    `);
    return rowsOf(result).map((r) => ({ opportunityId: String(r.opportunity_id), seatUserId: String(r.seat_id) }));
  }

  /** Forget what research found about an unclaimed seat: profile, links, intents. */
  async scrubSeat(seatUserId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(schema.userSocials).where(eq(schema.userSocials.userId, seatUserId));
      await tx.update(users).set({ intro: null, avatar: null }).where(and(eq(users.id, seatUserId), eq(users.emailVerified, false)));
      await tx.update(schema.intents).set({ archivedAt: new Date() }).where(and(eq(schema.intents.userId, seatUserId), isNull(schema.intents.archivedAt)));
    });
  }

  // ─── progress ──────────────────────────────────────────────────────────────

  /** Introductions the viewer opened, newest first: who, and the opportunity's status. Never the turns. */
  async introductions(viewerId: string, opportunityId?: string, limit = 20): Promise<IntroductionRow[]> {
    const result = await db.execute(sql`
      select o.id as opportunity_id, o.status, o.created_at,
             o.metadata->'introducer'->>'context' as context,
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
    return rowsOf(result).map((r) => ({
      opportunityId: String(r.opportunity_id),
      status: String(r.status),
      createdAt: new Date(String(r.created_at)),
      context: String(r.context ?? ''),
      a: { userId: String(r.a_user), name: String(r.a_name), avatar: (r.a_avatar as string | null) ?? null, intentText: String(r.a_text) },
      b: { userId: String(r.b_user), name: String(r.b_name), avatar: (r.b_avatar as string | null) ?? null, intentText: String(r.b_text) },
    }));
  }

  /** Display names for a set of users. */
  async names(userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, userIds), isNotNull(users.name)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function toCandidate(r: Row): MatchCandidate {
  return {
    introducerUserId: String(r.owner_user_id),
    networkId: String(r.network_id),
    score: Number(r.score),
    member: { userId: String(r.member_id), name: String(r.member_name), intentId: String(r.intent_id), intentText: String(r.text) },
    contact: {
      id: String(r.contact_id), email: String(r.email), name: (r.name as string | null) ?? null,
      organization: (r.organization as string | null) ?? null, title: (r.title as string | null) ?? null,
    },
  };
}

export const introducerDatabaseAdapter = new IntroducerDatabaseAdapter();
