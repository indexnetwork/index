import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '@indexnetwork/api/src/lib/drizzle/drizzle';
import * as schema from '@indexnetwork/api/src/schemas/database.schema';
import { log } from '@indexnetwork/api/src/lib/log';
import { executeSendEmail } from '@indexnetwork/api/src/lib/email/transport.helper';
import { EmbedderAdapter } from '@indexnetwork/api/src/adapters/embedder.adapter';
import { intentService } from '@indexnetwork/api/src/services/intent.service';
import { networkService } from '@indexnetwork/api/src/services/network.service';
import { detectSocialLabel } from '@indexnetwork/api/src/adapters/database.shared';

import { findPeople, type FoundPerson } from './find-people';
import { ghostOutreachTemplate } from './outreach.template';

const logger = log.job.from('GhostNetwork');
const UNAVATAR_URL = 'https://unavatar.io';

/** Platform profiles from any URL, plus personal sites only when asked. */
function profileLinks(urls: string[], includeSites = false): { label: string; value: string }[] {
  const seen = new Set<string>();
  const rows: { label: string; value: string }[] = [];
  for (const raw of urls) {
    const value = raw.trim();
    if (!/^https?:\/\//i.test(value)) continue;
    const label = detectSocialLabel(value);
    if (label === 'custom' && !includeSites) continue;
    const key = label === 'custom' ? value : label;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, value });
  }
  return rows;
}

/** A public photo for this address, or null when none is listed. */
async function publicAvatar(email: string): Promise<string | null> {
  try {
    const response = await fetch(`${UNAVATAR_URL}/${encodeURIComponent(email)}?fallback=false`);
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('image/')) return null;
    return response.url;
  } catch {
    return null;
  }
}

/** Ghost counterparties each member signal is introduced to. */
const GHOSTS_PER_SIGNAL = 3;
const GHOST_RIDER_EMAIL = 'ghost-rider@index.network';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A shared inbox is a firm, not a person. */
const SHARED_INBOX = /^(info|hello|contact|team|press|office|support|hi|careers|jobs|media|pr|partners|invest|admin|enquiries|inquiries)@/;

const embedder = new EmbedderAdapter();

/** @returns The Ghost network id. */
function ghostNetworkId(): string {
  const id = process.env.GHOST_NETWORK_ID;
  if (!id) throw new Error('GHOST_NETWORK_ID is required.');
  return id;
}

/**
 * Create the public Ghost network, owned by the automation account.
 *
 * @param ownerEmail - The automation account's email.
 * @returns The new network id, to set as GHOST_NETWORK_ID.
 */
export async function createGhostNetwork(ownerEmail: string): Promise<string> {
  const [owner] = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.email, ownerEmail.trim().toLowerCase()), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!owner) throw new Error(`No user with email ${ownerEmail}`);
  const network = await networkService.createNetwork(owner.id, {
    title: 'Ghost',
    prompt: 'People found on the public web who are not on Index yet. Join to have your signals matched with them.',
    joinPolicy: 'anyone',
  });
  return network.id;
}

/**
 * The account that introduces every ghost match. It owns no signals, so it
 * can introduce any pair in the Ghost network.
 *
 * @param networkId - The Ghost network.
 * @returns Ghost rider's user id.
 */
async function ghostRider(networkId: string): Promise<string> {
  await db.insert(schema.users).values({ email: GHOST_RIDER_EMAIL, name: 'Ghost rider', emailVerified: true }).onConflictDoNothing();
  const [rider] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, GHOST_RIDER_EMAIL)).limit(1);
  if (!rider) throw new Error('Ghost rider could not be created.');
  await db.insert(schema.networkMembers).values({ networkId, userId: rider.id, permissions: ['member'] }).onConflictDoNothing();
  return rider.id;
}

/**
 * Seat someone found on the web as an unclaimed member: an unverified user in
 * the Ghost network with signals inferred from public sources. Their morning
 * wake is off and nothing announces their signals, so they only ever negotiate.
 *
 * @param networkId - The Ghost network.
 * @param person - Who research found.
 * @returns The ghost's user id, or null when they are already on Index, opted out, or unreachable.
 */
