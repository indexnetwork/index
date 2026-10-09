/**
 * Seeds the roster into local `index_test` and puts every signal through
 * normal admission (`IntentService.create`, the same prepare → verify →
 * persist path the API uses).
 *
 * Each case becomes one community whose members hold confirmed profiles. Only
 * rows the evaluator owns are touched: users under {@link EMAIL_DOMAIN} and
 * networks keyed `match-quality-*`. Admission failures are reported, not
 * retried: the wording is revised by hand, then the roster is frozen.
 */
import { inArray, like, or, sql } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { intentNetworks, intents, networkJoinRequests, networkMembers, networks, users } from '../../schemas/database.schema';
import { IntentCreateRejectedError, intentService } from '../../services/intent.service';

import { fixtureFingerprint, memberName, type CaseMember, type MatchCase } from './match-quality.cases';

export const EMAIL_DOMAIN = 'match-quality.example.invalid';
const NETWORK_KEY_PREFIX = 'match-quality-';

/** What the seed stamps on a case's community once all its signals are admitted. */
export interface SeedStamp {
  caseId: string;
  fixtureFingerprint: string;
  admittedAt: string;
}

/** One signal's admission verdict. */
export interface AdmissionRecord {
  caseId: string;
  memberKey: string;
  role: CaseMember['role'];
  signal: string;
  admitted: boolean;
  /** The rejection feedback, or the failure for anything that was not a rejection. */
  detail?: string;
  intentId?: string;
}

/** @returns The network key of a case's community. */
export function networkKey(caseId: string): string {
  return `${NETWORK_KEY_PREFIX}${caseId}`;
}

/** @returns The email of one case member. */
export function memberEmail(caseId: string, memberKey: string): string {
  return `${caseId}.${memberKey}@${EMAIL_DOMAIN}`;
}

/** Delete every row an earlier seed wrote, children first. */
async function removeEvaluatorRows(): Promise<void> {
  await db.transaction(async (tx) => {
    const ownedUsers = (await tx.select({ id: users.id }).from(users).where(like(users.email, `%@${EMAIL_DOMAIN}`)))
      .map((row) => row.id);
    const ownedNetworks = (await tx.select({ id: networks.id }).from(networks).where(like(networks.key, `${NETWORK_KEY_PREFIX}%`)))
      .map((row) => row.id);
    const ownedIntents = ownedUsers.length
      ? (await tx.select({ id: intents.id }).from(intents).where(inArray(intents.userId, ownedUsers))).map((row) => row.id)
      : [];

    if (ownedIntents.length || ownedNetworks.length) {
      await tx.delete(intentNetworks).where(or(
        ownedIntents.length ? inArray(intentNetworks.intentId, ownedIntents) : sql`false`,
        ownedNetworks.length ? inArray(intentNetworks.networkId, ownedNetworks) : sql`false`,
      ));
    }
    if (ownedIntents.length) await tx.delete(intents).where(inArray(intents.id, ownedIntents));
    if (ownedUsers.length || ownedNetworks.length) {
      const byUserOrNetwork = <T extends typeof networkMembers | typeof networkJoinRequests>(table: T) => or(
        ownedUsers.length ? inArray(table.userId, ownedUsers) : sql`false`,
        ownedNetworks.length ? inArray(table.networkId, ownedNetworks) : sql`false`,
      );
      await tx.delete(networkMembers).where(byUserOrNetwork(networkMembers));
      await tx.delete(networkJoinRequests).where(byUserOrNetwork(networkJoinRequests));
    }
    if (ownedNetworks.length) await tx.delete(networks).where(inArray(networks.id, ownedNetworks));
    if (ownedUsers.length) await tx.delete(users).where(inArray(users.id, ownedUsers));
  });
}

/**
 * Create one case's community and members, then admit each member's signal.
 *
 * @returns One admission record per member.
 */
async function seedCase(matchCase: MatchCase, fingerprint: string): Promise<AdmissionRecord[]> {
  const confirmedAt = new Date().toISOString();
  const [network] = await db.insert(networks).values({
    title: `Match quality: ${matchCase.id}`,
    key: networkKey(matchCase.id),
    prompt: null,
    metadata: {},
    permissions: { joinPolicy: 'invite_only', invitationLink: null },
  }).returning({ id: networks.id });

  const seated = [];
  for (const [index, member] of matchCase.members.entries()) {
    const [user] = await db.insert(users).values({
      email: memberEmail(matchCase.id, member.key),
      name: memberName(index),
      intro: member.profile.intro,
      location: member.profile.location,
      timezone: member.profile.timezone,
      onboarding: { completedAt: confirmedAt, profileConfirmedAt: confirmedAt },
    }).returning({ id: users.id });
    await db.insert(networkMembers).values({ networkId: network.id, userId: user.id, permissions: ['member'] });
    seated.push({ member, userId: user.id });
  }

  const records = await Promise.all(seated.map(async ({ member, userId }): Promise<AdmissionRecord> => {
    const base = { caseId: matchCase.id, memberKey: member.key, role: member.role, signal: member.signal };
    try {
      const created = await intentService.create(userId, member.signal, [network.id]);
      return { ...base, admitted: true, intentId: created.id };
    } catch (error) {
      const rejected = error instanceof IntentCreateRejectedError;
      return { ...base, admitted: false, detail: `${rejected ? 'rejected' : 'failed'}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }));

  if (records.every((record) => record.admitted)) {
    const stamp: SeedStamp = { caseId: matchCase.id, fixtureFingerprint: fingerprint, admittedAt: new Date().toISOString() };
    await db.update(networks).set({ metadata: { matchQuality: stamp } }).where(inArray(networks.id, [network.id]));
  }
  return records;
}

/**
 * Replace the evaluator's rows with a fresh seed of `cases` and admit every signal.
 *
 * @param cases - The roster to seed.
 * @returns Every admission verdict, in roster order.
 */
export async function seedRoster(cases: MatchCase[]): Promise<AdmissionRecord[]> {
  await removeEvaluatorRows();
  const fingerprint = fixtureFingerprint(cases);
  const records: AdmissionRecord[] = [];
  for (const matchCase of cases) records.push(...await seedCase(matchCase, fingerprint));
  return records;
}
