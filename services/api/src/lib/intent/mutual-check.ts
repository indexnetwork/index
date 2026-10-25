import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { decideNegotiationOpening, pairKeyOf, sideIsInterested, type MutualitySide } from '@indexnetwork/protocol';

import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { db } from '../../adapters/database.shared';
import { negotiationDatabaseAdapter } from '../../adapters/negotiation.database.adapter';
import * as schema from '../../schemas/database.schema';
import type { AssignmentVisibility } from '../../schemas/database.schema';
import { background } from '../background';
import { log } from '../log';

import { bothYes, poolFor } from './mutual-check.policy';

const REASONING = 'Mutual interest, checked by the network.';
const logger = log.job.from('mutual-check');

export { bothYes, poolFor };

/**
 * Check one intent against the mutuals in its networks, and open a pair only when both sides say yes.
 * Nothing is written on a no, and only ids are logged.
 */
export async function mutualCheck(intentId: string, networkIds?: string[]): Promise<void> {
  const [intent] = await db.select({
    id: schema.intents.id,
    userId: schema.intents.userId,
    payload: schema.intents.payload,
    embedding: schema.intents.embedding,
    isPrivate: schema.intents.isPrivate,
    archivedAt: schema.intents.archivedAt,
    status: schema.intents.status,
  }).from(schema.intents).where(eq(schema.intents.id, intentId)).limit(1);
  if (!intent || intent.isPrivate || intent.archivedAt || (intent.status != null && intent.status !== 'active')) return;
  if (!intent.embedding) return;

  const links = await db.select({
    networkId: schema.intentNetworks.networkId,
    visibility: schema.intentNetworks.visibility,
  }).from(schema.intentNetworks).where(and(
    eq(schema.intentNetworks.intentId, intentId),
    ...(networkIds?.length ? [inArray(schema.intentNetworks.networkId, networkIds)] : []),
  ));

  const embedder = new EmbedderAdapter();
  for (const link of links) {
    const candidates = await embedder.searchIntentCandidates(intent.embedding as number[], {
      networkScope: [link.networkId],
      excludeUserId: intent.userId,
      searchingIntentId: intent.id,
      visibilities: poolFor(link.visibility),
      limit: 5,
      minScore: 0,
    });
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      await checkPair(intent, candidate.id, candidate.userId, link.networkId, link.visibility);
    }
  }
}

/** Schedule a mutual check that must not undo the save that triggered it. */
export function scheduleMutualCheck(intentId: string, networkIds?: string[]): void {
  background('mutual-check', () => mutualCheck(intentId, networkIds));
}

async function checkPair(
  intent: { id: string; userId: string; payload: string },
  otherId: string,
  otherUserId: string,
  networkId: string,
  visibility: AssignmentVisibility,
): Promise<void> {
  const [other] = await db.select({
    id: schema.intents.id,
    payload: schema.intents.payload,
    isPrivate: schema.intents.isPrivate,
  }).from(schema.intents).where(eq(schema.intents.id, otherId)).limit(1);
  if (!other || other.isPrivate) return;

  const [mine, theirs] = await Promise.all([
    privateIntents(intent.userId, intent.id),
    privateIntents(otherUserId, other.id),
  ]);
  const a: MutualitySide = { statement: intent.payload, privateIntents: mine, otherStatement: other.payload };
  const b: MutualitySide = { statement: other.payload, privateIntents: theirs, otherStatement: intent.payload };
  const [yesA, yesB] = await Promise.all([sideIsInterested(a), sideIsInterested(b)]);
  logger.verbose('Mutual check', { intentId: intent.id, otherId, yesA, yesB });
  if (!bothYes(yesA, yesB)) return;

  const mutualFirst = visibility === 'mutuals_only';
  const intentA = mutualFirst ? intent.id : other.id;
  const intentB = mutualFirst ? other.id : intent.id;
  const userA = mutualFirst ? intent.userId : otherUserId;
  const userB = mutualFirst ? otherUserId : intent.userId;
  await negotiationDatabaseAdapter.openCounterparties([{
    pairKey: pairKeyOf(networkId, intentA, intentB),
    networkId,
    intentA,
    intentB,
    userA,
    userB,
    score: 100,
    reasoning: REASONING,
    evidence: [],
    detection: { source: 'mutual_check', createdBy: 'network' },
  }], decideNegotiationOpening);
}

async function privateIntents(userId: string, exceptId: string): Promise<string[]> {
  const rows = await db.select({ id: schema.intents.id, payload: schema.intents.payload })
    .from(schema.intents)
    .where(and(
      eq(schema.intents.userId, userId),
      eq(schema.intents.isPrivate, true),
      isNull(schema.intents.archivedAt),
      or(isNull(schema.intents.status), eq(schema.intents.status, 'active')),
    ));
  return rows.filter((row) => row.id !== exceptId).map((row) => row.payload);
}
