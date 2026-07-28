import { describe, expect, it } from 'bun:test';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import type { DrizzleDB } from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

import { seedProtectedBase, verifyProtectedBase } from '../discovery-env-matrix-base';
import { BASE_FIXTURE_CORPUS_VERSION, assertBaseEnvironment, baseSeedPayload, computeFixtureFingerprint, type BaseMetadata, verifyBaseContract } from '../discovery-env-matrix.shared';

const SAFE_ENV: NodeJS.ProcessEnv = {
  DISCOVERY_ENV_MATRIX_BASE_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  DATABASE_URL: 'postgres://x@ep-x.neon.tech/protocol_eval',
  DISCOVERY_ENV_MATRIX_BASE_BRANCH: 'eval-discovery-base',
};

interface MockBaseDatabaseState {
  calls: string[];
  metadata: BaseMetadata | null;
  selectResults: Array<Array<{ id: string }>>;
  upserts: string[];
}

function isBaseMetadata(value: unknown): value is BaseMetadata {
  return !!value && typeof value === 'object'
    && 'schemaMigrationFingerprint' in value
    && 'fixtureFingerprint' in value
    && 'fixtureCorpusVersion' in value;
}

function mockBaseDatabase(selectResults: Array<Array<{ id: string }>> = []): {
  db: DrizzleDB;
  state: MockBaseDatabaseState;
} {
  const state: MockBaseDatabaseState = { calls: [], metadata: null, selectResults, upserts: [] };
  const tableLabel = (table: unknown): string => {
    if (table === schema.evalMatrixMetadata) return 'evalMatrixMetadata';
    if (table === schema.users) return 'users';
    if (table === schema.networks) return 'networks';
    return 'fixture';
  };
  const select = (fields: unknown) => {
    const isMetadataRead = !!fields && typeof fields === 'object' && 'schemaMigrationFingerprint' in fields;
    return {
      from() {
        return {
          where() {
            return {
              limit: () => ({
                then(resolve: (rows: Array<{ id: string }> | BaseMetadata[]) => void) {
                  state.calls.push('select');
                  resolve(isMetadataRead
                    ? (state.metadata ? [state.metadata] : [])
                    : (state.selectResults.shift() ?? []));
                },
              }),
            };
          },
        };
      },
    };
  };
  const tx = {
    select,
    delete(table: unknown) {
      return {
        where: async () => {
          state.calls.push(`delete:${tableLabel(table)}`);
        },
      };
    },
    insert(table: unknown) {
      const label = tableLabel(table);
      return {
        values(value: unknown) {
          if (label === 'evalMatrixMetadata' && isBaseMetadata(value)) state.metadata = value;
          return {
            onConflictDoUpdate: async () => {
              state.upserts.push(label);
            },
          };
        },
      };
    },
  };
  return {
    db: {
      select,
      transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    } as unknown as DrizzleDB,
    state,
  };
}

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

describe('protected base transaction', () => {
  const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);
  const metadata: BaseMetadata = {
    schemaMigrationFingerprint: 'schema-fingerprint',
    fixtureFingerprint: computeFixtureFingerprint(HISTORICAL_MATRIX_CASES),
    fixtureCorpusVersion: BASE_FIXTURE_CORPUS_VERSION,
  };

  it('rejects an unexpected dependent before any fixture deletion', async () => {
    const { db, state } = mockBaseDatabase([
      [],
      [{ id: 'outside-fixture-premise' }],
    ]);

    await expect(seedProtectedBase(db, schema, payload, metadata)).rejects.toThrow(
      'unexpected premise outside-fixture-premise',
    );

    expect(state.calls).toEqual(['select', 'select']);
    expect(state.upserts).toEqual([]);
    expect(state.metadata).toBeNull();
  });

  it('persists and verifies the durable metadata only after dependent checks pass', async () => {
    const { db, state } = mockBaseDatabase(Array.from({ length: 7 }, () => []));

    await seedProtectedBase(db, schema, payload, metadata);

    expect(state.calls.slice(0, 7)).toEqual(Array.from({ length: 7 }, () => 'select'));
    expect(state.upserts).toContain('evalMatrixMetadata');
    expect(state.metadata).toMatchObject(metadata);
    await expect(verifyProtectedBase(db, schema, metadata)).resolves.toBeUndefined();

    state.metadata = { ...metadata, fixtureFingerprint: 'stale' };
    await expect(verifyProtectedBase(db, schema, metadata)).rejects.toThrow('fixture fingerprint mismatch');
  });
});
