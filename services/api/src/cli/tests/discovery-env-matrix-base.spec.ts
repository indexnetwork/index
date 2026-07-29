import { describe, expect, it, mock } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import type { DrizzleDB } from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

import { HISTORICAL_MATRIX_CASES_PATH, parseBaseArgs, runBaseCommand, runBaseLifecycle, seedProtectedBase, verifyBaseFixtureIntegrity, verifyProtectedBase } from '../discovery-env-matrix-base.main';
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
      insert: tx.insert,
      transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    } as unknown as DrizzleDB,
    state,
  };
}

function mockReadOnlyDatabase(results: unknown[][]) {
  const state = { reads: 0, writes: 0 };
  const select = () => ({
    from: () => ({
      where: () => ({
        then(resolve: (rows: unknown[]) => void) {
          state.reads += 1;
          resolve(results.shift() ?? []);
        },
      }),
    }),
  });
  return { db: { select } as unknown as DrizzleDB, state };
}

function mockCurrentCommandDatabase(payload: ReturnType<typeof baseSeedPayload>, metadata: BaseMetadata) {
  const structuralRows: unknown[][] = [
    payload.users.map((user) => ({ ...user, emailVerified: false, deletedAt: null })),
    payload.networks.map((network) => ({ ...network, deletedAt: null })),
    payload.intents.map((intent) => ({ ...intent, status: 'ACTIVE', sourceType: 'discovery_form', sourceId: intent.userId, embedding: Array(2000).fill(0.1) })),
    payload.intents.map((intent) => ({ intentId: intent.id, networkId: intent.networkId, relevancyScore: '1' })),
    payload.memberships.map((membership) => ({ userId: membership.userId, networkId: membership.networkId, permissions: ['member'], autoAssign: false })),
    [], [],
    payload.intents.map((intent) => ({ sourceId: intent.id, sourceText: intent.payload, sourceType: 'intent', embedding: Array(2000).fill(0.1) })),
    [],
  ];
  const state = { reads: 0, writes: 0, closed: false };
  const select = (fields: unknown) => {
    const metadataRead = !!fields && typeof fields === 'object' && 'schemaMigrationFingerprint' in fields;
    const rows = metadataRead ? [metadata] : structuralRows.shift() ?? [];
    const query = {
      then(resolve: (value: unknown[]) => void) {
        state.reads += 1;
        resolve(rows);
      },
      limit() {
        return query;
      },
    };
    return { from: () => Object.assign(query, { where: () => query }) };
  };
  return {
    db: { select } as unknown as DrizzleDB,
    closeDb: async () => { state.closed = true; },
    state,
  };
}

describe('discovery environment matrix base policy', () => {
  it('loads historical fixture source from the workspace after the protocol build', async () => {
    const expected = path.resolve(
      import.meta.dir,
      '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.ts',
    );

    expect(HISTORICAL_MATRIX_CASES_PATH).toBe(expected);
    expect(HISTORICAL_MATRIX_CASES_PATH).not.toContain('/services/packages/');
    const fixtureModule = await import(HISTORICAL_MATRIX_CASES_PATH) as {
      HISTORICAL_MATRIX_CASES: readonly unknown[];
    };
    expect(fixtureModule.HISTORICAL_MATRIX_CASES).toHaveLength(5);
  });

  it('parses --verify as the read-only lifecycle command', () => {
    expect(parseBaseArgs(['--verify'])).toEqual({ verifyOnly: true });
    expect(parseBaseArgs([])).toEqual({ verifyOnly: false });
    expect(() => parseBaseArgs(['--refresh'])).toThrow('Usage');
  });

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
  const noOpFixtureIntentIndexer = async () => {};
  it('rejects an unexpected dependent before any fixture deletion', async () => {
    const { db, state } = mockBaseDatabase([
      [],
      [{ id: 'outside-fixture-premise' }],
    ]);

    await expect(seedProtectedBase(db, schema, payload, metadata, noOpFixtureIntentIndexer)).rejects.toThrow(
      'unexpected premise outside-fixture-premise',
    );

    expect(state.calls).toEqual(['select', 'select']);
    expect(state.upserts).toEqual([]);
    expect(state.metadata).toBeNull();
  });

  it('rejects a proposal that would be mutated to a null consumed intent', async () => {
    const { db, state } = mockBaseDatabase([
      [], [], [], [], [], [],
      [{ id: 'outside-fixture-proposal' }],
    ]);

    await expect(seedProtectedBase(db, schema, payload, metadata, noOpFixtureIntentIndexer)).rejects.toThrow(
      'unexpected intent proposal outside-fixture-proposal',
    );

    expect(state.calls).toEqual(Array.from({ length: 7 }, () => 'select'));
    expect(state.upserts).toEqual([]);
  });

  it('indexes every fixture intent and rejects any intent left unembedded', async () => {
    const { db, state } = mockBaseDatabase(Array.from({ length: 10 }, () => []));
    const indexedIntentIds: string[] = [];

    await seedProtectedBase(db, schema, payload, metadata, async (intent) => {
      indexedIntentIds.push(intent.id);
    });

    expect(indexedIntentIds).toEqual(payload.intents.map((intent) => intent.id));
    expect(state.calls.slice(0, 9)).toEqual(Array.from({ length: 9 }, () => 'select'));
    expect(state.calls.filter((call) => call === 'select')).toHaveLength(10);
    expect(state.upserts).toContain('evalMatrixMetadata');
  });

  it('refuses metadata persistence when an indexed fixture intent remains unembedded', async () => {
    const { db, state } = mockBaseDatabase([
      ...Array.from({ length: 9 }, () => []),
      [{ id: payload.intents[0]!.id }],
    ]);

    await expect(seedProtectedBase(db, schema, payload, metadata, noOpFixtureIntentIndexer)).rejects.toThrow(
      `fixture intent ${payload.intents[0]!.id} remains unembedded`,
    );

    expect(state.upserts).not.toContain('evalMatrixMetadata');
  });

  it('persists and verifies the durable metadata only after dependent checks pass', async () => {
    const { db, state } = mockBaseDatabase(Array.from({ length: 10 }, () => []));

    await seedProtectedBase(db, schema, payload, metadata, noOpFixtureIntentIndexer);

    expect(state.calls.slice(0, 9)).toEqual(Array.from({ length: 9 }, () => 'select'));
    expect(state.calls.filter((call) => call === 'select')).toHaveLength(10);
    expect(state.upserts).toContain('evalMatrixMetadata');
    expect(state.metadata).toMatchObject(metadata);
    await expect(verifyProtectedBase(db, schema, metadata)).resolves.toBeUndefined();

    state.metadata = { ...metadata, fixtureFingerprint: 'stale' };
    await expect(verifyProtectedBase(db, schema, metadata)).rejects.toThrow('fixture fingerprint mismatch');
  });
});