async function upsertGhost(networkId: string, person: FoundPerson): Promise<string | null> {
  const email = person.email?.trim().toLowerCase();
  const signals = person.signals.map((signal) => signal.trim()).filter(Boolean);
  if (!email || !EMAIL_REGEX.test(email) || SHARED_INBOX.test(email) || !signals.length) return null;

  // Soft-deleted rows count: someone who opted out is never seated again.
  const [existing] = await db.select({
    id: schema.users.id,
    emailVerified: schema.users.emailVerified,
    deletedAt: schema.users.deletedAt,
  }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return !existing.emailVerified && !existing.deletedAt ? existing.id : null;

  const [embeddings, avatar] = await Promise.all([embedder.generate(signals) as Promise<number[][]>, publicAvatar(email)]);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users)
      .values({ email, name: person.name, intro: person.headline, avatar, emailVerified: false })
      .onConflictDoNothing()
      .returning({ id: schema.users.id });
    if (!user) return null;
    const links = [
      ...profileLinks(person.socials, true),
      ...profileLinks(person.sources).filter((link) => !person.socials.some((url) => detectSocialLabel(url) === link.label)),
    ];
    if (links.length) await tx.insert(schema.userSocials).values(links.map((link) => ({ userId: user.id, ...link })));
    await tx.insert(schema.networkMembers).values({ networkId, userId: user.id, permissions: ['member'] });
    await tx.insert(schema.userNotificationSettings).values({ userId: user.id, preferences: { morningBrief: false } });
    const rows = await tx.insert(schema.intents)
      .values(signals.map((payload, i) => ({ payload, userId: user.id, embedding: embeddings[i] })))
      .returning({ id: schema.intents.id });
    await tx.insert(schema.intentNetworks).values(rows.map((row) => ({ intentId: row.id, networkId })));
    return user.id;
  });
}

/** Active Ghost-network signals owned by a verified member, with how many ghosts each already has. */
function memberSignals(networkId: string, intentId?: string) {
  return db.execute<{ id: string; payload: string; ghosts: number }>(sql`
    select i.id, i.payload,
      (select count(*)::int from negotiations g
        join users a on a.id = g.initiator_user_id
        join users b on b.id = g.responder_user_id
        where (g.initiator_intent_id = i.id or g.responder_intent_id = i.id)
          and ((not a.email_verified and a.deleted_at is null) or (not b.email_verified and b.deleted_at is null))
      ) as ghosts
    from intents i
    join intent_networks a on a.intent_id = i.id and a.network_id = ${networkId}
    join network_members m on m.user_id = i.user_id and m.network_id = ${networkId} and m.deleted_at is null
    join users u on u.id = i.user_id and u.email_verified and u.deleted_at is null
    where i.archived_at is null and (i.status is null or i.status = 'active')
      ${intentId ? sql`and i.id = ${intentId}` : sql``}
  `);
}

/**
 * Research up to 3 ghosts for one signal and have Ghost rider introduce them.
 * The member's agent speaks first. A signal that is not shared in the Ghost
 * network, or that already has its ghosts, introduces nobody.
 *
 * The creation event is published before the signal is linked to its networks,
 * so a member's signal is checked once more after a short wait.
 *
 * @param intentId - The signal to introduce for.
 * @returns How many introductions were opened.
 */
