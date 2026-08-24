/**
 * Pending is sacred: the enricher may not expire a won match.
 *
 * `pending` means the agents already agreed and the row is waiting on its
 * OWNER's approval. The protocol enricher's merge-candidate pool
 * (DEFAULT_ENRICHER_EXCLUDE_STATUSES) omits `pending`, so a background sweep
 * that re-finds the same pair hands the pending row back to the api in
 * `expireIds` — and, before this guard, the api expired it, evaporating a match
 * the human was about to approve.
 *
 * The invariant pinned here: a `pending` opportunity leaves `pending` only by a
 * human decision (accept/reject) or by its signal being archived — never by
 * background churn. The intent-archive and removed-member cascades are
 * deliberate human-caused paths and stay, so this spec pins both sides.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { OpportunityDatabaseAdapter, ENRICHMENT_EXPIRY_PROTECTED_STATUSES } from '../opportunity.database.adapter';
import { opportunities } from '../../schemas/database.schema';

setDefaultTimeout(30_000);

const adapter = new OpportunityDatabaseAdapter();
const createdOpportunityIds: string[] = [];

afterAll(async () => {
  if (createdOpportunityIds.length > 0) {
    await db.delete(opportunities).where(inArray(opportunities.id, createdOpportunityIds));
  }
});

const PAIR = [randomUUID(), randomUUID()];
const NETWORK_ID = randomUUID();

async function seedOpportunity(
  status: typeof opportunities.$inferSelect['status'],
  intentId = randomUUID(),
) {
  const [opportunity] = await db.insert(opportunities).values({
    detection: { source: 'opportunity_graph', triggeredBy: intentId } as never,
    actors: [
      { userId: PAIR[0], networkId: NETWORK_ID, role: 'patient', intent: intentId },
      { userId: PAIR[1], networkId: NETWORK_ID, role: 'agent' },
    ] as never,
    interpretation: { reasoning: 'pending-guard fixture', category: 'collaboration' } as never,
    context: { networkId: NETWORK_ID } as never,
    confidence: '0.8',
    status,
  }).returning();
  createdOpportunityIds.push(opportunity.id);
  return opportunity;
}

/** The merged row a sweep writes when it re-finds the same pair. */
function enrichedCandidate() {
  return {
    detection: { source: 'opportunity_graph', triggeredBy: randomUUID() },
    actors: [
      { userId: PAIR[0], networkId: NETWORK_ID, role: 'patient' },
      { userId: PAIR[1], networkId: NETWORK_ID, role: 'agent' },
    ],
    interpretation: { reasoning: 'later sweep re-found this pair', category: 'collaboration' },
    context: { networkId: NETWORK_ID },
    confidence: '0.82',
    status: 'pending' as const,
  } as never;
}

async function readRow(id: string) {
  const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id));
  return row;
}

describe('enricher expiry — pending is sacred', () => {
  test('a pending prior row survives a merge sweep untouched, and the new row is still written', async () => {
    const won = await seedOpportunity('pending');

    const result = await adapter.createOpportunityAndExpireIds(enrichedCandidate(), [won.id]);
    createdOpportunityIds.push(result.created.id);

    // The won match is exactly as the sweep found it — status AND updatedAt, so
    // an attempt CAS keyed to that timestamp keeps its claim.
    const after = await readRow(won.id);
    expect(after.status).toBe('pending');
    expect(after.updatedAt.getTime()).toBe(won.updatedAt.getTime());

    // Nothing was expired, and the enriched candidate still exists for dedup
    // and suppression to handle on the read side.
    expect(result.expired).toHaveLength(0);
    expect(result.created.id).not.toBe(won.id);
  });

  test.each(['rejected', 'stalled', 'latent', 'draft'] as const)(
    'a %s prior row still merges and expires — the guard narrowed nothing else',
    async (status) => {
      const prior = await seedOpportunity(status);

      const result = await adapter.createOpportunityAndExpireIds(enrichedCandidate(), [prior.id]);
      createdOpportunityIds.push(result.created.id);

      expect(result.expired.map((row) => row.id)).toEqual([prior.id]);
      expect((await readRow(prior.id)).status).toBe('expired');
    },
  );

  test('a mixed expire set expires the dead rows and keeps only the pending one', async () => {
    const won = await seedOpportunity('pending');
    const dead = await seedOpportunity('stalled');

    const result = await adapter.createOpportunityAndExpireIds(enrichedCandidate(), [won.id, dead.id]);
    createdOpportunityIds.push(result.created.id);

    expect(result.expired.map((row) => row.id)).toEqual([dead.id]);
    expect((await readRow(won.id)).status).toBe('pending');
    expect((await readRow(dead.id)).status).toBe('expired');
  });

  test('the deliberate human-caused cascade still expires a pending row', async () => {
    // Archiving the signal behind a match is a human decision, not background
    // churn — the invariant names it as a way out of `pending`.
    const intentId = randomUUID();
    const won = await seedOpportunity('pending', intentId);

    expect(await adapter.expireOpportunitiesByIntent(intentId)).toBeGreaterThan(0);
    expect((await readRow(won.id)).status).toBe('expired');
  });
});

describe('enricher expiry — every merge path routes through the guard', () => {
  const source = readFileSync('src/adapters/opportunity.database.adapter.ts', 'utf8');

  test('pending is the protected status', () => {
    expect([...ENRICHMENT_EXPIRY_PROTECTED_STATUSES]).toEqual(['pending']);
  });

  test("no merge path writes status: 'expired' outside the shared guarded helper", () => {
    // The three enrichment-superseded expiry paths — createOpportunityAndExpireIds,
    // createOpportunityAndExpireIdsIfNetworkEligible and
    // persistIntentScopedOpportunityIfNetworkEligible — must all delegate, or a
    // sweep regains a way to expire a won match. The bulk writers
    // (expireOpportunitiesByIntent / ForRemovedMember / expireStaleOpportunities)
    // are deliberate non-enrichment paths and keep their own writes.
    const guardedCalls = source.match(/expireEnrichmentSupersededIds\(tx,/g) ?? [];
    expect(guardedCalls).toHaveLength(3);

    const expiredWrites = source.match(/\.set\(\{ status: 'expired'/g) ?? [];
    // One inside the helper, plus the three bulk writers.
    expect(expiredWrites).toHaveLength(4);
  });
});
