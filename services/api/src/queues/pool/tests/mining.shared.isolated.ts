import { afterEach, describe, expect, it, mock } from 'bun:test';

import type { QuestionPoolSnapshot } from '@indexnetwork/protocol';

import { isPoolMiningActivated, selectPoolForMining, shouldMineCurrentPool } from '../mining.shared';

function snapshot(fingerprint = 'fingerprint-v1', ids = ['1', '2', '3', '4', '5', '6', '7']): QuestionPoolSnapshot {
  return {
    poolSize: ids.length,
    opportunityIds: ids,
    minedAt: '2026-07-20T00:00:00.000Z',
    intentFingerprint: fingerprint,
    discriminator: {
      label: 'Role',
      questionSeed: 'Which role?',
      sides: ['Builder', 'Advisor'],
      sideCounts: { Builder: ids.length, Advisor: 0 },
      voi: 0.8,
      evidenceRate: 1,
      assignments: ids.map((opportunityId) => ({ opportunityId, side: 'Builder' })),
    },
    alternates: [],
  };
}

describe('pool discriminator mining scope', () => {
  afterEach(() => {
    delete process.env.POOL_QUESTIONS_MINING;
    delete process.env.POOL_QUESTIONS_MODE;
  });

  it('uses the exact-trigger pool selector for intent-scoped mining', async () => {
    const exactPool = mock(async () => []);
    const broadRadar = mock(async () => []);

    await selectPoolForMining('owner-1', 'intent-1', undefined, {
      getLivePoolOpportunitiesForIntent: exactPool,
      getOpportunitiesForUser: broadRadar,
    });

    expect(exactPool).toHaveBeenCalledWith('owner-1', 'intent-1');
    expect(broadRadar).not.toHaveBeenCalled();
  });

  it.each([
    ['off', 'off', false],
    ['shadow', 'off', true],
    ['off', 'on', true],
    ['shadow', 'on', true],
  ] as const)('keeps mining and lifecycle flags independent (%s/%s)', (mining, mode, expected) => {
    process.env.POOL_QUESTIONS_MINING = mining;
    process.env.POOL_QUESTIONS_MODE = mode;
    expect(isPoolMiningActivated()).toBe(expected);
  });

  it('skips a second unchanged pass before downstream embedder, miner, or enqueue work', async () => {
    const reconcile = mock(async () => [] as string[]);
    const latest = mock(async () => snapshot());
    const embed = mock(async () => {});
    const mine = mock(async () => {});
    const enqueue = mock(async () => {});

    const shouldMine = await shouldMineCurrentPool({
      userId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: 'fingerprint-v1',
      currentPoolIds: ['1', '2', '3', '4', '5', '6', '7'],
    }, {
      reconcilePendingPoolQuestions: reconcile,
      getLatestPoolQuestionSnapshot: latest,
    });
    if (shouldMine) {
      await embed();
      await mine();
      await enqueue();
    }

    expect(shouldMine).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(embed).not.toHaveBeenCalled();
    expect(mine).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['below 0.7 pool overlap', snapshot('fingerprint-v1', ['1', '2', '3', '4', '5', '6']), []],
    ['changed fingerprint', snapshot('fingerprint-v0'), []],
    ['latest voided during reconciliation', snapshot(), ['question-1']],
  ] as const)('mines when state changed: %s', async (_name, latestSnapshot, voided) => {
    const shouldMine = await shouldMineCurrentPool({
      userId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: 'fingerprint-v1',
      currentPoolIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    }, {
      reconcilePendingPoolQuestions: async () => [...voided],
      getLatestPoolQuestionSnapshot: async () => latestSnapshot,
    });
    expect(shouldMine).toBe(true);
  });

  it('accepts the exact 0.7 cadence boundary', async () => {
    expect(await shouldMineCurrentPool({
      userId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: 'fingerprint-v1',
      currentPoolIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    }, {
      reconcilePendingPoolQuestions: async () => [],
      getLatestPoolQuestionSnapshot: async () => snapshot(),
    })).toBe(false);
  });
});
