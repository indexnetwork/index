import { describe, expect, it, mock } from 'bun:test';

import { UserContextQueue } from '../usercontext.queue';

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    getUserNetworkIds: async () => [],
    getActivePremises: async () => [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'Ada builds tools.' } },
    ],
    getExistingContext: async () => ({ premiseHash: 'stale' }),
    getNetwork: async () => null,
    generateContext: async () => ({ text: 't', embedding: [] }),
    generateGlobalContext: async () => ({ text: 'g', embedding: [] }),
    upsertUserContext: async () => ({ id: 'ctx-1' }),
    generateContextHyde: async () => undefined,
    ...overrides,
  };
}

describe('UserContextQueue intake pack regeneration', () => {
  it('regenerates the pack with the same premise hash used for contexts', async () => {
    const regenerateIntakePack = mock(async () => undefined);
    const queue = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => null,
      regenerateIntakePack,
    }) as never);

    await queue.processJob('regenerate_contexts', { userId: 'user-1' });

    expect(regenerateIntakePack).toHaveBeenCalledTimes(1);
    const [userId, hash] = regenerateIntakePack.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('skips regeneration when the stored pack hash is unchanged', async () => {
    const regenerateIntakePack = mock(async () => undefined);
    let observedHash = '';
    const queue = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => ({ premiseHash: observedHash }),
      regenerateIntakePack,
    }) as never);

    // First run learns the hash, second run must short-circuit.
    const learner = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => null,
      regenerateIntakePack: async (_u: string, h: string) => { observedHash = h; },
    }) as never);
    await learner.processJob('regenerate_contexts', { userId: 'user-1' });

    await queue.processJob('regenerate_contexts', { userId: 'user-1' });

    expect(regenerateIntakePack).not.toHaveBeenCalled();
  });

  it('does not fail the job when pack regeneration throws', async () => {
    const queue = new UserContextQueue(baseDeps({
      getExistingIntakePack: async () => null,
      regenerateIntakePack: async () => { throw new Error('model down'); },
    }) as never);

    await expect(queue.processJob('regenerate_contexts', { userId: 'user-1' })).resolves.toBeUndefined();
  });
});
