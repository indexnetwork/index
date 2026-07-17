import { afterEach, describe, expect, it, mock } from 'bun:test';

import type { DiscriminatorMiningInput, MinedDiscriminator } from '@indexnetwork/protocol';

import { mineOutcomeHypotheses, type OutcomeMiningDeps } from '../outcome.mining.shared';
import type { OpportunityOutcomeEvent } from '../../../schemas/database.schema';

function event(
  opportunityId: string,
  action: 'accepted' | 'rejected',
  dedupKey: string,
): OpportunityOutcomeEvent {
  return {
    id: `e-${opportunityId}`,
    recipientUserId: 'owner-1',
    intentId: 'intent-1',
    intentFingerprint: 'fp-1',
    opportunityId,
    networkId: 'net-1',
    action,
    candidateSnapshot: `snapshot ${opportunityId}`,
    snapshotHash: 'h',
    dedupKey,
    idempotencyKey: `idem-${opportunityId}`,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/** Miner that records inputs and splits the pool evenly across two sides. */
function recordingMiner() {
  const seen: DiscriminatorMiningInput[] = [];
  const mine = mock(async (input: DiscriminatorMiningInput): Promise<MinedDiscriminator[]> => {
    seen.push(input);
    const half = Math.floor(input.candidates.length / 2);
    return [{
      label: 'axis',
      questionSeed: 'q',
      sides: ['A', 'B'],
      assignments: input.candidates.map((c, i) => ({
        id: c.id,
        side: i < half ? 'A' : 'B',
        evidence: 'ev',
        verified: true,
      })),
      evidenceRate: 1,
    }];
  });
  return { mine, seen };
}

function deps(events: OpportunityOutcomeEvent[], miner: Pick<OutcomeMiningDeps['miner'], 'mine'>): OutcomeMiningDeps {
  return {
    getEvents: mock(async () => events),
    getIntent: mock(async () => ({ payload: 'build hardware', summary: null })),
    miner,
  };
}

const scope = { recipientUserId: 'owner-1', intentId: 'intent-1', intentFingerprint: 'fp-1' };

afterEach(() => {
  delete process.env.OUTCOME_QUESTIONS_MODE;
});

describe('mineOutcomeHypotheses', () => {
  it('does nothing when OUTCOME_QUESTIONS_MODE is off', async () => {
    const d = deps([], recordingMiner());
    await mineOutcomeHypotheses(scope, d);
    expect((d.getEvents as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('skips the LLM below the independent-example floor (k-anonymity)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    // 8 distinct counterparts < 10 floor.
    const events = Array.from({ length: 8 }, (_, i) =>
      event(`o${i}`, i % 2 ? 'accepted' : 'rejected', `k${i}`));
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(events, miner));
    expect(miner.seen.length).toBe(0);
  });

  it('mines blind to outcome above the floor (candidates carry no label)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const events = [
      ...Array.from({ length: 6 }, (_, i) => event(`a${i}`, 'accepted', `ka${i}`)),
      ...Array.from({ length: 6 }, (_, i) => event(`b${i}`, 'rejected', `kb${i}`)),
    ];
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(events, miner));

    expect(miner.seen.length).toBe(1);
    for (const c of miner.seen[0].candidates) {
      expect(Object.keys(c).sort()).toEqual(['id', 'publicContext', 'score']);
      expect(JSON.stringify(c)).not.toContain('accepted');
      expect(JSON.stringify(c)).not.toContain('rejected');
    }
  });

  it('never throws even if mining fails (fire-and-forget discipline)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const events = Array.from({ length: 12 }, (_, i) =>
      event(`o${i}`, i % 2 ? 'accepted' : 'rejected', `k${i}`));
    const failing = { mine: mock(async () => { throw new Error('llm down'); }) };
    await expect(mineOutcomeHypotheses(scope, deps(events, failing))).resolves.toBeUndefined();
  });
});
