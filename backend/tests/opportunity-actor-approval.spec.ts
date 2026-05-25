import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { OpportunityDatabaseAdapter } from '../src/adapters/database.adapter';
import type { Id } from '../src/types/common.types';

// Fake UUIDs (v4 format) for FK-shaped columns; the JSONB actors column does not enforce FKs,
// so the referenced users/networks don't need to exist for this test.
const NETWORK_ID = '00000000-0000-4000-8000-000000000001' as Id<'networks'>;
const TARGET_USER_ID = '00000000-0000-4000-8000-000000000002' as Id<'users'>;
const CANDIDATE_USER_ID = '00000000-0000-4000-8000-000000000003' as Id<'users'>;
const INTRODUCER_USER_ID = '00000000-0000-4000-8000-000000000004' as Id<'users'>;
const INTRODUCER_USER_ID_A = '00000000-0000-4000-8000-000000000005' as Id<'users'>;
const INTRODUCER_USER_ID_B = '00000000-0000-4000-8000-000000000006' as Id<'users'>;

describe('updateOpportunityActorApproval', () => {
  const db = new OpportunityDatabaseAdapter();
  const createdOpportunityIds: string[] = [];

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      try {
        await db.updateOpportunityStatus(id, 'expired');
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  it('sets approved=true on the introducer actor without changing status', async () => {
    const opp = await db.createOpportunity({
      detection: { source: 'manual', createdBy: 'test', timestamp: new Date().toISOString() },
      actors: [
        { networkId: NETWORK_ID, userId: TARGET_USER_ID, role: 'patient' },
        { networkId: NETWORK_ID, userId: CANDIDATE_USER_ID, role: 'agent' },
        { networkId: NETWORK_ID, userId: INTRODUCER_USER_ID, role: 'introducer', approved: false },
      ],
      interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
      context: { networkId: NETWORK_ID },
      confidence: '0.8',
      status: 'latent',
    });
    createdOpportunityIds.push(opp.id);

    const updated = await db.updateOpportunityActorApproval(opp.id, INTRODUCER_USER_ID, true);

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('latent');
    const introducerActor = updated!.actors.find((a) => a.role === 'introducer');
    expect(introducerActor?.approved).toBe(true);

    const patientActor = updated!.actors.find((a) => a.role === 'patient');
    expect(patientActor?.approved).toBeUndefined();
  }, 30000);

  it('preserves both approvals when two introducers approve concurrently (FOR UPDATE)', async () => {
    const opp = await db.createOpportunity({
      detection: { source: 'manual', createdBy: 'test', timestamp: new Date().toISOString() },
      actors: [
        { networkId: NETWORK_ID, userId: TARGET_USER_ID, role: 'patient' },
        { networkId: NETWORK_ID, userId: CANDIDATE_USER_ID, role: 'agent' },
        { networkId: NETWORK_ID, userId: INTRODUCER_USER_ID_A, role: 'introducer', approved: false },
        { networkId: NETWORK_ID, userId: INTRODUCER_USER_ID_B, role: 'introducer', approved: false },
      ],
      interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
      context: { networkId: NETWORK_ID },
      confidence: '0.8',
      status: 'latent',
    });
    createdOpportunityIds.push(opp.id);

    // Without SELECT ... FOR UPDATE, a naive read-modify-write would lose one of these
    // approvals because both reads would see approved=false for both introducers.
    const [resultA, resultB] = await Promise.all([
      db.updateOpportunityActorApproval(opp.id, INTRODUCER_USER_ID_A, true),
      db.updateOpportunityActorApproval(opp.id, INTRODUCER_USER_ID_B, true),
    ]);

    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();

    // Re-fetch to observe the final persisted state.
    const final = await db.getOpportunity(opp.id);
    expect(final).not.toBeNull();
    const introducerA = final!.actors.find((a) => a.role === 'introducer' && a.userId === INTRODUCER_USER_ID_A);
    const introducerB = final!.actors.find((a) => a.role === 'introducer' && a.userId === INTRODUCER_USER_ID_B);
    expect(introducerA?.approved).toBe(true);
    expect(introducerB?.approved).toBe(true);
  }, 30000);
});
