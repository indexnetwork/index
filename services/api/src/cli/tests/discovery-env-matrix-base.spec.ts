import { describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
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

  it('serializes the exact complete all-five-case database row set', () => {
    const payload = baseSeedPayload(HISTORICAL_MATRIX_CASES);
    // Digest changes require deliberate review of the complete serialized payload, including every field and array order.
    const expectedCompletePayloadDigest = '816fc4f9e7fa49f0c16ec10bdec0fb85029112eda7cf62bc54a565ab9b278c6d';
    expect(createHash('sha256').update(JSON.stringify(payload)).digest('hex')).toBe(expectedCompletePayloadDigest);

    const expectedCases = [
      {
        id: 'historical/builder-and-operator',
        description: 'An engineering-management graduate participating in a joint search for European home-goods design is paired with a product designer who apprenticed with a sculptor father.',
        networkTitle: 'Discovery evaluation fixture 1',
      },
      {
        id: 'historical/co-researchers-structure',
        description: 'A virus-trained biologist studying biological macromolecules is paired with a researcher bringing complementary physical and crystallographic methods.',
        networkTitle: 'Discovery evaluation fixture 2',
      },
      {
        id: 'historical/songwriting-duo',
        description: 'A teenage amateur-group leader seeking stronger guitar capability is paired with a teenage popular-music player with demonstrated guitar ability.',
        networkTitle: 'Discovery evaluation fixture 3',
      },
      {
        id: 'historical/first-check-investor',
        description: 'A graduate researcher with a working information-retrieval prototype is paired with a technically fluent systems builder willing to evaluate a possible company transition.',
        networkTitle: 'Discovery evaluation fixture 4',
      },
      {
        id: 'historical/domain-expert-and-ml',
        description: 'A vaccine-focused immunologist who needs an antigen-encoding RNA payload is paired with an RNA researcher who had worked with messenger RNA for nearly a decade toward therapeutic-protein goals.',
        networkTitle: 'Discovery evaluation fixture 5',
      },
    ] as const;
    const expectedNetworkIds = [
      'eval-discovery-matrix-network-da199123c915c310012ede44',
      'eval-discovery-matrix-network-258f3e209a1abb21903bc1a9',
      'eval-discovery-matrix-network-19e1e79cf8828ac898b8c8f3',
      'eval-discovery-matrix-network-27908d45f8c6b7eb90e6292b',
      'eval-discovery-matrix-network-54b342488937695bd4cf291f',
    ] as const;
    const expectedUserIds = [
      'eval-discovery-matrix-user-899f03f790681c6a17b0ff89',
      'eval-discovery-matrix-user-fe7f5c1b5049fb5467759af4',
      'eval-discovery-matrix-user-932c182c43d90822a5f223fd',
      'eval-discovery-matrix-user-74a793e5da880a4a73feffb0',
      'eval-discovery-matrix-user-fa3fc9221e5650e9aac4e74f',
      'eval-discovery-matrix-user-0bc7658c22db8b7e208a406a',
      'eval-discovery-matrix-user-c944e4b0683c7168ba2a2074',
      'eval-discovery-matrix-user-c538c28e349754c03a6f2471',
      'eval-discovery-matrix-user-a4608e450690e426f8686169',
      'eval-discovery-matrix-user-f52f16525b20673c810a1b48',
      'eval-discovery-matrix-user-0a6bcb5d0ea3394c7bd83b2f',
      'eval-discovery-matrix-user-98af7a4c64c1058c44efc32a',
      'eval-discovery-matrix-user-a991ae39f012276cf2651678',
      'eval-discovery-matrix-user-28a9034123fa3c6343b31542',
      'eval-discovery-matrix-user-bc35b2d20c25c882b6180ab4',
      'eval-discovery-matrix-user-28664e86288bf2f71b32da90',
      'eval-discovery-matrix-user-f73a0ebeb7f80ddf4df689ce',
      'eval-discovery-matrix-user-10120001768d47d553e3eba9',
      'eval-discovery-matrix-user-61b92b1a03ad09c1a157d6e0',
      'eval-discovery-matrix-user-96505d83681f7ddd5a377d69',
      'eval-discovery-matrix-user-aba7263b70935088fe2420ab',
      'eval-discovery-matrix-user-242c0609ddd63f0f42df9227',
      'eval-discovery-matrix-user-afac75fd2e09955ea200f489',
      'eval-discovery-matrix-user-83b1a0b589369a8cec91a62e',
      'eval-discovery-matrix-user-d2711f817c286af9f530c207',
    ] as const;
    const expectedIntentIds = [
      'eval-discovery-matrix-intent-cb1c4fc76e7e2c394fa4bda1',
      'eval-discovery-matrix-intent-5e1b82fd93e8affcfcc973ba',
      'eval-discovery-matrix-intent-183f2f693db616dbd2153708',
      'eval-discovery-matrix-intent-81d513017aaf2d6f48523b7a',
      'eval-discovery-matrix-intent-e8b74ff979b3fbf144f9fa86',
      'eval-discovery-matrix-intent-6d79a35cd616dd0b20b0e7b8',
      'eval-discovery-matrix-intent-0dba61a0b7b2aebe692e36e3',
      'eval-discovery-matrix-intent-e6853dba50b6f66bb0122b5d',
      'eval-discovery-matrix-intent-b1a414172b64edeca46cbe74',
      'eval-discovery-matrix-intent-9e203b40ba3859d5ae0ce0e0',
      'eval-discovery-matrix-intent-77ba7a8f1e81b6750f965f71',
      'eval-discovery-matrix-intent-2fb51f8ee3c5759b51a3051a',
      'eval-discovery-matrix-intent-6d388c61dbd87cb85a9dd458',
      'eval-discovery-matrix-intent-1b3270791f7b9e99af42fa38',
      'eval-discovery-matrix-intent-d8eeb17ebab06f3fe810d256',
      'eval-discovery-matrix-intent-b2e2958e318575c9eb675e2a',
      'eval-discovery-matrix-intent-75b9d5c8f8d73149d9d43e7e',
      'eval-discovery-matrix-intent-067e856bf59902dbaced22b7',
      'eval-discovery-matrix-intent-f613c08d7f3239453ffa79b6',
      'eval-discovery-matrix-intent-2c04ba6c25dca7fb229508d1',
      'eval-discovery-matrix-intent-3707fef85ec602226f6c216c',
      'eval-discovery-matrix-intent-ffadcd7a293a9be47277a0a4',
      'eval-discovery-matrix-intent-103a9ef9d8f9ebfffa6e2505',
      'eval-discovery-matrix-intent-1e001b0ccb042e0637a50c68',
      'eval-discovery-matrix-intent-1ab7dbcbf9fddab68fadc444',
    ] as const;
    const expectedUserNames = [
      'Evaluation fixture participant 899f03f7',
      'Evaluation fixture participant fe7f5c1b',
      'Evaluation fixture participant 932c182c',
      'Evaluation fixture participant 74a793e5',
      'Evaluation fixture participant fa3fc922',
      'Evaluation fixture participant 0bc7658c',
      'Evaluation fixture participant c944e4b0',
      'Evaluation fixture participant c538c28e',
      'Evaluation fixture participant a4608e45',
      'Evaluation fixture participant f52f1652',
      'Evaluation fixture participant 0a6bcb5d',
      'Evaluation fixture participant 98af7a4c',
      'Evaluation fixture participant a991ae39',
      'Evaluation fixture participant 28a90341',
      'Evaluation fixture participant bc35b2d2',
      'Evaluation fixture participant 28664e86',
      'Evaluation fixture participant f73a0ebe',
      'Evaluation fixture participant 10120001',
      'Evaluation fixture participant 61b92b1a',
      'Evaluation fixture participant 96505d83',
      'Evaluation fixture participant aba7263b',
      'Evaluation fixture participant 242c0609',
      'Evaluation fixture participant afac75fd',
      'Evaluation fixture participant 83b1a0b5',
      'Evaluation fixture participant d2711f81',
    ] as const;

    expect(payload.cases).toHaveLength(5);
    expect(payload.users).toHaveLength(25);
    expect(payload.networks).toHaveLength(5);
    expect(payload.memberships).toHaveLength(25);
    expect(payload.intents).toHaveLength(25);
    expect(payload.networks.map(({ id }) => id)).toEqual(expectedNetworkIds);
    expect(payload.users.map(({ id }) => id)).toEqual(expectedUserIds);
    expect(payload.intents.map(({ id }) => id)).toEqual(expectedIntentIds);
    expect(payload.users.map(({ name }) => name)).toEqual(expectedUserNames);
    expect(payload.cases.map(({ id, description }) => ({ id, description }))).toEqual(
      expectedCases.map(({ id, description }) => ({ id, description })),
    );
    expect(new Set(payload.users.map(({ id }) => id)).size).toBe(25);
    expect(new Set(payload.networks.map(({ id }) => id)).size).toBe(5);
    expect(new Set(payload.intents.map(({ id }) => id)).size).toBe(25);
    expect(payload.users.every(({ id }) => id.startsWith('eval-discovery-matrix-user-'))).toBeTrue();
    expect(payload.networks.every(({ id }) => id.startsWith('eval-discovery-matrix-network-'))).toBeTrue();
    expect(payload.intents.every(({ id }) => id.startsWith('eval-discovery-matrix-intent-'))).toBeTrue();

    const userIds = new Set(payload.users.map(({ id }) => id));
    const networkIds = new Set(payload.networks.map(({ id }) => id));
    expect(new Set(payload.memberships.map(({ userId }) => userId))).toEqual(userIds);
    expect(new Set(payload.memberships.map(({ networkId }) => networkId))).toEqual(networkIds);
    expect(new Set(payload.intents.map(({ userId }) => userId))).toEqual(userIds);
    expect(new Set(payload.intents.map(({ networkId }) => networkId))).toEqual(networkIds);
    expect(new Set(payload.memberships.map(({ networkId, userId }) => `${networkId}:${userId}`))).toEqual(
      new Set(payload.intents.map(({ networkId, userId }) => `${networkId}:${userId}`)),
    );

    for (const [caseIndex, matrixCase] of HISTORICAL_MATRIX_CASES.entries()) {
      const expectedCase = expectedCases[caseIndex]!;
      expect(matrixCase.id).toBe(expectedCase.id);
      const fixtureCase = payload.cases[caseIndex]!;
      expect(fixtureCase.id).toBe(expectedCase.id);
      expect(fixtureCase.description).toBe(expectedCase.description);

      const network = payload.networks[caseIndex]!;
      expect(network.id).toBe(fixtureCase.networkId);
      expect(network.title).toBe(expectedCase.networkTitle);
      expect(network.prompt).toBe(matrixCase.networkContext);

      const memberships = payload.memberships.filter(({ networkId }) => networkId === network.id);
      const intents = payload.intents.filter(({ networkId }) => networkId === network.id);
      expect(memberships).toHaveLength(5);
      expect(intents).toHaveLength(5);
      for (const [participantIndex, participant] of matrixCase.participants.entries()) {
        const membership = memberships[participantIndex]!;
        const user = payload.users.find(({ id }) => id === membership.userId);
        expect(user).toEqual({
          id: membership.userId,
          email: `${membership.userId}@fixture.invalid`,
          name: expect.stringMatching(/^Evaluation fixture participant [a-f0-9]{8}$/),
          intro: participant.profileText,
          location: participant.location,
        });

        const intent = intents.find(({ userId }) => userId === membership.userId);
        expect(intent).toEqual({
          id: expect.stringMatching(/^eval-discovery-matrix-intent-[a-f0-9]{24}$/),
          userId: membership.userId,
          networkId: network.id,
          payload: participant.intent.text,
          summary: 'Discovery evaluation fixture intent',
        });
      }

      const membershipIdFor = (participantId: string): string => {
        const index = matrixCase.participants.findIndex(({ id }) => id === participantId);
        expect(index).toBeGreaterThanOrEqual(0);
        return memberships[index]!.userId;
      };
      expect(fixtureCase.sourceUserId).toBe(membershipIdFor(matrixCase.sourceUserId));
      expect(fixtureCase.expectedUserId).toBe(membershipIdFor(matrixCase.expectedUserId));
      expect(fixtureCase.excludedUserIds).toEqual(matrixCase.excludedUserIds.map(membershipIdFor));
    }
  });

  it('excludes recursive audit and report data from serialized rows', () => {
    const forbiddenAuditKeys = [
      'reportNames', 'historicalQuality', 'historicalCutoff', 'sourceAudit', 'review',
      'citations', 'claims', 'claimProvenance', 'modelFieldProvenance', 'participantKinds',
      'semanticNegatives', 'anonymizationReview', 'outcomeCitationIds', 'triggerInputs',
      'reviewer', 'reviewedAt', 'recognizability', 'decision', 'rationale',
      'citationIds', 'orderingCitationIds', 'basisClaimIds', 'violatedRequirement',
      'preConnection', 'calendarProxy', 'confidence', 'uncertaintyRationale', 'exclusive',
    ];
    const forbidden = HISTORICAL_QUALITY_CASES.flatMap((historicalCase) => {
      const review = historicalCase.historicalQuality.anonymizationReview;
      return [
        ...Object.values(historicalCase.reportNames ?? {}),
        ...historicalCase.historicalQuality.citations.flatMap(({ id, url, title, publisher, excerpt }) =>
          [id, url, title, publisher, excerpt]),
        ...Object.values(historicalCase.historicalQuality.semanticNegatives),
        review.reviewer,
        review.reviewedAt,
        review.rationale,
      ];
    });
    const forbiddenKeysAndUniqueValues = [...forbiddenAuditKeys, ...new Set(forbidden.filter(Boolean))];

    const serializedStrings = allStrings(baseSeedPayload(HISTORICAL_MATRIX_CASES));
    for (const value of forbiddenKeysAndUniqueValues) {
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
