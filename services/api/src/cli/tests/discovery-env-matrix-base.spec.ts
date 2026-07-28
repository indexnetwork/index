import { describe, expect, it } from 'bun:test';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import { BASE_FIXTURE_CORPUS_VERSION, assertBaseEnvironment, baseSeedPayload, computeFixtureFingerprint, verifyBaseContract } from '../discovery-env-matrix.shared';

const SAFE_ENV: NodeJS.ProcessEnv = {
  DISCOVERY_ENV_MATRIX_BASE_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  DATABASE_URL: 'postgres://x@ep-x.neon.tech/protocol_eval',
  DISCOVERY_ENV_MATRIX_BASE_BRANCH: 'eval-discovery-base',
};

describe('discovery environment matrix base policy', () => {
  it('refuses a non-evaluation database or unconfirmed base refresh', () => {
    expect(() => assertBaseEnvironment({})).toThrow('DISCOVERY_ENV_MATRIX_BASE_CONFIRM=1');
    expect(() => assertBaseEnvironment({
      DISCOVERY_ENV_MATRIX_BASE_CONFIRM: '1', TEST_DATABASE_SAFE: '1',
      DATABASE_URL: 'postgres://x@ep-x.neon.tech/protocol_prod',
    })).toThrow('protocol_eval');
  });

  it.each([
    [{ ...SAFE_ENV, TEST_DATABASE_SAFE: undefined }, 'TEST_DATABASE_SAFE=1'],
    [{ ...SAFE_ENV, DATABASE_URL: 'postgres://x@localhost/protocol_eval' }, 'non-Neon'],
    [{ ...SAFE_ENV, DISCOVERY_ENV_MATRIX_BASE_BRANCH: 'eval-discovery-child' }, 'eval-discovery-base'],
  ])('refuses unsafe base environment %#', (env, message) => {
    expect(() => assertBaseEnvironment(env)).toThrow(message);
  });

  it('accepts only the explicitly attested protected base', () => {
    expect(assertBaseEnvironment(SAFE_ENV)).toMatchObject({
      declaredBranch: 'eval-discovery-base',
      databaseUrl: expect.objectContaining({ hostname: 'ep-x.neon.tech', pathname: '/protocol_eval' }),
    });
  });

  it('fingerprints only model-safe fixture data, not report names or basis', () => {
    expect(computeFixtureFingerprint(HISTORICAL_MATRIX_CASES)).toMatch(/^[a-f0-9]{64}$/);
    expect(baseSeedPayload(HISTORICAL_MATRIX_CASES)).not.toHaveProperty('reportNames');
    expect(JSON.stringify(baseSeedPayload(HISTORICAL_MATRIX_CASES))).not.toContain('basis');
  });

  it('uses deterministic, fixture-scoped IDs and a corpus-versioned fingerprint', () => {
    const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);

    expect(payload.fixtureCorpusVersion).toBe(BASE_FIXTURE_CORPUS_VERSION);
    expect(payload.users.every((user) => user.id.startsWith('eval-discovery-matrix-user-'))).toBe(true);
    expect(payload.networks.every((network) => network.id.startsWith('eval-discovery-matrix-network-'))).toBe(true);
    expect(payload.intents.every((intent) => intent.id.startsWith('eval-discovery-matrix-intent-'))).toBe(true);
    expect(computeFixtureFingerprint(HISTORICAL_MATRIX_CASES)).toBe(computeFixtureFingerprint(HISTORICAL_MATRIX_CASES));
  });

  it('rejects missing or mismatched base metadata before a child run', () => {
    const expected = {
      schemaMigrationFingerprint: 'schema-fingerprint',
      fixtureFingerprint: computeFixtureFingerprint(HISTORICAL_MATRIX_CASES),
      fixtureCorpusVersion: BASE_FIXTURE_CORPUS_VERSION,
    };

    expect(() => verifyBaseContract(null, expected)).toThrow('metadata is missing');
    expect(() => verifyBaseContract({ ...expected, schemaMigrationFingerprint: 'stale' }, expected)).toThrow('schema migration fingerprint mismatch');
    expect(() => verifyBaseContract({ ...expected, fixtureFingerprint: 'stale' }, expected)).toThrow('fixture fingerprint mismatch');
    expect(() => verifyBaseContract({ ...expected, fixtureCorpusVersion: 'old' }, expected)).toThrow('fixture corpus version mismatch');
    expect(() => verifyBaseContract(expected, expected)).not.toThrow();
  });
});
