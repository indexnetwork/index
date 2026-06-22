import { describe, expect, it, mock } from 'bun:test';

import { ensureGlobalUserContext, type EnsureGlobalUserContextDeps } from '../global-context';
import { computePremiseHash, type ContextPremise } from '../premise-hash';

const premise = (id: string, text: string): ContextPremise => ({
  id,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  assertion: { text },
});

/** Build deps with sensible defaults; override per test. Tracks upsert calls. */
function makeDeps(overrides: Partial<EnsureGlobalUserContextDeps> = {}) {
  const upsert = mock(async () => ({ id: 'ctx-1' }));
  const generate = mock(async () => ({ text: 'GENERATED CONTEXT', embedding: [0.1, 0.2] }));
  const deps: EnsureGlobalUserContextDeps = {
    getExistingContext: async () => null,
    getActivePremises: async () => [premise('p1', 'I build agent tooling')],
    generateGlobalContext: generate,
    upsertUserContext: upsert,
    ...overrides,
  };
  return { deps, upsert, generate };
}

describe('ensureGlobalUserContext', () => {
  it('returns the stored global row text without generating when one exists', async () => {
    const { deps, upsert, generate } = makeDeps({
      getExistingContext: async () => ({ text: 'STORED CONTEXT' }),
    });
    const result = await ensureGlobalUserContext('user-1', deps);
    expect(result).toBe('STORED CONTEXT');
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('generates, persists, and returns the context when no row exists but premises do', async () => {
    const premises = [premise('p1', 'I build agent tooling'), premise('p2', 'I live in Berlin')];
    const { deps, upsert, generate } = makeDeps({
      getExistingContext: async () => null,
      getActivePremises: async () => premises,
    });
    const result = await ensureGlobalUserContext('user-1', deps);
    expect(result).toBe('GENERATED CONTEXT');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toEqual({
      premises: [{ text: 'I build agent tooling' }, { text: 'I live in Berlin' }],
    });
    // Upserts the global row (networkId null) keyed by the premise staleness hash.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toEqual({
      userId: 'user-1',
      networkId: null,
      text: 'GENERATED CONTEXT',
      embedding: [0.1, 0.2],
      premiseHash: computePremiseHash(premises),
    });
  });

  it('returns empty string and does not generate when the user has no premises', async () => {
    const { deps, upsert, generate } = makeDeps({
      getExistingContext: async () => null,
      getActivePremises: async () => [],
    });
    const result = await ensureGlobalUserContext('user-1', deps);
    expect(result).toBe('');
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('treats premises with empty assertion text as no usable premises', async () => {
    const { deps, generate } = makeDeps({
      getActivePremises: async () => [premise('p1', ''), premise('p2', '')],
    });
    const result = await ensureGlobalUserContext('user-1', deps);
    expect(result).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });

  it('swallows generation errors and returns empty string (best-effort)', async () => {
    const { deps } = makeDeps({
      generateGlobalContext: async () => {
        throw new Error('LLM unavailable');
      },
    });
    const result = await ensureGlobalUserContext('user-1', deps);
    expect(result).toBe('');
  });

  it('swallows read errors and returns empty string', async () => {
    const { deps } = makeDeps({
      getExistingContext: async () => {
        throw new Error('DB down');
      },
    });
    const result = await ensureGlobalUserContext('user-1', deps);
    expect(result).toBe('');
  });
});
