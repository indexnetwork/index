import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import type { IntroducerReportSetting, OpportunityProposalActor, OpportunityProposalStatus } from '../schemas/database.schema';

const { contacts, users, opportunityProposals, introducerExclusions } = schema;

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

/** A stored proposal, in the opportunity format, with what the Intro Desk card shows. */
export interface ProposalRow {
  id: string;
  status: OpportunityProposalStatus;
  failure: string | null;
  confidence: number;
  detection: Record<string, unknown>;
  actors: OpportunityProposalActor[];
  interpretation: Record<string, unknown>;
  context: Record<string, unknown>;
  /** The two card lines. */
  card: { member: string; contact: string };
  /** The draft intro (`metadata.introducer.context`). */
  draft: string;
  networkId: string;
  networkTitle: string;
  opportunityId: string | null;
  member: { userId: string; name: string; avatar: string | null; intentId: string; intentText: string };
  contact: ContactCard;
  createdAt: Date;
}

/** A contact as the contacts list shows it to its owner. */
export interface ContactListRow extends ContactCard {
  source: string;
  onIndex: boolean;
  excluded: boolean;
  /** Proposals still waiting on the desk for this contact. */
  proposals: number;
}

export type ContactFilter = 'all' | 'not_on_index' | 'on_index' | 'excluded';

export interface IntroductionRow {
  opportunityId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  context: string;
  a: { userId: string; name: string; avatar: string | null; intentText: string };
  b: { userId: string; name: string; avatar: string | null; intentText: string };
}

/** An introduction a member said yes to, whose contact has not heard yet. */
export interface OutreachRow {
  opportunityId: string;
  seatUserId: string;
  email: string;
  /** The seat's own name (`users.name`), never the introducer's address-book label. */
  seatName: string | null;
  introducerName: string;
  /** The member who said yes; the email's link signs in straight to them. */
  memberId: string;
  memberName: string;
  memberIntent: string;
  context: string;
}

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => (result as { rows?: Row[] }).rows ?? (result as Row[]);

function toProposalRow(r: Row): ProposalRow {
  const metadata = r.metadata as { introducer: { context: string }; card: { member: string; contact: string } };
  return {
    id: String(r.id),
    status: String(r.status) as OpportunityProposalStatus,
    failure: (r.failure as string | null) ?? null,
    confidence: Number(r.confidence),
    detection: r.detection as Record<string, unknown>,
    actors: r.actors as OpportunityProposalActor[],
    interpretation: r.interpretation as Record<string, unknown>,
    context: r.context as Record<string, unknown>,
    card: metadata.card,
    draft: metadata.introducer.context,
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
  };
}

/** Mailboxes anyone can have; their domain says nothing about the person. */
const FREEMAIL = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
  'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'hey.com', 'fastmail.com',
];

/** A shared inbox is a team, not a person; the regex matches the local part. */
const SHARED_INBOX = '^(info|hello|contact|team|press|office|support|hi|careers|jobs|media|pr|partners|invest|investment|investments|admin|enquiries|inquiries|sales|founders|noreply|no-reply|notifications|billing|help|community|events|marketing|ops|hr|legal|accounts|newsletter)$';

/** Contacts per introducer that are embedded, matched and researched. */
const TOP_CONTACTS = 500;

/** Public, live intents whose owners verified their email: the only side the matcher reads. */
const LIVE_PUBLIC_INTENT = sql`
  i.archived_at is null and (i.status is null or i.status = 'active') and i.is_private = false
  and i.embedding is not null and u.email_verified and u.deleted_at is null and u.shadowbanned_at is null`;