export async function introduceSignal(intentId: string): Promise<number> {
  const networkId = ghostNetworkId();
  let [signal] = await memberSignals(networkId, intentId);
  if (!signal) {
    const [member] = await db.execute<{ id: string }>(sql`
      select i.id from intents i
      join network_members m on m.user_id = i.user_id and m.network_id = ${networkId} and m.deleted_at is null
      where i.id = ${intentId} limit 1
    `);
    if (!member) return 0;
    await Bun.sleep(2000);
    [signal] = await memberSignals(networkId, intentId);
    if (!signal || signal.ghosts >= GHOSTS_PER_SIGNAL) return 0;
  } else if (signal.ghosts >= GHOSTS_PER_SIGNAL) return 0;

  const riderId = await ghostRider(networkId);
  let paired = 0;
  try {
    for (const person of await findPeople(signal.payload, GHOSTS_PER_SIGNAL - signal.ghosts)) {
      const ghostId = await upsertGhost(networkId, person);
      if (!ghostId) continue;
      const [closest] = await db.execute<{ id: string }>(sql`
        select g.id from intents g
        join intent_networks a on a.intent_id = g.id and a.network_id = ${networkId}
        where g.user_id = ${ghostId} and g.archived_at is null
        order by g.embedding <=> (select embedding from intents where id = ${signal.id}) nulls last
        limit 1
      `);
      if (!closest) continue;
      const outcome = await intentService.openOpportunity(riderId, networkId, [signal.id, closest.id], person.reason);
      if (outcome.kind === 'ok') paired++;
    }
  } catch (error) {
    logger.error('Ghost seeding failed for a signal', { intentId, error: error instanceof Error ? error.message : String(error) });
  }
  return paired;
}

/**
 * Introduce ghosts for every member signal still under the cap.
 *
 * @returns How many introductions were opened.
 */
export async function seedPass(): Promise<number> {
  const signals = await memberSignals(ghostNetworkId());
  let paired = 0;
  for (const signal of signals) paired += await introduceSignal(signal.id);
  return paired;
}

/**
 * Email each ghost whose match a member accepted, once per opportunity.
 *
 * @returns How many emails were sent.
 */
export async function outreachPass(): Promise<number> {
  const networkId = ghostNetworkId();
  const rows = await db.execute<{ id: string; email: string; member_name: string; member_signal: string; reason: string | null }>(sql`
    select o.id,
      case when not iu.email_verified then iu.email else ru.email end as email,
      case when iu.email_verified then iu.name else ru.name end as member_name,
      case when iu.email_verified then ii.payload else ri.payload end as member_signal,
      coalesce(o.metadata->'introducer'->>'context',
        (select t.message from negotiation_turns t where t.negotiation_id = g.id order by t.turn_index desc limit 1)) as reason
    from negotiations g
    join opportunities o on o.id = g.opportunity_id
    join users iu on iu.id = g.initiator_user_id
    join users ru on ru.id = g.responder_user_id
    join intents ii on ii.id = g.initiator_intent_id
    join intents ri on ri.id = g.responder_intent_id
    where o.context->>'networkId' = ${networkId}
      and o.status = 'pending'
      and o.metadata->>'ghostContactedAt' is null
      and (
        (not iu.email_verified and iu.deleted_at is null and ru.email_verified)
        or (not ru.email_verified and ru.deleted_at is null and iu.email_verified)
      )
      and exists (
        select 1 from opportunity_events e
        where e.opportunity_id = o.id and e.type = 'committed'
          and e.actor_user_id = case when iu.email_verified then iu.id else ru.id end
      )
  `);

  let sent = 0;
  for (const row of rows) {
    try {
      const email = ghostOutreachTemplate({ memberName: row.member_name, memberSignal: row.member_signal, reason: row.reason });
      const result = await executeSendEmail({ to: row.email, ...email }) as { skipped?: boolean };
      if (result.skipped) continue;
      await db.execute(sql`
        update opportunities
        set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('ghostContactedAt', now()::text)
        where id = ${row.id}
      `);
      sent++;
    } catch (error) {
      logger.error('Ghost outreach failed', { opportunityId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/**
 * Remove a ghost who asked not to be contacted. The row stays soft-deleted so
 * research never seats them again.
 *
 * @param email - The address they replied from.
 * @returns Whether an unclaimed ghost was removed.
 */
export async function optOut(email: string): Promise<boolean> {
  const rows = await db.update(schema.users)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(schema.users.email, email.trim().toLowerCase()),
      eq(schema.users.emailVerified, false),
      isNull(schema.users.deletedAt),
    ))
    .returning({ id: schema.users.id });
  return rows.length > 0;
}
