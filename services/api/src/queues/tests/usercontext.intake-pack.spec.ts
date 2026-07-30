import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { UserContextGenerator, HydeGraphFactory, SignalIntakePackGenerator } from '@indexnetwork/protocol';

import { UserContextQueue } from '../usercontext.queue';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { signalIntakePackAdapter } from '../../adapters/signal-intake-pack.database.adapter';

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

describe('UserContextQueue intake pack production wiring', () => {
  afterEach(() => {
    mock.restore();
  });

  // Regression test for the gap where `UserContextQueueDeps.getExistingIntakePack` /
  // `regenerateIntakePack` were optional-only and never resolved to a real
  // implementation, making the background pack refresh a permanent no-op in
  // production. Stubs sit at the adapter/generator boundary (real singleton
  // methods, not injected fakes), and the queue is constructed with NO deps, so
  // this only passes if `handleRegenerate` actually falls back to
  // `defaultGetExistingIntakePack` / `defaultRegenerateIntakePack`.
  it('reaches the real generator and pack adapter when no deps are injected', async () => {
    const premise = {
      id: 'p1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      assertion: { text: 'Ada builds tools.' },
    };

    spyOn(chatDatabaseAdapter, 'getPremisesForUser').mockResolvedValue([premise] as never);
    spyOn(chatDatabaseAdapter, 'getNonPersonalNetworkIds').mockResolvedValue([]);
    spyOn(chatDatabaseAdapter, 'getUserContext').mockResolvedValue(null as never);
    spyOn(chatDatabaseAdapter, 'upsertUserContext').mockResolvedValue({ id: 'ctx-1' } as never);
    spyOn(UserContextGenerator.prototype, 'generateGlobalColdStart').mockResolvedValue({
      text: 'Global context text.',
      embedding: [0.1],
    });
    spyOn(HydeGraphFactory.prototype, 'createGraph').mockReturnValue({ invoke: async () => undefined } as never);
    spyOn(signalIntakePackAdapter, 'getPack').mockResolvedValue(null);
    const upsertPackSpy = spyOn(signalIntakePackAdapter, 'upsertPack').mockResolvedValue(undefined);
    const generateSpy = spyOn(SignalIntakePackGenerator.prototype, 'generate').mockResolvedValue({
      brief: 'A concise brief about Ada.',
      question: {
        title: 'Who do you want to meet?',
        prompt: 'Pick the people you most want to be introduced to right now.',
        options: [
          { label: 'Design partner', description: 'Someone to co-design the product.' },
          { label: 'Technical co-founder', description: 'Someone to build the backend.' },
        ],
        multiSelect: false,
      },
    });

    const queue = new UserContextQueue(); // No deps at all — exercises the real production wiring.
    await queue.processJob('regenerate_contexts', { userId: 'user-1', reason: 'profile_regen' });

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const [input] = generateSpy.mock.calls[0] as [{ premises: unknown; networkTitles: unknown; globalContext: unknown }];
    expect(input).toEqual({
      premises: [{ text: 'Ada builds tools.' }],
      networkTitles: [],
      globalContext: 'Global context text.',
    });

    expect(upsertPackSpy).toHaveBeenCalledTimes(1);
    const [upsertInput] = upsertPackSpy.mock.calls[0] as [{ userId: string; brief: string; premiseHash: string }];
    expect(upsertInput.userId).toBe('user-1');
    expect(upsertInput.brief).toBe('A concise brief about Ada.');
    expect(upsertInput.premiseHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