/**
 * Storage for the introducer: a member's imported contacts, the introductions
 * the matcher proposes to them, the seats of contacts they introduce, and the
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

  /**
   * Keep only the owner's 500 most frequent contacts in play: store each
   * contact's sent-mail frequency, then number the top 500 (not removed,
   * excluded or on Index) by frequency, saved before emailed-only, oldest
   * first. Everyone else gets no rank. One statement, so it is atomic.
   * @param frequency Sent messages per lowercased address; null counts as 0 for all.
   */
  async rankContacts(ownerUserId: string, frequency: Map<string, number> | null): Promise<void> {
    const entries = frequency ? [...frequency.entries()] : [];
    const freq = entries.length
      ? sql`(select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (values ${sql.join(entries.map(([email, n]) => sql`(${email}::text, ${n}::int)`), sql`, `)}) as t(k, v))`
      : sql`'{}'::jsonb`;
    await db.execute(sql`
      with freq as (select ${freq} as m),
      scored as (
        select c.id, coalesce((freq.m ->> c.email)::int, 0) as frequency,
               (c.removed_at is null and c.excluded_at is null and c.matched_user_id is null) as eligible,
               c.source, c.created_at
        from contacts c, freq
        where c.owner_user_id = ${ownerUserId}
      ),
      ranked as (
        select id, frequency,
               case when eligible then row_number() over (
                 partition by eligible order by frequency desc, (source = 'google_contacts') desc, created_at asc, id
               ) end as pos
        from scored
      )
      update contacts c
      set frequency = r.frequency,
          rank = case when r.pos <= ${TOP_CONTACTS} then r.pos::int end
      from ranked r
      where c.id = r.id
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
      .where(and(eq(contacts.ownerUserId, ownerUserId), isNull(contacts.removedAt)));
    return { total: row?.total ?? 0, onIndex: row?.onIndex ?? 0, lastImportAt: row?.lastImportAt ? new Date(row.lastImportAt) : null };
  }

  /**
   * The viewer's Google account, if they linked Google: its scope string and
   * whether we can still reach Google for them (a refresh token, or an access
   * token that has not expired yet).
   */
  async googleAccount(userId: string): Promise<{ scope: string | null; usable: boolean } | undefined> {
    const [row] = await db
      .select({
        scope: schema.accounts.scope,
        hasRefreshToken: sql<boolean>`${schema.accounts.refreshToken} is not null`,
        accessTokenExpiresAt: schema.accounts.accessTokenExpiresAt,
      })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, 'google')))
      .limit(1);
    if (!row) return undefined;
    const expiresAt = row.accessTokenExpiresAt ? new Date(row.accessTokenExpiresAt).getTime() : null;
    const usable = row.hasRefreshToken || expiresAt === null || expiresAt > Date.now();
    return { scope: row.scope, usable };
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
        isNull(contacts.excludedAt),
        isNull(contacts.embedding),
        isNotNull(contacts.rank),
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
      join contacts c on c.embedding is not null and c.rank is not null and c.matched_user_id is null and c.excluded_at is null
      join introducers intr on intr.user_id = c.owner_user_id
      where not exists (
        select 1 from opportunity_proposals s
        where s.introducer_user_id = c.owner_user_id and s.intent_id = it.id and s.contact_id = c.id
      )
        and not exists (
          select 1 from introducer_exclusions x
          where x.introducer_user_id = c.owner_user_id and x.excluded_user_id = it.user_id
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
          and not exists (select 1 from introducer_exclusions x
                          where x.introducer_user_id = ${ownerUserId} and x.excluded_user_id = i.user_id)
          and exists (select 1 from intent_networks inw join nets on nets.network_id = inw.network_id
                      where inw.intent_id = i.id and inw.visibility = 'networks_only')
        order by i.embedding <=> c.embedding
        limit ${perContact}
      ) x
      where c.owner_user_id = ${ownerUserId}
        and c.id in (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})
        and c.embedding is not null and c.rank is not null and c.excluded_at is null
        and not exists (
          select 1 from opportunity_proposals s
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

  /** Store proposals in the opportunity format; a pair already proposed is left alone. */
  async insertProposals(rows: {
    introducerUserId: string; intentId: string; contactId: string; networkId: string; memberUserId: string;
    score: number; intentLine: string; contactLine: string; draft: string;
  }[]): Promise<void> {
    if (!rows.length) return;
    const now = new Date().toISOString();
    await db.insert(opportunityProposals).values(rows.map((r) => ({
      introducerUserId: r.introducerUserId,
      intentId: r.intentId,
      contactId: r.contactId,
      networkId: r.networkId,
      detection: { source: 'introducer' as const, createdBy: 'introducer-matcher', triggeredBy: r.intentId, timestamp: now },
      actors: [
        { role: 'party' as const, userId: r.memberUserId, networkId: r.networkId, intent: r.intentId },
        { role: 'party' as const, contactId: r.contactId, via: r.introducerUserId },
      ],
      interpretation: { category: 'introduction', reasoning: `${r.intentLine} ⇄ ${r.contactLine}`, confidence: r.score },
      context: { networkId: r.networkId },
      confidence: String(r.score),
      metadata: { introducer: { userId: r.introducerUserId, context: r.draft }, card: { member: r.intentLine, contact: r.contactLine } },
      status: 'checking' as const,
    }))).onConflictDoNothing();
  }

  // ─── the desk ──────────────────────────────────────────────────────────────

  /** The desk: proposals still to act on (proposed, opening, failed), best first. */
  async proposals(introducerUserId: string, id?: string): Promise<ProposalRow[]> {
    const result = await db.execute(sql`
      select p.id, p.status, p.failure, p.confidence, p.detection, p.actors, p.interpretation, p.context, p.metadata,
             p.network_id, n.title as network_title, p.opportunity_id, p.created_at,
             u.id as member_id, u.name as member_name, u.avatar as member_avatar,
             i.id as intent_id, case when i.is_private then '' else coalesce(nullif(i.summary, ''), i.payload) end as intent_text,
             c.id as contact_id, c.email, c.name, c.organization, c.title
      from opportunity_proposals p
      join intents i on i.id = p.intent_id
      join users u on u.id = i.user_id
      join contacts c on c.id = p.contact_id
      join networks n on n.id = p.network_id
      where p.introducer_user_id = ${introducerUserId}
        ${id ? sql`and p.id = ${id}` : sql`
        and p.status in ('proposed', 'opening', 'failed')
        and c.excluded_at is null and c.matched_user_id is null
        and not exists (select 1 from introducer_exclusions x
                        where x.introducer_user_id = p.introducer_user_id and x.excluded_user_id = u.id)
        and (p.status <> 'proposed' or (i.archived_at is null and (i.status is null or i.status = 'active')))`}
      order by (p.status = 'proposed') desc, p.confidence desc
      limit 50
    `);
    return rowsOf(result).map(toProposalRow);
  }

  async setProposal(id: string, patch: Partial<{ status: OpportunityProposalStatus; failure: string | null }>): Promise<void> {
    await db.update(opportunityProposals).set({ ...patch, updatedAt: new Date() }).where(eq(opportunityProposals.id, id));
  }

  /** Opened: the contact's actor gets its seat, the proposal keeps the intro that was sent, and links the opportunity. */
  async markOpened(id: string, seat: { userId: string; intentId: string }, context: string, opportunityId: string): Promise<void> {
    await db.execute(sql`
      update opportunity_proposals set
        actors = jsonb_set(jsonb_set(actors, '{1,userId}', to_jsonb(${seat.userId}::text)), '{1,intent}', to_jsonb(${seat.intentId}::text)),
        metadata = jsonb_set(metadata, '{introducer,context}', to_jsonb(${context}::text)),
        status = 'opened', failure = null, opportunity_id = ${opportunityId}, updated_at = now()
      where id = ${id}
    `);
  }

  /** Move a proposal from one status to another; false when it was not in `from`. */
  async claimProposal(id: string, introducerUserId: string, from: OpportunityProposalStatus[], to: OpportunityProposalStatus): Promise<boolean> {
    const rows = await db.update(opportunityProposals)
      .set({ status: to, failure: null, updatedAt: new Date() })
      .where(and(
        eq(opportunityProposals.id, id),
        eq(opportunityProposals.introducerUserId, introducerUserId),
        inArray(opportunityProposals.status, from),
      ))
      .returning({ id: opportunityProposals.id });
    return rows.length > 0;
  }

  // ─── contacts list ─────────────────────────────────────────────────────────

  /** The owner's contacts, filtered and searched, with how many proposals each has waiting. */
  async listContacts(ownerUserId: string, options: { q?: string; filter: ContactFilter; limit: number; offset: number }): Promise<{ rows: ContactListRow[]; total: number }> {
    const q = options.q?.trim();
    const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const where = sql`c.owner_user_id = ${ownerUserId} and c.removed_at is null
      ${like ? sql`and (c.name ilike ${like} or c.email ilike ${like} or c.organization ilike ${like} or c.title ilike ${like})` : sql``}
      ${options.filter === 'not_on_index' ? sql`and c.matched_user_id is null and c.excluded_at is null`
        : options.filter === 'on_index' ? sql`and c.matched_user_id is not null`
          : options.filter === 'excluded' ? sql`and c.excluded_at is not null` : sql``}`;
    const [count] = rowsOf(await db.execute(sql`select count(*)::int as n from contacts c where ${where}`));
    const result = await db.execute(sql`
      select c.id, c.email, c.name, c.organization, c.title, c.source,
             c.matched_user_id is not null as on_index, c.excluded_at is not null as excluded,
             (select count(*)::int from opportunity_proposals p where p.contact_id = c.id and p.status = 'proposed') as proposals
      from contacts c
      where ${where}
      order by ${options.filter === 'excluded'
        // Never-suggest reads newest first, so a fresh pick sits on the first page.
        ? sql`c.excluded_at desc, c.id`
        : sql`proposals desc, (c.title is not null or c.organization is not null) desc, c.name asc nulls last, c.email asc`}
      limit ${options.limit} offset ${options.offset}
    `);
    return {
      total: Number(count?.n ?? 0),
      rows: rowsOf(result).map((r) => ({
        id: String(r.id), email: String(r.email), name: (r.name as string | null) ?? null,
        organization: (r.organization as string | null) ?? null, title: (r.title as string | null) ?? null,
        source: String(r.source), onIndex: Boolean(r.on_index), excluded: Boolean(r.excluded), proposals: Number(r.proposals),
      })),
    };
  }

  /** Never suggest this contact (or allow it again). Excluding also takes their waiting proposals off the desk. */
  async setExcluded(ownerUserId: string, contactId: string, excluded: boolean): Promise<boolean> {
    const rows = await db.update(contacts)
      .set({ excludedAt: excluded ? new Date() : null })
      .where(and(eq(contacts.id, contactId), eq(contacts.ownerUserId, ownerUserId), isNull(contacts.removedAt)))
      .returning({ id: contacts.id });
    if (!rows.length) return false;
    if (excluded) {
      await db.update(opportunityProposals).set({ status: 'skipped', updatedAt: new Date() })
        .where(and(eq(opportunityProposals.contactId, contactId), inArray(opportunityProposals.status, ['proposed', 'failed'])));
    }
    return true;
  }

  /** Members you said never to suggest, newest first. */
  async excludedMembers(introducerUserId: string): Promise<{ userId: string; name: string; avatar: string | null }[]> {
    return db
      .select({ userId: users.id, name: users.name, avatar: users.avatar })
      .from(introducerExclusions)
      .innerJoin(users, eq(users.id, introducerExclusions.excludedUserId))
      .where(eq(introducerExclusions.introducerUserId, introducerUserId))
      .orderBy(sql`${introducerExclusions.createdAt} desc`);
  }

  /**
   * Never suggest pairs with this member (or allow them again). Excluding also
   * takes the waiting proposals built on their intents off the desk.
   */
  async setMemberExcluded(introducerUserId: string, memberUserId: string, excluded: boolean): Promise<boolean> {
    if (!excluded) {
      await db.delete(introducerExclusions).where(and(
        eq(introducerExclusions.introducerUserId, introducerUserId),
        eq(introducerExclusions.excludedUserId, memberUserId),
      ));
      return true;
    }
    if (introducerUserId === memberUserId) return false;
    const [member] = await db.select({ id: users.id }).from(users).where(eq(users.id, memberUserId));
    if (!member) return false;
    await db.insert(introducerExclusions).values({ introducerUserId, excludedUserId: memberUserId }).onConflictDoNothing();
    await db.execute(sql`
      update opportunity_proposals p set status = 'skipped', updated_at = now()
      from intents i
      where i.id = p.intent_id and i.user_id = ${memberUserId}
        and p.introducer_user_id = ${introducerUserId} and p.status in ('proposed', 'failed')
    `);
    return true;
  }

  /**
   * Remove one contact. The row stays, marked removed and excluded, so the
   * next Google sync doesn't bring it back; its waiting proposals are skipped.
   */
  async removeContact(ownerUserId: string, contactId: string): Promise<boolean> {
    const now = new Date();
    const rows = await db.update(contacts)
      .set({ removedAt: now, excludedAt: sql`coalesce(${contacts.excludedAt}, ${now})` })
      .where(and(eq(contacts.id, contactId), eq(contacts.ownerUserId, ownerUserId), isNull(contacts.removedAt)))
      .returning({ id: contacts.id });
    if (!rows.length) return false;
    await db.update(opportunityProposals).set({ status: 'skipped', updatedAt: now })
      .where(and(eq(opportunityProposals.contactId, contactId), inArray(opportunityProposals.status, ['proposed', 'failed'])));
    return true;
  }

  /** Delete every contact the owner imported, and the proposals made from them. Opened introductions stay. */
  async deleteContacts(ownerUserId: string): Promise<number> {
    const rows = await db.delete(contacts).where(eq(contacts.ownerUserId, ownerUserId)).returning({ id: contacts.id });
    return rows.length;
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
   * Seat someone outside Index: an unverified identity with no intents and no
   * network, so discovery never finds them. Morning briefs are off; signing in
   * with the email claims it. Null when the email already has an account.
   */
  async createSeat(person: {
    email: string; name: string; intro: string | null; socials: { label: string; value: string }[];
  }): Promise<{ userId: string } | null> {
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(users)
        .values({ email: person.email, name: person.name, intro: person.intro, emailVerified: false })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!user) return null;
      if (person.socials.length) await tx.insert(schema.userSocials).values(person.socials.map((s) => ({ userId: user.id, ...s })));
      await tx.insert(schema.userNotificationSettings).values({ userId: user.id, preferences: { morningBrief: false } });
      return { userId: user.id };
    });
  }

  // ─── research ──────────────────────────────────────────────────────────────

  /**
   * Emails with a checking proposal still to settle, oldest first: ones to
   * research (skipping ones tried 3 times or within 30 minutes), ones already
   * found not to exist online, and ones already found (judged, not researched).
   */
  async checkingDue(limit: number): Promise<{ email: string; contact: ContactCard }[]> {
    const result = await db.execute(sql`
      select * from (
      select distinct on (lower(c.email)) lower(c.email) as key, p.created_at,
             c.id as contact_id, c.email, c.name, c.organization, c.title
      from opportunity_proposals p
      join contacts c on c.id = p.contact_id
      left join contact_research r on r.email = lower(c.email)
      where p.status = 'checking'
        and (
          r.status in ('not_found', 'found')
          or (r.status is null and (r.email is null or (r.attempts < 3 and (r.last_attempt_at is null or r.last_attempt_at < now() - interval '30 minutes'))))
        )
      order by lower(c.email), p.created_at asc
      ) due
      order by created_at asc
      limit ${limit}
    `);
    return rowsOf(result)
      .map((r) => ({
        email: String(r.key),
        contact: {
          id: String(r.contact_id), email: String(r.email), name: (r.name as string | null) ?? null,
          organization: (r.organization as string | null) ?? null, title: (r.title as string | null) ?? null,
        },
      }));
  }

  /**
   * What the judge reads for one checking pair: the introducer, the member
   * and the member's intent, and the ghost found for the contact's email.
   * Only public intents are ever read; null when the pair can't be judged
   * (no ghost, the member's intent is private now).
   */
  async judgeInput(proposalId: string, email: string): Promise<{
    introducer: { name: string; intro: string | null; intents: string[] };
    member: { name: string; intro: string | null; intent: string };
    contact: { name: string; headline: string; socials: string[] };
  } | null> {
    const result = await db.execute(sql`
      select iu.id as introducer_id, iu.name as introducer_name, iu.intro as introducer_intro,
             mu.name as member_name, mu.intro as member_intro,
             case when i.is_private then null else coalesce(nullif(i.summary, ''), i.payload) end as intent_text,
             g.id as ghost_id, g.name as ghost_name, g.intro as ghost_intro
      from opportunity_proposals p
      join intents i on i.id = p.intent_id
      join users mu on mu.id = i.user_id
      join users iu on iu.id = p.introducer_user_id
      join contact_research r on r.email = ${email.toLowerCase()} and r.status = 'found'
      join users g on g.id = r.seat_user_id
      where p.id = ${proposalId} and p.status = 'checking'
    `);
    const [row] = rowsOf(result);
    if (!row || !row.intent_text) return null;
    const introducerIntents = await db.execute(sql`
      select coalesce(nullif(i.summary, ''), i.payload) as text
      from intents i
      where i.user_id = ${String(row.introducer_id)}
        and i.archived_at is null and (i.status is null or i.status = 'active') and i.is_private = false
      order by i.created_at desc
      limit 5
    `);
    const socials = await db.select({ value: schema.userSocials.value }).from(schema.userSocials)
      .where(eq(schema.userSocials.userId, String(row.ghost_id)));
    return {
      introducer: {
        name: String(row.introducer_name), intro: (row.introducer_intro as string | null) ?? null,
        intents: rowsOf(introducerIntents).map((r) => String(r.text)).filter(Boolean),
      },
      member: { name: String(row.member_name), intro: (row.member_intro as string | null) ?? null, intent: String(row.intent_text) },
      contact: { name: String(row.ghost_name), headline: String(row.ghost_intro ?? ''), socials: socials.map((s) => s.value) },
    };
  }

  /** A judged pair worth both sides: shown on the desk. Only a pair still checking is changed. */
  async promoteProposal(id: string, pair: {
    confidence: number; card: { member: string; contact: string }; draft: string;
    judgment: { memberGets: string; contactGets: string };
  }): Promise<void> {
    const reasoning = `${pair.card.member} ⇄ ${pair.card.contact}`;
    await db.execute(sql`
      update opportunity_proposals set
        status = 'proposed',
        confidence = ${String(pair.confidence)},
        interpretation = coalesce(interpretation, '{}'::jsonb)
          || jsonb_build_object('reasoning', ${reasoning}::text, 'confidence', ${pair.confidence}::float8),
        metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{introducer}',
                     coalesce(metadata->'introducer', '{}'::jsonb) || jsonb_build_object('context', ${pair.draft}::text))
          || jsonb_build_object(
               'card', jsonb_build_object('member', ${pair.card.member}::text, 'contact', ${pair.card.contact}::text),
               'judgment', jsonb_build_object('memberGets', ${pair.judgment.memberGets}::text, 'contactGets', ${pair.judgment.contactGets}::text)),
        updated_at = now()
      where id = ${id} and status = 'checking'
    `);
  }

  /** A judged pair that doesn't work both ways: settled with the reason. Only a pair still checking is changed. */
  async unmatchProposal(id: string, failure: string): Promise<void> {
    await db.update(opportunityProposals)
      .set({ status: 'unmatched', failure, updatedAt: new Date() })
      .where(and(eq(opportunityProposals.id, id), eq(opportunityProposals.status, 'checking')));
  }

  /** After giving up: start the count over but keep the last try's time, so a later pair retries after the backoff. */
  async resetResearchAttempts(email: string): Promise<void> {
    await db.update(schema.contactResearch).set({ attempts: 0 }).where(eq(schema.contactResearch.email, email.toLowerCase()));
  }

  /** Whether research settled this email, if it did. */
  async researchStatus(email: string): Promise<'found' | 'not_found' | null> {
    const [row] = await db.select({ status: schema.contactResearch.status }).from(schema.contactResearch)
      .where(eq(schema.contactResearch.email, email.toLowerCase()));
    return row?.status ?? null;
  }

  /** How many research tries an email has had. */
  async researchAttempts(email: string): Promise<number> {
    const [row] = await db.select({ attempts: schema.contactResearch.attempts }).from(schema.contactResearch)
      .where(eq(schema.contactResearch.email, email.toLowerCase()));
    return row?.attempts ?? 0;
  }

  /** Every proposal of one status made from a contact with this email, across introducers. */
  async proposalsForEmail(email: string, status: 'checking'): Promise<ProposalRow[]> {
    const result = await db.execute(sql`
      select p.id, p.status, p.failure, p.confidence, p.detection, p.actors, p.interpretation, p.context, p.metadata,
             p.network_id, n.title as network_title, p.opportunity_id, p.created_at,
             u.id as member_id, u.name as member_name, u.avatar as member_avatar,
             i.id as intent_id, case when i.is_private then '' else coalesce(nullif(i.summary, ''), i.payload) end as intent_text,
             c.id as contact_id, c.email, c.name, c.organization, c.title
      from opportunity_proposals p
      join intents i on i.id = p.intent_id
      join users u on u.id = i.user_id
      join contacts c on c.id = p.contact_id
      join networks n on n.id = p.network_id
      where lower(c.email) = ${email.toLowerCase()} and p.status = ${status}
      order by p.created_at asc
    `);
    return rowsOf(result).map(toProposalRow);
  }

  /** What one research try came to. Failed tries count; found and not found are final. */
  async recordResearch(email: string, outcome: 'found' | 'not_found' | 'failed', seatUserId?: string): Promise<void> {
    const key = email.toLowerCase();
    const now = new Date();
    if (outcome === 'failed') {
      await db.insert(schema.contactResearch).values({ email: key, attempts: 1, lastAttemptAt: now })
        .onConflictDoUpdate({
          target: schema.contactResearch.email,
          set: { attempts: sql`${schema.contactResearch.attempts} + 1`, lastAttemptAt: now },
        });
      return;
    }
    const set = { status: outcome, seatUserId: outcome === 'found' ? seatUserId ?? null : null, researchedAt: now, lastAttemptAt: now };
    await db.insert(schema.contactResearch).values({ email: key, attempts: 1, ...set })
      .onConflictDoUpdate({ target: schema.contactResearch.email, set });
  }

  /** An existing seat's live public intent closest to the member's, if it has one. */
  async closestSeatIntent(seatUserId: string, memberIntentId: string): Promise<string | null> {
    const result = await db.execute(sql`
      select g.id from intents g
      where g.user_id = ${seatUserId} and g.archived_at is null and (g.status is null or g.status = 'active') and g.is_private = false
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
      select o.id as opportunity_id, seat.id as seat_id, seat.email, seat.name as seat_name,
             intro.name as introducer_name, mu.id as member_id, mu.name as member_name,
             -- An intent made private after the member said yes is never emailed.
             case when mi.is_private then '' else coalesce(nullif(mi.summary, ''), mi.payload) end as member_intent,
             coalesce(o.metadata->'introducer'->>'context', '') as context
      from opportunity_proposals s
      join opportunities o on o.id = s.opportunity_id
      join users seat on seat.id = s.actors->1->>'userId' and not seat.email_verified and seat.deleted_at is null
      join users intro on intro.id = s.introducer_user_id
      join intents mi on mi.id = s.intent_id
      join users mu on mu.id = mi.user_id
      where s.status = 'opened'
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
      seatName: (r.seat_name as string | null) ?? null,
      introducerName: String(r.introducer_name),
      memberId: String(r.member_id),
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
      from opportunity_proposals s
      join opportunities o on o.id = s.opportunity_id and o.status in ('rejected', 'expired')
      join users seat on seat.id = s.actors->1->>'userId' and not seat.email_verified and seat.deleted_at is null
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
      select o.id as opportunity_id, o.status, o.created_at, o.updated_at,
             o.metadata->'introducer'->>'context' as context,
             n.initiator_user_id as a_user, ua.name as a_name, ua.avatar as a_avatar,
             case when ia.is_private then '' else coalesce(nullif(ia.summary, ''), ia.payload) end as a_text,
             n.responder_user_id as b_user, ub.name as b_name, ub.avatar as b_avatar,
             case when ib.is_private then '' else coalesce(nullif(ib.summary, ''), ib.payload) end as b_text
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
      updatedAt: new Date(String(r.updated_at)),
      context: String(r.context ?? ''),
      a: { userId: String(r.a_user), name: String(r.a_name), avatar: (r.a_avatar as string | null) ?? null, intentText: String(r.a_text) },
      b: { userId: String(r.b_user), name: String(r.b_name), avatar: (r.b_avatar as string | null) ?? null, intentText: String(r.b_text) },
    }));
  }

  /**
   * What each person lets their introducers learn. A person with no setting,
   * including a contact who has not signed up, shares the status.
   */
  async reportSettings(userIds: string[]): Promise<Map<string, IntroducerReportSetting>> {
    const settings = new Map<string, IntroducerReportSetting>(userIds.map((id) => [id, 'status']));
    if (!userIds.length) return settings;
    const rows = await db.select({ userId: schema.userNotificationSettings.userId, preferences: schema.userNotificationSettings.preferences })
      .from(schema.userNotificationSettings)
      .where(inArray(schema.userNotificationSettings.userId, userIds));
    for (const row of rows) {
      const value = (row.preferences as { introducerReports?: unknown } | null)?.introducerReports;
      if (value === 'note' || value === 'none') settings.set(row.userId, value);
    }
    return settings;
  }

  /** Notes the seats sent back, oldest first. Who sent each is never returned. */
  async reports(opportunityIds: string[]): Promise<Map<string, { note: string; at: Date }[]>> {
    const grouped = new Map<string, { note: string; at: Date }[]>();
    if (!opportunityIds.length) return grouped;
    const rows = await db.select({ opportunityId: schema.opportunityEvents.opportunityId, data: schema.opportunityEvents.data, at: schema.opportunityEvents.at })
      .from(schema.opportunityEvents)
      .where(and(inArray(schema.opportunityEvents.opportunityId, opportunityIds), eq(schema.opportunityEvents.type, 'report')))
      .orderBy(schema.opportunityEvents.at);
    for (const row of rows) {
      const note = typeof row.data?.note === 'string' ? row.data.note : '';
      if (!note) continue;
      const list = grouped.get(row.opportunityId) ?? [];
      list.push({ note, at: row.at });
      grouped.set(row.opportunityId, list);
    }
    return grouped;
  }

  /** What reporting back reads of an opportunity: its status, its introducer, and its seats. */
  async reportTarget(opportunityId: string): Promise<{ status: string; introducerUserId: string | null; actorIds: string[] } | null> {
    const [row] = await db.select({
      status: schema.opportunities.status,
      actors: schema.opportunities.actors,
      introducer: sql<string | null>`${schema.opportunities.metadata}->'introducer'->>'userId'`,
    })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.id, opportunityId))
      .limit(1);
    if (!row) return null;
    return {
      status: row.status,
      introducerUserId: row.introducer ?? null,
      actorIds: (row.actors ?? []).map((actor) => actor.userId).filter(Boolean),
    };
  }

  /** Whether this seat already reported on this opportunity. */
  async hasReported(opportunityId: string, userId: string): Promise<boolean> {
    const [row] = await db.select({ id: schema.opportunityEvents.id })
      .from(schema.opportunityEvents)
      .where(and(eq(schema.opportunityEvents.opportunityId, opportunityId), eq(schema.opportunityEvents.actorUserId, userId), eq(schema.opportunityEvents.type, 'report')))
      .limit(1);
    return !!row;
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
