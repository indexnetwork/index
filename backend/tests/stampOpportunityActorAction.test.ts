import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { chatDatabaseAdapter } from '../src/adapters/database.adapter.js';
import { users, networks, opportunities } from '../src/schemas/database.schema.js';

const adapter = chatDatabaseAdapter;

const ACTOR_A = 'a0000000-0000-4000-8000-aaaaaaaaaaaa';
const ACTOR_B = 'a0000000-0000-4000-8000-bbbbbbbbbbbb';
const NET_ID = 'n0000000-0000-4000-8000-000000000001';
let OPP_ID: string;

describe('stampOpportunityActorAction', () => {
  beforeAll(async () => {
    await db
      .insert(users)
      .values([
        { id: ACTOR_A, email: 'a@test.local', name: 'A' },
        { id: ACTOR_B, email: 'b@test.local', name: 'B' },
      ])
      .onConflictDoNothing();
    await db
      .insert(networks)
      .values({ id: NET_ID, title: 'test-net' })
      .onConflictDoNothing();
    const opp = await adapter.createOpportunity({
      detection: { source: 'manual', timestamp: new Date().toISOString() } as never,
      actors: [
        { userId: ACTOR_A, networkId: NET_ID, role: 'patient' },
        { userId: ACTOR_B, networkId: NET_ID, role: 'agent' },
      ],
      interpretation: { category: 'test', reasoning: '', confidence: 1 } as never,
      context: { networkId: NET_ID },
      confidence: '1',
      status: 'draft',
    });
    OPP_ID = opp.id;
  });

  afterAll(async () => {
    await db.delete(opportunities).where(eq(opportunities.id, OPP_ID));
    await db.delete(networks).where(eq(networks.id, NET_ID));
    await db.delete(users).where(inArray(users.id, [ACTOR_A, ACTOR_B]));
  });

  test('stamps actedAt on the matching actor and updates status', async () => {
    const before = await adapter.getOpportunity(OPP_ID);
    expect(before?.actors.find(a => a.userId === ACTOR_A)?.actedAt).toBeUndefined();

    const updated = await adapter.stampOpportunityActorAction(OPP_ID, ACTOR_A, 'pending');

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('pending');
    const a = updated!.actors.find(a => a.userId === ACTOR_A)!;
    const b = updated!.actors.find(a => a.userId === ACTOR_B)!;
    expect(typeof a.actedAt).toBe('string');
    expect(new Date(a.actedAt!).toISOString()).toBe(a.actedAt!);
    expect(b.actedAt).toBeUndefined();
  });

  test('throws when status is accepted but acceptedBy is missing', async () => {
    await expect(
      adapter.stampOpportunityActorAction(OPP_ID, ACTOR_B, 'accepted')
    ).rejects.toThrow(/acceptedBy is required/i);
  });

  test('sets acceptedBy when status is accepted', async () => {
    const updated = await adapter.stampOpportunityActorAction(OPP_ID, ACTOR_B, 'accepted', ACTOR_B);
    expect(updated!.status).toBe('accepted');
    const b = updated!.actors.find(a => a.userId === ACTOR_B)!;
    expect(typeof b.actedAt).toBe('string');
    // Confirm acceptedBy column is also set (read raw row to verify column, not just JSONB)
    const [raw] = await db.select().from(opportunities).where(eq(opportunities.id, OPP_ID));
    expect(raw.acceptedBy).toBe(ACTOR_B);
  });
});
