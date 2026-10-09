import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '@indexnetwork/api/src/lib/drizzle/drizzle';
import * as schema from '@indexnetwork/api/src/schemas/database.schema';
import { log } from '@indexnetwork/api/src/lib/log';
import { executeSendEmail } from '@indexnetwork/api/src/lib/email/transport.helper';
import { EmbedderAdapter } from '@indexnetwork/api/src/adapters/embedder.adapter';
import { intentService } from '@indexnetwork/api/src/services/intent.service';
import { networkService } from '@indexnetwork/api/src/services/network.service';

import { findPeople, type FoundPerson } from './find-people';
import { ghostOutreachTemplate } from './outreach.template';

const logger = log.job.from('GhostNetwork');

/** Ghost counterparties each member signal is opened with. */
const GHOSTS_PER_SIGNAL = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!email || !EMAIL_REGEX.test(email) || !signals.length) return null;

  // Soft-deleted rows count: someone who opted out is never seated again.
  const [existing] = await db.select({
    id: schema.users.id,
    emailVerified: schema.users.emailVerified,
    deletedAt: schema.users.deletedAt,
  }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return !existing.emailVerified && !existing.deletedAt ? existing.id : null;

  const embeddings = await embedder.generate(signals) as number[][];
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users)
      .values({ email, name: person.headline, intro: person.headline, emailVerified: false })
      .onConflictDoNothing()
      .returning({ id: schema.users.id });
    if (!user) return null;
    await tx.insert(schema.networkMembers).values({ networkId, userId: user.id, permissions: ['member'] });
    await tx.insert(schema.userNotificationSettings).values({ userId: user.id, preferences: { morningBrief: false } });
    const rows = await tx.insert(schema.intents)
      .values(signals.map((payload, i) => ({ payload, userId: user.id, embedding: embeddings[i] })))
      .returning({ id: schema.intents.id });
    await tx.insert(schema.intentNetworks).values(rows.map((row) => ({ intentId: row.id, networkId })));
    return user.id;
  });
}

/**
 * For every member signal in the Ghost network with fewer than 10 ghost
 * counterparties, research the missing ones and open an opportunity from each
 * ghost's closest signal. Opening starts the hosted negotiation.
 *
 * @returns How many opportunities now pair a ghost with a member signal from this pass.
 */
export async function seedPass(): Promise<number> {
  const networkId = ghostNetworkId();
  const signals = await db.execute<{ id: string; payload: string; ghosts: number }>(sql`
    select i.id, i.payload,
      (select count(*)::int from negotiations g
        join users gu on gu.id = g.initiator_user_id and not gu.email_verified
        where g.responder_intent_id = i.id) as ghosts
    from intents i
    join intent_networks a on a.intent_id = i.id and a.network_id = ${networkId}
    join network_members m on m.user_id = i.user_id and m.network_id = ${networkId} and m.deleted_at is null
    join users u on u.id = i.user_id and u.email_verified and u.deleted_at is null
    where i.archived_at is null and (i.status is null or i.status = 'active')
  `);

  let paired = 0;
  for (const signal of signals) {
    const missing = GHOSTS_PER_SIGNAL - signal.ghosts;
    if (missing <= 0) continue;
    try {
      for (const person of await findPeople(signal.payload, missing)) {
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
        const outcome = await intentService.createOpportunities(closest.id, ghostId, [{ intentId: signal.id, networkId }]);
        if (outcome.kind === 'ok') paired += outcome.opportunities.length;
      }
    } catch (error) {
      logger.error('Ghost seeding failed for a signal', { intentId: signal.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
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
    select o.id, gu.email, mu.name as member_name, mi.payload as member_signal,
      (select t.message from negotiation_turns t where t.negotiation_id = g.id order by t.turn_index desc limit 1) as reason
    from negotiations g
    join opportunities o on o.id = g.opportunity_id
    join users gu on gu.id = g.initiator_user_id and not gu.email_verified and gu.deleted_at is null
    join users mu on mu.id = g.responder_user_id
    join intents mi on mi.id = g.responder_intent_id
    where o.context->>'networkId' = ${networkId}
      and o.status = 'pending'
      and o.metadata->>'ghostContactedAt' is null
      and exists (
        select 1 from opportunity_events e
        where e.opportunity_id = o.id and e.type = 'committed' and e.actor_user_id = g.responder_user_id
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
