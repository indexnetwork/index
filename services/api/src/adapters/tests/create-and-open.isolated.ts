/**
 * The live proof that the pair advisory lock serialises two callers.
 *
 * This is the spec's "parallel kickoff on one pair → one row" check. It cannot
 * be a unit test: the invariant IS the database lock, so it needs two real
 * transactions contending for it. Both principals' PersonalAgents wake on the
 * same candidate and both decide to open it — exactly the race the pair key
 * exists to lose gracefully.
 */
import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, it as bunIt } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm/sql';
import { v4 as uuidv4 } from 'uuid';

import db from '../../lib/drizzle/drizzle';
import { discoveryMatchCandidates, intentNetworks, intents, networkMembers, networks, opportunities, users } from '../../schemas/database.schema';
import { pairKeyOf } from '@indexnetwork/protocol';
import { discoveryCandidateAdapter } from '../discovery-candidate.database.adapter';
import { withMinimumDatabaseHookBudget, withMinimumDatabaseTestBudget } from '../../lib/testing/database-test-budget';

const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 120_000);
const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 90_000);
const it = withMinimumDatabaseTestBudget(bunIt, 45_000);

const PREFIX = 'create_and_open_' + Date.now() + '_';
const userAId = uuidv4();
const userBId = uuidv4();
const networkId = uuidv4();
const intentAId = uuidv4();
const intentBId = uuidv4();
let candidateId: string;

beforeAll(async () => {
  await db.insert(users).values([
    { id: userAId, email: PREFIX + userAId + '@test.com', name: PREFIX + 'Ali' },
    { id: userBId, email: PREFIX + userBId + '@test.com', name: PREFIX + 'Bea' },
  ]);
  await db.insert(networks).values({ id: networkId, title: PREFIX + 'Net', prompt: 'p' });
  await db.insert(networkMembers).values([
    { networkId, userId: userAId, permissions: ['owner'], autoAssign: false },
    { networkId, userId: userBId, permissions: ['member'], autoAssign: false },
  ]);
  await db.insert(intents).values([
    { id: intentAId, userId: userAId, payload: PREFIX + 'A', summary: 'A', sourceType: 'discovery_form', sourceId: userAId },
    { id: intentBId, userId: userBId, payload: PREFIX + 'B', summary: 'B', sourceType: 'discovery_form', sourceId: userBId },
  ]);
  await db.insert(intentNetworks).values([
    { intentId: intentAId, networkId }, { intentId: intentBId, networkId },
  ]);

  const [candidate] = await discoveryCandidateAdapter.upsertDiscoveryMatchCandidates([{
    pairKey: pairKeyOf(networkId, intentAId, intentBId),
    networkId, intentA: intentAId, intentB: intentBId, userA: userAId, userB: userBId,
    score: 74, reasoning: 'Both are building agent infrastructure.', evidence: [],
  }]);
  candidateId = candidate!.id;
}, 60_000);

afterAll(async () => {
  await db.delete(discoveryMatchCandidates).where(eq(discoveryMatchCandidates.networkId, networkId));
  await db.delete(opportunities).where(sql`${opportunities.context}->>'networkId' = ${networkId}`);
  await db.delete(intentNetworks).where(inArray(intentNetworks.intentId, [intentAId, intentBId]));
  await db.delete(intents).where(inArray(intents.id, [intentAId, intentBId]));
  await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
  await db.delete(networks).where(eq(networks.id, networkId));
  await db.delete(users).where(inArray(users.id, [userAId, userBId]));
}, 60_000);

describe('createAndOpen under concurrent kickoff', () => {
  it('two agents racing one pair produce exactly one opportunity', async () => {
    const [a, b] = await Promise.all([
      discoveryCandidateAdapter.createAndOpen(candidateId),
      discoveryCandidateAdapter.createAndOpen(candidateId),
    ]);

    expect([a.status, b.status].sort()).toEqual(['created', 'existing']);
    const idA = 'opportunityId' in a ? a.opportunityId : null;
    const idB = 'opportunityId' in b ? b.opportunityId : null;
    expect(idA).toBe(idB!);

    const rows = await db.select().from(opportunities)
      .where(sql`${opportunities.context}->>'networkId' = ${networkId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('negotiating');
  });

  it('marks the candidate opened and points it at the row', async () => {
    const [candidate] = await db.select().from(discoveryMatchCandidates)
      .where(eq(discoveryMatchCandidates.id, candidateId));
    expect(candidate!.status).toBe('opened');
    expect(candidate!.openedOpportunityId).toBeTruthy();
  });

  it('refuses to open a pair whose participant left the network', async () => {
    // The eligibility check the persist node used to hold. A membership can be
    // revoked between discovery and kickoff, and the row is born here.
    const goneUser = uuidv4();
    const goneIntent = uuidv4();
    await db.insert(users).values({ id: goneUser, email: PREFIX + goneUser + '@t.com', name: PREFIX + 'Gone' });
    await db.insert(intents).values({
      id: goneIntent, userId: goneUser, payload: PREFIX + 'G', summary: 'G',
      sourceType: 'discovery_form', sourceId: goneUser,
    });
    const [orphan] = await discoveryCandidateAdapter.upsertDiscoveryMatchCandidates([{
      pairKey: pairKeyOf(networkId, intentAId, goneIntent),
      networkId, intentA: intentAId, intentB: goneIntent, userA: userAId, userB: goneUser,
      score: 60, reasoning: 'r', evidence: [],
    }]);

    const result = await discoveryCandidateAdapter.createAndOpen(orphan!.id);
    expect(result).toEqual({ status: 'failed', reason: 'participant_left_network' });

    await db.delete(discoveryMatchCandidates).where(eq(discoveryMatchCandidates.id, orphan!.id));
    await db.delete(intents).where(eq(intents.id, goneIntent));
    await db.delete(users).where(eq(users.id, goneUser));
  });

  it('reports a candidate that does not exist rather than throwing', async () => {
    const result = await discoveryCandidateAdapter.createAndOpen(uuidv4());
    expect(result).toEqual({ status: 'failed', reason: 'candidate_not_found' });
  });
});
