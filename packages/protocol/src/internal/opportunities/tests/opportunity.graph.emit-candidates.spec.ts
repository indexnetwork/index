import { describe, expect, it } from 'bun:test';
import { emitCandidatesNode } from '../opportunity.graph.emit-candidates.js';
import { pairKeyOf } from '../opportunity.candidates.js';

const baseState = {
  userId: 'alice',
  networkId: 'net-1',
  triggerIntentId: 'intent-a',
  resolvedTriggerIntentId: 'intent-a',
  evaluatedOpportunities: [{
    actors: [
      { userId: 'alice', networkId: 'net-1', role: 'peer', intentId: 'intent-a' },
      { userId: 'bob', networkId: 'net-1', role: 'peer', intentId: 'intent-b' },
    ],
    score: 74,
    reasoning: 'Both are building agent infrastructure.',
    evidence: [],
  }],
} as never;

const depsThat = (upsert: (items: never[]) => Promise<unknown>) => ({
  database: {
    upsertDiscoveryMatchCandidates: upsert,
    createOpportunity: () => { throw new Error('discovery must not create opportunities'); },
  },
}) as never;

describe('emitCandidatesNode', () => {
  it('writes candidates and never creates an opportunity', async () => {
    const upserted: unknown[][] = [];
    await emitCandidatesNode(baseState, depsThat(async (items) => { upserted.push(items); return items; }));
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toHaveLength(1);
  });

  it('keys the candidate by the order-independent pair key', async () => {
    let seen: { pairKey: string } | undefined;
    await emitCandidatesNode(baseState, depsThat(async (items) => { seen = items[0]; return items; }));
    expect(seen!.pairKey).toBe(pairKeyOf('net-1', 'intent-a', 'intent-b'));
  });

  it('records both seats so either side can be woken', async () => {
    let seen: Record<string, unknown> | undefined;
    await emitCandidatesNode(baseState, depsThat(async (items) => { seen = items[0]; return items; }));
    expect(seen).toMatchObject({
      intentA: 'intent-a', userA: 'alice',
      intentB: 'intent-b', userB: 'bob',
      networkId: 'net-1', score: 74,
    });
  });

  it('emits nothing when the evaluator returned nothing', async () => {
    let called = false;
    await emitCandidatesNode(
      { ...(baseState as object), evaluatedOpportunities: [] } as never,
      depsThat(async (items) => { called = true; return items; }),
    );
    expect(called).toBe(false);
  });

  it('drops a match that has no second seated intent', async () => {
    let called = false;
    const oneSeat = {
      ...(baseState as object),
      evaluatedOpportunities: [{
        actors: [
          { userId: 'alice', networkId: 'net-1', role: 'peer', intentId: 'intent-a' },
          { userId: 'bob', networkId: 'net-1', role: 'peer' },
        ],
        score: 60, reasoning: 'r', evidence: [],
      }],
    } as never;
    await emitCandidatesNode(oneSeat, depsThat(async (items) => { called = true; return items; }));
    expect(called).toBe(false);
  });
});
