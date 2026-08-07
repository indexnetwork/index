import { describe, expect, it, mock } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import { HISTORICAL_QUALITY_CASES } from '../../../../../packages/protocol/eval/matching/matching.historical.js';
import type { DrizzleDB } from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

import { HISTORICAL_MATRIX_CASES_PATH, parseBaseArgs, runBaseCommand, runBaseLifecycle, seedProtectedBase, verifyBaseFixtureIntegrity, verifyProtectedBase } from '../discovery-env-matrix-base.main';
import { BaseRuntimeChildError, handoffBaseRuntime, runProtectedBaseBootstrap } from '../discovery-env-matrix-base';
import { BASE_FIXTURE_CORPUS_VERSION, assertBaseEnvironment, baseSeedPayload, computeFixtureFingerprint, type BaseMetadata, verifyBaseContract } from '../discovery-env-matrix.shared';

const SAFE_ENV: NodeJS.ProcessEnv = {
  DISCOVERY_ENV_MATRIX_BASE_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  DATABASE_URL: 'postgres://x@ep-x.neon.tech/protocol_eval',
  DISCOVERY_ENV_MATRIX_BASE_BRANCH: 'eval-discovery-base',
};

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...allStrings(child)]);
  }
  return [];
}

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
  const select = () => {
    const rows = results.shift() ?? [];
    const query = {
      then(resolve: (value: unknown[]) => void) {
        state.reads += 1;
        resolve(rows);
      },
    };
    return { from: () => Object.assign(query, { where: () => query }) };
  };
  return { db: { select } as unknown as DrizzleDB, state };
}

function mockCurrentCommandDatabase(payload: ReturnType<typeof baseSeedPayload>, metadata: BaseMetadata) {
  const structuralRows: unknown[][] = [
    payload.users.map((user) => ({ ...user, emailVerified: false, deletedAt: null })),
    payload.networks.map((network) => ({ ...network, deletedAt: null })),
    payload.intents.map((intent) => ({ ...intent, status: 'ACTIVE', sourceType: 'discovery_form', sourceId: intent.userId, archivedAt: null, embedding: Array(2000).fill(0.1) })),
    payload.intents.map((intent) => ({ intentId: intent.id, networkId: intent.networkId, relevancyScore: '1' })),
    payload.memberships.map((membership) => ({ userId: membership.userId, networkId: membership.networkId, permissions: ['member'], autoAssign: false })),
    [], [], [],
    payload.intents.map((intent) => ({ sourceId: intent.id, sourceText: intent.payload, sourceType: 'intent', strategy: 'semantic', targetCorpus: 'intents', hydeText: 'synthetic', embedding: Array(2000).fill(0.1) })),
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

  it('serializes exact all-five-case database rows', () => {
    const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);

    expect(payload.cases).toHaveLength(5);
    expect(payload.networks).toHaveLength(5);
    expect(payload.memberships).toHaveLength(25);
    expect(payload.intents).toHaveLength(25);

    for (const matrixCase of HISTORICAL_MATRIX_CASES) {
      const fixtureCase = payload.cases.find(({ id }) => id === matrixCase.id);
      expect(fixtureCase).toBeDefined();
      const network = payload.networks.find(({ id }) => id === fixtureCase!.networkId);
      expect(network).toBeDefined();
      expect(network!.prompt).toBe(matrixCase.networkContext);

      const memberships = payload.memberships.filter(({ networkId }) => networkId === network!.id);
      expect(memberships).toHaveLength(matrixCase.participants.length);
      for (const [index, participant] of matrixCase.participants.entries()) {
        const membership = memberships[index]!;
        const user = payload.users.find(({ id }) => id === membership.userId);
        expect(user).toBeDefined();
        expect(user!.intro).toBe(participant.profileText);
        expect(user!.location).toBe(participant.location);
        expect(user!.email).toEndWith('@fixture.invalid');
        expect(user!.name).toMatch(/^Evaluation fixture participant [a-f0-9]{8}$/);

        const intent = payload.intents.find(({ networkId, userId }) => (
          networkId === network!.id && userId === membership.userId
        ));
        expect(intent).toBeDefined();
        expect(intent!.payload).toBe(participant.intent.text);
        expect(intent!.summary).toBe('Discovery evaluation fixture intent');
      }

      const membershipIdFor = (participantId: string): string => {
        const index = matrixCase.participants.findIndex(({ id }) => id === participantId);
        expect(index).toBeGreaterThanOrEqual(0);
        return memberships[index]!.userId;
      };
      expect(fixtureCase!.sourceUserId).toBe(membershipIdFor(matrixCase.sourceUserId));
      expect(fixtureCase!.expectedUserId).toBe(membershipIdFor(matrixCase.expectedUserId));
      expect(fixtureCase!.excludedUserIds).toEqual(matrixCase.excludedUserIds.map(membershipIdFor));
    }
  });

  it('excludes recursive audit and report data from serialized rows', () => {
    const auditKeys = [
      'historicalQuality', 'claimProvenance', 'semanticNegatives',
      'anonymizationReview', 'outcomeCitationIds', 'citationIds',
      'basisClaimIds', 'violatedRequirement', 'uncertaintyRationale',
    ];
    const forbidden = HISTORICAL_QUALITY_CASES.flatMap((historicalCase) => [
      ...Object.values(historicalCase.reportNames ?? {}),
      ...historicalCase.historicalQuality.citations.flatMap(({ url, title, publisher, excerpt }) =>
        [url, title, publisher, excerpt]),
      ...Object.values(historicalCase.historicalQuality.semanticNegatives),
      ...auditKeys,
    ]).filter(Boolean);

    const serializedStrings = allStrings(baseSeedPayload(HISTORICAL_MATRIX_CASES));
    for (const value of forbidden) {
      expect(serializedStrings.some((entry) => entry.includes(value)), value).toBeFalse();
    }
  });

  it('uses deterministic, fixture-scoped IDs and the audited v2 corpus contract', () => {
    const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);

    expect(BASE_FIXTURE_CORPUS_VERSION).toBe('historical-matrix-v2');
    expect(payload.fixtureCorpusVersion).toBe('historical-matrix-v2');
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
    expect(() => verifyBaseContract({ ...expected, fixtureCorpusVersion: 'historical-matrix-v1' }, expected)).toThrow('fixture corpus version mismatch');
    expect(() => verifyBaseContract(expected, expected)).not.toThrow();
  });
});