describe('protected base lifecycle', () => {
  const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);

  function structuralRows(options: { unembeddedIntentId?: string } = {}): unknown[][] {
    return [
      payload.users.map((user) => ({ ...user, emailVerified: false, deletedAt: null })),
      payload.networks.map((network) => ({ ...network, deletedAt: null })),
      payload.intents.map((intent) => ({
        ...intent,
        status: 'ACTIVE', sourceType: 'discovery_form', sourceId: intent.userId,
        embedding: intent.id === options.unembeddedIntentId ? null : [0.1],
      })),
      payload.intents.map((intent) => ({ intentId: intent.id, networkId: intent.networkId, relevancyScore: '1' })),
      payload.memberships.map((membership) => ({ userId: membership.userId, networkId: membership.networkId, permissions: ['member'], autoAssign: false })),
      [],
      [],
      payload.intents.map((intent) => ({ sourceId: intent.id, sourceText: intent.payload, sourceType: 'intent', embedding: Array(2000).fill(0.1) })),
      [],
    ];
  }

  it('fails a structural mutation through read-only fixture checks', async () => {
    const { db, state } = mockReadOnlyDatabase(structuralRows({
      unembeddedIntentId: payload.intents[0]!.id,
    }));

    await expect(verifyBaseFixtureIntegrity(db, schema, payload)).rejects.toThrow('is unembedded');
    expect(state.reads).toBe(8);
    expect(state.writes).toBe(0);
  });

  it('exits already-current without constructing an indexer or writing', async () => {
    const createIndexer = mock(async () => {
      throw new Error('indexer must stay lazy');
    });
    const refresh = mock(async () => {});
    const log = mock(() => {});

    await expect(runBaseLifecycle({ verifyOnly: false }, {
      verifyCurrent: async () => {},
      createIndexer,
      refresh,
      log,
    })).resolves.toBe('already-current');

    expect(createIndexer).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('fails stale --verify without constructing an indexer or writing', async () => {
    const createIndexer = mock(async () => {
      throw new Error('indexer must stay lazy');
    });
    const refresh = mock(async () => {});

    await expect(runBaseLifecycle({ verifyOnly: true }, {
      verifyCurrent: async () => { throw new Error('fixture fingerprint mismatch'); },
      createIndexer,
      refresh,
      log: () => {},
    })).rejects.toThrow('verification failed');

    expect(createIndexer).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('lazily constructs the indexer only when a normal refresh is stale', async () => {
    const indexer = async () => {};
    const createIndexer = mock(async () => indexer);
    const refresh = mock(async () => {});

    await expect(runBaseLifecycle({ verifyOnly: false }, {
      verifyCurrent: async () => { throw new Error('metadata is missing'); },
      createIndexer,
      refresh,
      log: () => {},
    })).resolves.toBe('refreshed');

    expect(createIndexer).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(indexer);
  });
});

describe('package verify command composition', () => {
  const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);
  const metadata: BaseMetadata = {
    schemaMigrationFingerprint: 'schema-fingerprint',
    fixtureFingerprint: computeFixtureFingerprint(HISTORICAL_MATRIX_CASES),
    fixtureCorpusVersion: BASE_FIXTURE_CORPUS_VERSION,
  };

  it('maps the documented verify script to the actual read-only command composition', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve(import.meta.dir, '../../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['eval:discovery-env-matrix-base:verify']).toBe(
      'bun ./src/cli/discovery-env-matrix-base.ts --verify',
    );
    expect(packageJson.scripts['eval:discovery-env-matrix-base:verify']).not.toContain('protocol build');

    const readOnly = mockCurrentCommandDatabase(payload, metadata);
    const createIndexer = mock(async () => {
      throw new Error('verify must not construct the indexer');
    });
    const log = mock(() => {});

    await expect(runBaseCommand(['--verify'], {
      createReadOnly: async () => ({ db: readOnly.db, closeDb: readOnly.closeDb, schema }),
      loadCases: async () => HISTORICAL_MATRIX_CASES,
      expectedMetadata: async () => metadata,
      createIndexer,
      log,
    })).resolves.toBe('already-current');

    expect(readOnly.state.reads).toBe(10);
    expect(readOnly.state.writes).toBe(0);
    expect(readOnly.state.closed).toBe(true);
    expect(createIndexer).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Protected discovery environment matrix base is already current.');
  });
});
