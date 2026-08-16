import { describe, expect, test } from 'bun:test';
import type { Id, Opportunity, OpportunityActor } from '../../shared/interfaces/database.interface.js';
import { admitOpportunityPersistence, createEligibleOpportunityStatusUpdater, type OpportunityPersistenceAdmissionPort } from '../application/opportunity.persistence-admission.js';

describe('opportunity persistence admission', () => {
  test('intersects current owner membership, trigger assignment, explicit scope, and active actor pairs', async () => {
    const database = {
      getNetworkMemberships: async () => [
        { networkId: 'idx-allowed' as Id<'networks'> },
        { networkId: 'idx-outside-trigger' as Id<'networks'> },
      ],
      getNetworkIdsForIntent: async () => ['idx-allowed' as Id<'networks'>],
      getActiveNetworkMembershipPairs: async (pairs: Array<{ userId: string; networkId: string }>) =>
        pairs.filter((pair) => pair.userId !== 'inactive-user'),
    } as unknown as OpportunityPersistenceAdmissionPort;

    const result = await admitOpportunityPersistence(database, {
      ownerUserId: 'owner' as Id<'users'>,
      triggerIntentId: 'intent-owner' as Id<'intents'>,
      indexScope: ['idx-allowed' as Id<'networks'>, 'idx-outside-trigger' as Id<'networks'>],
      evaluatedOpportunities: [
        { actors: [{ userId: 'owner' as Id<'users'>, networkId: 'idx-allowed' as Id<'networks'> }, { userId: 'candidate' as Id<'users'>, networkId: 'idx-allowed' as Id<'networks'> }] },
        { actors: [{ userId: 'owner' as Id<'users'>, networkId: 'idx-allowed' as Id<'networks'> }, { userId: 'inactive-user' as Id<'users'>, networkId: 'idx-allowed' as Id<'networks'> }] },
      ],
    });

    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') return;
    expect(result.allowedNetworkIds).toEqual(['idx-allowed']);
    expect(result.evaluatedOpportunities).toHaveLength(1);
    expect(result.evaluatedOpportunities[0]?.actors[1]?.userId).toBe('candidate');
  });

  test('reactivates through existing non-introducer anchors and the eligibility lock only', async () => {
    const calls: unknown[][] = [];
    const database = {
      updateOpportunityStatusIfNetworkEligible: async (...args: unknown[]) => {
        calls.push(args);
        return { id: 'opp-1', status: 'pending' } as Opportunity;
      },
    } as unknown as OpportunityPersistenceAdmissionPort;
    const update = createEligibleOpportunityStatusUpdater(
      database,
      ['idx-allowed' as Id<'networks'>],
      { ownerUserId: 'owner' as Id<'users'>, allowedNetworkIds: ['idx-allowed' as Id<'networks'>] },
    );
    const actors: OpportunityActor[] = [
      { userId: 'owner' as Id<'users'>, networkId: 'idx-allowed' as Id<'networks'>, role: 'patient' },
      { userId: 'candidate' as Id<'users'>, networkId: 'idx-allowed' as Id<'networks'>, role: 'agent' },
      { userId: 'introducer' as Id<'users'>, networkId: 'idx-outside-scope' as Id<'networks'>, role: 'introducer' },
    ];

    const result = await update('opp-1', 'pending', actors, 'expired');

    expect(result?.status).toBe('pending');
    expect(calls).toHaveLength(1);
    expect((calls[0]?.[2] as OpportunityActor[]).map((actor) => actor.userId)).toEqual(['owner', 'candidate']);
  });
});