describe('protected base bootstrap runtime handoff', () => {
  const runtimeFixture = path.resolve(import.meta.dir, 'fixtures/discovery-env-matrix-base-runtime-handoff.fixture.ts');
  const attestedManifest = JSON.stringify({
    version: 1,
    base: {
      projectId: 'project-id', branchId: 'base-branch-id', endpointId: 'base-endpoint-id',
      databaseName: 'protocol_eval', databaseUrl: 'postgres://base@ep-base.neon.tech/protocol_eval',
    },
    children: [],
  });

  it('runs the runtime in a fresh process with only the attested target and sanitized child environment', async () => {
    const output = await handoffBaseRuntime({
      args: ['--verify'],
      databaseUrl: 'postgres://base@ep-base.neon.tech/protocol_eval',
      runtimePath: runtimeFixture,
      env: {
        DATABASE_URL: 'postgres://untrusted@ep-other.neon.tech/protocol_eval',
        NEON_API_KEY: 'must-not-reach-runtime',
        DISCOVERY_ENV_MATRIX_CHILDREN: 'must-not-reach-runtime',
      },
    });
    const runtime = JSON.parse(output) as {
      pid: number; args: string[]; databaseUrl: string; neonApiKeyPresent: boolean; manifestPresent: boolean;
    };

    expect(runtime.pid).not.toBe(process.pid);
    expect(runtime.args).toEqual(['--verify']);
    expect(runtime.databaseUrl).toBe('postgres://base@ep-base.neon.tech/protocol_eval');
    expect(runtime.neonApiKeyPresent).toBe(false);
    expect(runtime.manifestPresent).toBe(false);
  });

  it('suppresses raw failed-child output while retaining its nonzero exit status', async () => {
    const failure = await handoffBaseRuntime({
      args: ['fail'], databaseUrl: 'postgres://base@ep-base.neon.tech/protocol_eval', runtimePath: runtimeFixture,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BaseRuntimeChildError);
    expect((failure as BaseRuntimeChildError).exitCode).toBe(23);
    expect(String(failure)).not.toContain('should-not-leak');
  });

  it('attests and binds before it hands off to the child runtime', async () => {
    const events: string[] = [];
    const output = await runProtectedBaseBootstrap({
      args: ['ignored', '--verify'],
      env: {
        DISCOVERY_ENV_MATRIX_CHILDREN: attestedManifest,
        DATABASE_URL: 'postgres://operator@ep-base.neon.tech/protocol_eval',
      },
      attest: async () => { events.push('attested'); },
      handoff: async (args, databaseUrl) => {
        events.push(`handoff:${databaseUrl}`);
        expect(args).toEqual(['--verify']);
        return 'runtime output\n';
      },
    });

    expect(output).toBe('runtime output\n');
    expect(events).toEqual([
      'attested',
      'handoff:postgres://base@ep-base.neon.tech/protocol_eval',
    ]);
  });

  it('does not hand off when attestation fails', async () => {
    const handoff = mock(async () => 'must not run');
    await expect(runProtectedBaseBootstrap({
      args: [],
      env: { DISCOVERY_ENV_MATRIX_CHILDREN: attestedManifest, DATABASE_URL: 'postgres://operator@ep-base.neon.tech/protocol_eval' },
      attest: async () => { throw new Error('attestation rejected'); },
      handoff,
    })).rejects.toThrow('attestation rejected');
    expect(handoff).not.toHaveBeenCalled();
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
        status: 'ACTIVE', sourceType: 'discovery_form', sourceId: intent.userId, archivedAt: null,
        embedding: intent.id === options.unembeddedIntentId ? null : Array(2000).fill(0.1),
      })),
      payload.intents.map((intent) => ({ intentId: intent.id, networkId: intent.networkId, relevancyScore: '1' })),
      payload.memberships.map((membership) => ({ userId: membership.userId, networkId: membership.networkId, permissions: ['member'], autoAssign: false })),
      [],
      [],
      [],
      payload.intents.map((intent) => ({ sourceId: intent.id, sourceText: intent.payload, sourceType: 'intent', strategy: 'semantic', targetCorpus: 'intents', hydeText: 'synthetic', embedding: Array(2000).fill(0.1) })),
      [],
      [],
      [],
      [],
      [],
    ];
  }

  it('fails a structural mutation through read-only fixture checks', async () => {
    const { db, state } = mockReadOnlyDatabase(structuralRows({
      unembeddedIntentId: payload.intents[0]!.id,
    }));

    await expect(verifyBaseFixtureIntegrity(db, schema, payload)).rejects.toThrow('invalid embedding');
    expect(state.reads).toBe(10);
    expect(state.writes).toBe(0);
  });

  it.each([
    ['extra', (documents: Array<Record<string, unknown>>) => documents.push({ ...documents[0] })],
    ['wrong binding', (documents: Array<Record<string, unknown>>) => { documents[0]!.sourceId = payload.intents[1]!.id; }],
    ['wrong source', (documents: Array<Record<string, unknown>>) => { documents[0]!.sourceType = 'profile'; }],
    ['malformed vector', (documents: Array<Record<string, unknown>>) => { documents[0]!.embedding = [0.1]; }],
  ])('rejects %s fixture intent HyDE state without writes', async (_label, mutate) => {
    const rows = structuralRows();
    const documents = rows[8] as Array<Record<string, unknown>>;
    mutate(documents);
    const { db, state } = mockReadOnlyDatabase(rows);

    await expect(verifyBaseFixtureIntegrity(db, schema, payload)).rejects.toThrow('fixture intent HyDE');
    expect(state.writes).toBe(0);
  });

  it('accepts optional null fixture intent HyDE source text without writes', async () => {
    const rows = structuralRows();
    for (const document of rows[8] as Array<Record<string, unknown>>) document.sourceText = null;
    const { db, state } = mockReadOnlyDatabase(rows);

    await verifyBaseFixtureIntegrity(db, schema, payload);
    expect(state.writes).toBe(0);
  });

  it('rejects a non-null fixture intent HyDE source-text mismatch without writes', async () => {
    const rows = structuralRows();
    (rows[8] as Array<Record<string, unknown>>)[0]!.sourceText = 'mismatch';
    const { db, state } = mockReadOnlyDatabase(rows);

    await expect(verifyBaseFixtureIntegrity(db, schema, payload)).rejects.toThrow('malformed fixture intent HyDE');
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

  it('refuses v1 protected-base metadata without refresh or spend; authorized reseeding is deferred to IND-638', async () => {
    const expected: BaseMetadata = {
      schemaMigrationFingerprint: 'schema-fingerprint',
      fixtureFingerprint: computeFixtureFingerprint(HISTORICAL_MATRIX_CASES),
      fixtureCorpusVersion: BASE_FIXTURE_CORPUS_VERSION,
    };
    const v1Metadata = { ...expected, fixtureCorpusVersion: 'historical-matrix-v1' };
    const createIndexer = mock(async () => {
      throw new Error('v1 refusal must happen before provider spend');
    });
    const refresh = mock(async () => {
      throw new Error('IND-637 must not reseed the protected base');
    });

    await expect(runBaseLifecycle({ verifyOnly: true }, {
      verifyCurrent: async () => verifyBaseContract(v1Metadata, expected),
      createIndexer,
      refresh,
      log: () => {},
    })).rejects.toThrow('verification failed');

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

    expect(readOnly.state.reads).toBe(11);
    expect(readOnly.state.writes).toBe(0);
    expect(readOnly.state.closed).toBe(true);
    expect(createIndexer).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Protected discovery environment matrix base is already current.');
  });
});
