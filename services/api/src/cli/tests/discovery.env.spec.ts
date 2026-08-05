import { describe, expect, it } from 'bun:test';

import { withDiscoveryEnvironment, withMatrixEnvironment } from '../discovery-env-matrix.runtime';

describe('withDiscoveryEnvironment', () => {
  it('applies every configured key for the duration of the run', async () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    process.env.DISCOVERY_SOURCE_PREMISE_LIMIT = '40';
    const seen = await withDiscoveryEnvironment(
      { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
      async () => ({
        allowed: process.env.DISCOVERY_ALLOWED_TYPES,
        limit: process.env.DISCOVERY_SOURCE_PREMISE_LIMIT,
      }),
    );
    expect(seen).toEqual({ allowed: 'intent', limit: '5' });
  });

  it('deletes keys that were unset before, rather than leaving them behind', async () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    await withDiscoveryEnvironment({ DISCOVERY_ALLOWED_TYPES: 'intent' }, async () => undefined);
    expect('DISCOVERY_ALLOWED_TYPES' in process.env).toBe(false);
  });

  it('restores the previous value of keys that were set before', async () => {
    process.env.DISCOVERY_SOURCE_PREMISE_LIMIT = '40';
    await withDiscoveryEnvironment({ DISCOVERY_SOURCE_PREMISE_LIMIT: '5' }, async () => undefined);
    expect(process.env.DISCOVERY_SOURCE_PREMISE_LIMIT).toBe('40');
    delete process.env.DISCOVERY_SOURCE_PREMISE_LIMIT;
  });

  it('restores even when the run throws', async () => {
    process.env.DISCOVERY_SOURCE_PREMISE_LIMIT = '40';
    await expect(withDiscoveryEnvironment(
      { DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
      async () => { throw new Error('graph failed'); },
    )).rejects.toThrow('graph failed');
    expect(process.env.DISCOVERY_SOURCE_PREMISE_LIMIT).toBe('40');
    delete process.env.DISCOVERY_SOURCE_PREMISE_LIMIT;
  });

  it('refuses a key the graph cannot reach', async () => {
    await expect(withDiscoveryEnvironment(
      { POOL_QUESTIONS_MODE: 'on' }, async () => undefined,
    )).rejects.toThrow(/POOL_QUESTIONS_MODE/);
  });
});

describe('withMatrixEnvironment', () => {
  it('still applies the two matrix keys unchanged', async () => {
    const seen = await withMatrixEnvironment(
      { id: 'intent-only', allowedTypes: 'intent', profileSource: 'premise' },
      async () => ({
        allowed: process.env.DISCOVERY_ALLOWED_TYPES,
        source: process.env.DISCOVERY_PROFILE_SOURCE,
      }),
    );
    expect(seen).toEqual({ allowed: 'intent', source: 'premise' });
  });
});
