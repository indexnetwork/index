import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';

import { UserContextGenerator, HydeGraphFactory, SignalIntakePackGenerator } from '@indexnetwork/protocol';

import { UserContextQueue, computePremiseHash } from '../usercontext.queue';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { signalIntakePackAdapter } from '../../adapters/signal-intake-pack.database.adapter';

// The pack refresh is gated on FAST_SIGNAL_INTAKE (it costs a real LLM call per
// stale user), so every test that exercises it has to turn the flag on. This
// file mutates process.env and therefore runs isolated.
const originalFlag = process.env.FAST_SIGNAL_INTAKE;
beforeAll(() => { process.env.FAST_SIGNAL_INTAKE = 'true'; });
afterAll(() => {
  if (originalFlag === undefined) delete process.env.FAST_SIGNAL_INTAKE;
  else process.env.FAST_SIGNAL_INTAKE = originalFlag;
});

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

  // The whole feature ships dark, so the background refresh must not spend LLM
  // budget on every premise change until the flag is flipped. With the flag off
  // this job has to be byte-for-byte its pre-feature self.
  it('does not touch the pack at all while the flag is off', async () => {
    const previous = process.env.FAST_SIGNAL_INTAKE;
    process.env.FAST_SIGNAL_INTAKE = 'false';
    try {
      const getExistingIntakePack = mock(async () => null);
      const regenerateIntakePack = mock(async () => undefined);
      const queue = new UserContextQueue(baseDeps({
        getExistingIntakePack,
        regenerateIntakePack,
      }) as never);

      await queue.processJob('regenerate_contexts', { userId: 'user-1' });

      expect(getExistingIntakePack).not.toHaveBeenCalled();
      expect(regenerateIntakePack).not.toHaveBeenCalled();
    } finally {
      process.env.FAST_SIGNAL_INTAKE = previous as string;
    }
  });
});

describe('UserContextQueue per-network getNetwork failure isolation', () => {
  // Regression test: `getNetwork` is now resolved unconditionally per network (to
  // collect titles for the intake pack), outside `regenerateOne`'s try/catch. A
  // throwing `getNetwork` must not abort the rest of the loop or skip the
  // intake-pack refresh that runs after it — but it must still count toward
  // `failures` so the job throws at the end and BullMQ retries that network's
  // stale context row, exactly like a failure inside `regenerateOne` always has.
  it('isolates a getNetwork failure to that network, still processes the rest, and still fails the job so BullMQ retries', async () => {
    const regenerateIntakePack = mock(async () => undefined);
    const generateContext = mock(async (input: { networkTitle: string }) => ({ text: `ctx-${input.networkTitle}`, embedding: [] }));
    const getNetwork = mock(async (networkId: string) => {
      if (networkId === 'netA') throw new Error('network lookup down');
      return { title: networkId, prompt: null };
    });

    const queue = new UserContextQueue(baseDeps({
      getUserNetworkIds: async () => ['netA', 'netB'],
      getNetwork,
      generateContext,
      getExistingIntakePack: async () => null,
      regenerateIntakePack,
    }) as never);

    // Pins the retry semantics: a getNetwork failure must still fail the job so
    // BullMQ retries netA's stale row on the next attempt — it must not be silently
    // swallowed (which would leave netA permanently stale until the user's next
    // premise change).
    await expect(queue.processJob('regenerate_contexts', { userId: 'user-1' })).rejects.toThrow(/regeneration failed/);

    // netA's lookup failure didn't abort the loop — netB still regenerated.
    expect(generateContext).toHaveBeenCalledTimes(1);
    expect(generateContext).toHaveBeenCalledWith(expect.objectContaining({ networkTitle: 'netB' }));

    // ...and the intake-pack refresh (which runs after the per-network loop) still ran.
    expect(regenerateIntakePack).toHaveBeenCalledTimes(1);
    const [, , input] = regenerateIntakePack.mock.calls[0] as [string, string, { networkTitles: string[] }];
    // netA's title is omitted since its lookup failed; netB's is present.
    expect(input.networkTitles).toEqual(['netB']);
  });
});

describe('UserContextQueue intake pack global context fallback', () => {
  afterEach(() => {
    mock.restore();
  });

  // Regression test: when the global context row is already fresh this run (so
  // `generateGlobalContext` never runs and `globalContextText` stays null), the
  // pack must fall back to the stored row's text instead of passing `null` — this
  // is the realistic rollout path (existing user, fresh global context, no pack
  // row yet).
  it('falls back to the stored global context text when the global row is fresh and the pack needs regeneration', async () => {
    const premises = [
      { id: 'p1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), assertion: { text: 'Ada builds tools.' } },
    ];
    const matchingHash = computePremiseHash(premises);

    const getUserContextSpy = spyOn(chatDatabaseAdapter, 'getUserContext').mockResolvedValue({
      text: 'Stored global context text.',
    } as never);

    const generateGlobalContext = mock(async () => ({ text: 'freshly-generated', embedding: [] }));
    const regenerateIntakePack = mock(async () => undefined);

    const queue = new UserContextQueue(baseDeps({
      getActivePremises: async () => premises,
      // Global row (networkId null) already matches the computed hash — skipped as
      // fresh, so `generateGlobalContext` must never run.
      getExistingContext: async (_userId: string, networkId: string | null) =>
        networkId === null ? { premiseHash: matchingHash } : null,
      generateGlobalContext,
      getExistingIntakePack: async () => null,
      regenerateIntakePack,
    }) as never);

    await queue.processJob('regenerate_contexts', { userId: 'user-1' });

    expect(generateGlobalContext).not.toHaveBeenCalled();
    expect(getUserContextSpy).toHaveBeenCalledWith('user-1', null);

    expect(regenerateIntakePack).toHaveBeenCalledTimes(1);
    const [, , input] = regenerateIntakePack.mock.calls[0] as [string, string, { globalContext: string | null }];
    expect(input.globalContext).toBe('Stored global context text.');
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
