import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { HISTORICAL_SHARED_POOL_SEED_PROJECTION } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js';
import { fingerprintHistoricalQualityVector, historicalQualityAttestationRoot, HISTORICAL_QUALITY_METADATA_KEY } from '../discovery-quality-attestation';
import { assertReadOnlySession, productionHistoricalQualityBaseDependencies, refreshHistoricalQualityBase, verifyHistoricalQualityPublishedState, verifyHistoricalQualitySeedState, type HistoricalQualityBaseDependencies, type HistoricalQualityBaseState, type HistoricalQualityEmbedder } from '../discovery-quality-base';
import { runHistoricalQualityBaseCommand } from '../discovery-quality-base.main';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import type { DrizzleDB } from '../../lib/drizzle/drizzle';

const projection = HISTORICAL_SHARED_POOL_SEED_PROJECTION;
const identityFields = {
  provider: 'openrouter',
  model: 'openai/text-embedding-3-large',
  dimensions: 2000 as const,
};
const identity = {
  ...identityFields,
  configurationFingerprint: createHash('sha256').update(JSON.stringify(identityFields)).digest('hex'),
};

type MutableState = HistoricalQualityBaseState & { unexpectedDependent?: string };
type FakeTx = { state: MutableState };

function participantByUserId(): Map<string, string> {
  return new Map(projection.contexts.map((row) => [row.userId, row.participantId]));
}

function exactSeedState(): MutableState {
  const participants = participantByUserId();
  return {
    users: projection.users.map(({ id }) => ({
      id,
      email: `${participants.get(id)}@historical-quality.invalid`,
      name: `Historical quality ${participants.get(id)}`,
      emailVerified: false,
      isGhost: false,
      deletedAt: null,
    })),
    networks: projection.networks.map((row) => ({ ...row, isPersonal: false, deletedAt: null })),
    memberships: projection.memberships.map((row) => ({ ...row, permissions: ['member'], autoAssign: false, deletedAt: null })),
    intents: projection.intents.map((row) => ({
      ...row,
      payload: row.text,
      summary: row.text,
      sourceType: 'discovery_form' as const,
      sourceId: row.userId,
      status: 'ACTIVE' as const,
      isIncognito: false,
      archivedAt: null,
      embedding: null,
    })),
    intentNetworkAssignments: projection.intentNetworkAssignments.map((row) => ({ ...row, relevancyScore: '1' })),
    premises: projection.premises.map((row) => ({
      ...row,
      assertion: { text: row.text, tier: 'assertive' as const },
      provenance: { source: 'enrichment' as const, sourceId: row.sourcePath, confidence: 1, timestamp: '2026-08-09T19:02:56.000Z' },
      validity: { volatile: false },
      status: 'ACTIVE' as const,
      retractedAt: null,
      deletedAt: null,
      embedding: null,
    })),
    premiseNetworkAssignments: projection.premises.map((row) => ({ premiseId: row.id, networkId: projection.networks[0].id, relevancyScore: '1' })),
    contexts: projection.contexts.map((row) => ({
      ...row,
      networkId: projection.networks[0].id,
      premiseHash: projection.documents.find((document) => document.sourceRowId === row.id)?.contentFingerprint ?? null,
      embedding: null,
    })),
    documents: [],
    qualityMetadata: null,
    legacyMetadata: [{ key: 'discovery-env-matrix-base-v1', qualityAttestation: null }],
    fixtureOpportunityIds: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function queuedReadDb(resultSets: unknown[][]): DrizzleDB {
  const queue = [...resultSets];
  return {
    select: () => ({
      from: () => {
        const rows = queue.shift() ?? [];
        const query = {
          where: () => query,
          orderBy: () => query,
          limit: () => query,
          then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return query;
      },
    }),
  } as unknown as DrizzleDB;
}

async function readProductionSeedState(input: {
  premiseId?: string;
  premiseUserId?: string;
  premiseText?: string;
  contextId?: string;
  contextUserId?: string;
  contextText?: string;
} = {}): Promise<HistoricalQualityBaseState> {
  const seed = exactSeedState();
  const premises = seed.premises.map((row, index) => ({
    id: index === 0 ? input.premiseId ?? row.id : row.id,
    userId: index === 0 ? input.premiseUserId ?? row.userId : row.userId,
    assertion: index === 0 && input.premiseText ? { ...row.assertion, text: input.premiseText } : row.assertion,
    provenance: row.provenance,
    validity: row.validity,
    status: row.status,
    retractedAt: row.retractedAt,
    deletedAt: row.deletedAt,
    embedding: row.embedding,
  }));
  const contexts = seed.contexts.map((row, index) => ({
    id: index === 0 ? input.contextId ?? row.id : row.id,
    userId: index === 0 ? input.contextUserId ?? row.userId : row.userId,
    networkId: row.networkId,
    text: index === 0 ? input.contextText ?? row.text : row.text,
    premiseHash: projection.documents.find((document) => document.sourceRowId === row.id)?.contentFingerprint ?? null,
    embedding: row.embedding,
  }));
  return productionHistoricalQualityBaseDependencies.readState(queuedReadDb([
    seed.users,
    seed.networks,
    seed.memberships,
    seed.intents,
    seed.intentNetworkAssignments,
    premises,
    seed.premiseNetworkAssignments,
    contexts,
    [],
    [{
      key: 'discovery-env-matrix-base-v1',
      schemaMigrationFingerprint: 'legacy-schema',
      fixtureFingerprint: 'legacy-fixture',
      fixtureCorpusVersion: 'legacy-corpus',
      qualityAttestation: null,
    }],
    [],
  ]), projection);
}

class FakeDb {
  commits = 0;
  transactionEvents: string[] = [];

  constructor(public committed: MutableState = exactSeedState()) {}

  async transaction<T>(work: (tx: FakeTx) => Promise<T>): Promise<T> {
    const state = clone(this.committed);
    this.transactionEvents.push(`begin:${this.commits + 1}`);
    try {
      const result = await work({ state });
      this.committed = state;
      this.commits += 1;
      this.transactionEvents.push(`commit:${this.commits}`);
      return result;
    } catch (error) {
      this.transactionEvents.push(`rollback:${this.commits + 1}`);
      throw error;
    }
  }
}

function asFake(value: unknown): FakeTx | FakeDb {
  return value as FakeTx | FakeDb;
}

function stateOf(value: unknown): MutableState {
  const fake = asFake(value);
  return 'state' in fake ? fake.state : fake.committed;
}

function dependencies(input: {
  events?: string[];
  failAt?: 'dependents' | 'write' | 'readback' | 'metadata' | 'verification';
  invalidReadback?: boolean;
  observer?: HistoricalQualityBaseDependencies['observeVisibility'];
} = {}): HistoricalQualityBaseDependencies {
  const events = input.events ?? [];
  return {
    schemaMigrationFingerprint: async () => 'b'.repeat(64),
    observeVisibility: input.observer,
    deleteQualityMetadata: async (db) => {
      events.push('delete-metadata');
      stateOf(db).qualityMetadata = null;
    },
    assertNoUnexpectedDependents: async (db) => {
      events.push('check-dependents');
      if (input.failAt === 'dependents' || stateOf(db).unexpectedDependent) throw new Error('unexpected dependent');
    },
    replaceSeedRows: async (db) => {
      events.push('replace-seed');
      const seed = exactSeedState();
      const state = stateOf(db);
      Object.assign(state, { ...seed, legacyMetadata: state.legacyMetadata });
    },
    deleteCandidateDocuments: async (db) => {
      events.push('delete-documents');
      stateOf(db).documents = [];
    },
    readState: async (db) => clone(stateOf(db)),
    writeCandidateDocuments: async (db, documents, vectors) => {
      events.push('write-documents');
      if (input.failAt === 'write') throw new Error('write failed');
      stateOf(db).documents = documents.map((document, index) => ({
        ...document,
        embedding: vectors[index]!.map(Math.fround),
      }));
    },
    readRoundTrippedVectors: async (db) => {
      events.push('readback');
      if (input.failAt === 'readback') throw new Error('readback failed');
      const rows = stateOf(db).documents.map((document) => ({
        documentId: document.documentId,
        text: document.text,
        embedding: [...document.embedding],
      }));
      if (input.invalidReadback && rows[0]) rows[0].embedding[0] = Number.NaN;
      return rows;
    },
    insertQualityMetadata: async (db, metadata) => {
      events.push('insert-metadata');
      if (input.failAt === 'metadata') throw new Error('metadata failed');
      stateOf(db).qualityMetadata = clone(metadata);
    },
    beforePublishedVerification: async () => {
      if (input.failAt === 'verification') throw new Error('verification failed');
    },
  };
}

async function publishedDb(): Promise<{ db: FakeDb; deps: HistoricalQualityBaseDependencies }> {
  const db = new FakeDb();
  const deps = dependencies();
  await refreshHistoricalQualityBase(db as unknown as DrizzleDB, projection, fakeEmbedder(), deps);
  return { db, deps };
}

function mutatePublishedAttestation(db: FakeDb, mutate: (attestation: NonNullable<MutableState['qualityMetadata']>['qualityAttestation']) => void): void {
  const metadata = db.committed.qualityMetadata;
  if (!metadata?.qualityAttestation) throw new Error('expected published metadata');
  mutate(metadata.qualityAttestation);
  metadata.fixtureFingerprint = historicalQualityAttestationRoot(metadata.qualityAttestation);
}

function embeddingConfigurationFingerprint(fields: { provider: string; model: string; dimensions: number }): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function fakeEmbedder(input: { events?: string[]; inspect?: () => void } = {}): HistoricalQualityEmbedder & { texts: string[] } {
  const result = {
    identity,
    texts: [] as string[],
    async generate(texts: readonly string[]) {
      input.events?.push('provider');
      input.inspect?.();
      result.texts = [...texts];
      return texts.map((_, documentIndex) => Array.from({ length: 2000 }, (__, componentIndex) =>
        0.1 + documentIndex / 1000 + componentIndex / 1_000_000));
    },
  };
  return result;
}

describe('historical quality base state', () => {
  it('locks the exact named projection cardinality and stable document linkage', () => {
    expect({
      users: projection.users.length,
      networks: projection.networks.length,
      memberships: projection.memberships.length,
      intents: projection.intents.length,
      assignments: projection.intentNetworkAssignments.length,
      premises: projection.premises.length,
      contexts: projection.contexts.length,
      documents: projection.documents.length,
    }).toEqual({ users: 25, networks: 1, memberships: 25, intents: 25, assignments: 25, premises: 30, contexts: 25, documents: 55 });
    expect(projection.documents.map((row) => row.documentId)).toEqual([...projection.documents.map((row) => row.documentId)].sort());
    expect(new Set(projection.documents.map((row) => row.sourceRowId)).size).toBe(55);
  });

  it('accepts only the exact unpublished seed state', async () => {
    const db = new FakeDb();
    await expect(verifyHistoricalQualitySeedState(db as unknown as DrizzleDB, projection, dependencies())).resolves.toBeUndefined();

    const changed = new FakeDb();
    changed.committed.memberships[0]!.autoAssign = true;
    await expect(verifyHistoricalQualitySeedState(changed as unknown as DrizzleDB, projection, dependencies())).rejects.toThrow('membership');

    const changedTimestamp = new FakeDb();
    changedTimestamp.committed.premises[0]!.provenance.timestamp = 'not-the-reviewed-timestamp';
    await expect(verifyHistoricalQualitySeedState(changedTimestamp as unknown as DrizzleDB, projection, dependencies())).rejects.toThrow('premise');

    const missingContextFingerprint = new FakeDb();
    delete (missingContextFingerprint.committed.contexts[0] as { premiseHash?: string | null }).premiseHash;
    await expect(verifyHistoricalQualitySeedState(missingContextFingerprint as unknown as DrizzleDB, projection, dependencies())).rejects.toThrow('context');

    const published = new FakeDb();
    published.committed.documents = [{ ...projection.documents[0]!, embedding: [Math.fround(0.1)] }];
    await expect(verifyHistoricalQualitySeedState(published as unknown as DrizzleDB, projection, dependencies())).rejects.toThrow('candidate document');
  });

  for (const mutation of [
    { label: 'premise ID', input: { premiseId: 'wrong-premise-id' }, select: (state: HistoricalQualityBaseState) => state.premises[0]!.id, expected: 'wrong-premise-id' },
    { label: 'premise user ownership', input: { premiseUserId: 'wrong-premise-owner' }, select: (state: HistoricalQualityBaseState) => state.premises[0]!.userId, expected: 'wrong-premise-owner' },
    { label: 'premise text', input: { premiseText: 'mutated database premise text' }, select: (state: HistoricalQualityBaseState) => state.premises[0]!.assertion.text, expected: 'mutated database premise text' },
    { label: 'context ID', input: { contextId: 'wrong-context-id' }, select: (state: HistoricalQualityBaseState) => state.contexts[0]!.id, expected: 'wrong-context-id' },
    { label: 'context user ownership', input: { contextUserId: 'wrong-context-owner' }, select: (state: HistoricalQualityBaseState) => state.contexts[0]!.userId, expected: 'wrong-context-owner' },
    { label: 'context text', input: { contextText: 'mutated database context text' }, select: (state: HistoricalQualityBaseState) => state.contexts[0]!.text, expected: 'mutated database context text' },
  ] as const) {
    it(`preserves and rejects actual DB ${mutation.label}`, async () => {
      const state = await readProductionSeedState(mutation.input);
      expect(mutation.select(state)).toBe(mutation.expected);
      const deps = dependencies();
      deps.readState = async () => state;
      await expect(verifyHistoricalQualitySeedState(new FakeDb() as unknown as DrizzleDB, projection, deps)).rejects.toThrow();
    });
  }

  it('rejects a supplied projection outside approved seed authority', async () => {
    const mutated = structuredClone(projection);
    (mutated.contexts[0] as { sourcePaths: string[] }).sourcePaths = ['unapproved-source-path'];
    await expect(verifyHistoricalQualitySeedState(new FakeDb() as unknown as DrizzleDB, mutated, dependencies())).rejects.toThrow('approved');
  });

  it('rejects a supplied projection outside approved document authority', async () => {
    const mutated = structuredClone(projection);
    (mutated.documents[0] as { targetFrame: string }).targetFrame = 'unapproved-target-frame';
    await expect(verifyHistoricalQualitySeedState(new FakeDb() as unknown as DrizzleDB, mutated, dependencies())).rejects.toThrow('approved');
  });

  it('commits metadata-absent seed state before provider work and atomically publishes DB-readback fingerprints', async () => {
    const events: string[] = [];
    const db = new FakeDb();
    const embedder = fakeEmbedder({
      events,
      inspect: () => {
        expect(db.commits).toBe(1);
        expect(db.committed.qualityMetadata).toBeNull();
        expect(db.committed.documents).toEqual([]);
        events.push('provider-observed-unpublished');
      },
    });
    const deps = dependencies({
      events,
      observer: async (stage, observedDb) => {
        const state = stateOf(observedDb);
        events.push(`observer:${stage}`);
        expect(state.qualityMetadata).toBeNull();
      },
    });

    const attestation = await refreshHistoricalQualityBase(db as unknown as DrizzleDB, projection, embedder, deps);

    expect(db.commits).toBe(2);
    expect(embedder.texts).toEqual(projection.documents.map((row) => row.text));
    expect(events).toEqual([
      'delete-metadata', 'check-dependents', 'replace-seed', 'delete-documents',
      'observer:provider-work', 'provider', 'provider-observed-unpublished',
      'write-documents', 'readback', 'insert-metadata',
    ]);
    expect(db.committed.qualityMetadata?.qualityAttestation).toEqual(attestation);
    expect(db.committed.qualityMetadata?.fixtureFingerprint).toBe(historicalQualityAttestationRoot(attestation));
    expect(db.committed.qualityMetadata?.schemaMigrationFingerprint).toBe('b'.repeat(64));
    expect(db.committed.legacyMetadata).toEqual([{ key: 'discovery-env-matrix-base-v1', qualityAttestation: null }]);
    expect(attestation.vectors[0]!.vectorFingerprint).toBe(
      fingerprintHistoricalQualityVector(db.committed.documents[0]!.embedding),
    );
    expect(attestation.planFingerprint).toBe('288336f6511a366d8d49303bc3e76eb475a981966e1ffb0eb2a8539d53fc4ce6');
    expect(attestation.seedProjectionFingerprint).toBe('8d27a7634c7def4857f5acd5b399ee82389d8c9baab23fe0b8b4df187a337c38');
    expect(attestation.documentSetFingerprint).toBe('87142f9c46d5fa51f6327c169f6c25d0d90fe35def5ed8778cd27e3da98d7b35');
    expect(attestation.vectors[0]!.textFingerprint).toBe(projection.documents[0]!.contentFingerprint);
    await expect(verifyHistoricalQualityPublishedState(db as unknown as DrizzleDB, projection, deps)).resolves.toBeUndefined();
  });

  for (const mutation of [
    {
      label: 'provider',
      apply: (attestation: NonNullable<MutableState['qualityMetadata']>['qualityAttestation']) => {
        if (!attestation) return;
        attestation.embedding.provider = 'unapproved-provider';
        attestation.embedding.configurationFingerprint = embeddingConfigurationFingerprint(attestation.embedding);
      },
    },
    {
      label: 'model',
      apply: (attestation: NonNullable<MutableState['qualityMetadata']>['qualityAttestation']) => {
        if (!attestation) return;
        attestation.embedding.model = 'unapproved-model';
        attestation.embedding.configurationFingerprint = embeddingConfigurationFingerprint(attestation.embedding);
      },
    },
    {
      label: 'dimensions',
      apply: (attestation: NonNullable<MutableState['qualityMetadata']>['qualityAttestation']) => {
        if (!attestation) return;
        attestation.embedding.dimensions = 1536;
        attestation.embedding.configurationFingerprint = embeddingConfigurationFingerprint(attestation.embedding);
      },
    },
    {
      label: 'configuration fingerprint',
      apply: (attestation: NonNullable<MutableState['qualityMetadata']>['qualityAttestation']) => {
        if (attestation) attestation.embedding.configurationFingerprint = 'f'.repeat(64);
      },
    },
  ]) {
    it(`rejects published embedding ${mutation.label} mutation without constructing a provider`, async () => {
      const { db, deps } = await publishedDb();
      mutatePublishedAttestation(db, mutation.apply);
      await expect(verifyHistoricalQualityPublishedState(db as unknown as DrizzleDB, projection, deps)).rejects.toThrow('embedding');
    });
  }

  for (const field of ['planFingerprint', 'seedProjectionFingerprint', 'documentSetFingerprint'] as const) {
    it(`rejects published ${field} outside merged approval authority`, async () => {
      const { db, deps } = await publishedDb();
      mutatePublishedAttestation(db, (attestation) => {
        if (attestation) attestation[field] = 'f'.repeat(64);
      });
      await expect(verifyHistoricalQualityPublishedState(db as unknown as DrizzleDB, projection, deps)).rejects.toThrow();
    });
  }

  for (const failure of ['write', 'readback', 'metadata', 'verification'] as const) {
    it(`rolls back all candidate state when final ${failure} fails`, async () => {
      const db = new FakeDb();
      await expect(refreshHistoricalQualityBase(
        db as unknown as DrizzleDB,
        projection,
        fakeEmbedder(),
        dependencies({ failAt: failure }),
      )).rejects.toThrow();
      expect(db.commits).toBe(1);
      expect(db.committed.documents).toEqual([]);
      expect(db.committed.qualityMetadata).toBeNull();
      expect(db.transactionEvents.at(-1)).toBe('rollback:2');
    });
  }

  it('rolls back candidate construction when DB readback is not finite float32', async () => {
    const db = new FakeDb();
    await expect(refreshHistoricalQualityBase(
      db as unknown as DrizzleDB,
      projection,
      fakeEmbedder(),
      dependencies({ invalidReadback: true }),
    )).rejects.toThrow('finite');
    expect(db.commits).toBe(1);
    expect(db.committed.documents).toEqual([]);
    expect(db.committed.qualityMetadata).toBeNull();
  });

  it('refuses unexpected dependents before fixture-owned deletion commits', async () => {
    const original = exactSeedState();
    original.qualityMetadata = {
      key: HISTORICAL_QUALITY_METADATA_KEY,
      schemaMigrationFingerprint: 'b'.repeat(64),
      fixtureFingerprint: 'c'.repeat(64),
      fixtureCorpusVersion: 'historical-shared-pool-v1',
      qualityAttestation: null,
    };
    original.unexpectedDependent = 'foreign-intent';
    const db = new FakeDb(original);
    await expect(refreshHistoricalQualityBase(db as unknown as DrizzleDB, projection, fakeEmbedder(), dependencies())).rejects.toThrow('unexpected dependent');
    expect(db.commits).toBe(0);
    expect(db.committed.qualityMetadata).not.toBeNull();
  });
});

describe('historical quality read-only command', () => {
  it('requires transaction_read_only=on', async () => {
    await expect(assertReadOnlySession(async () => [{ transactionReadOnly: 'on' }])).resolves.toBe('on');
    await expect(assertReadOnlySession(async () => [{ transactionReadOnly: 'off' }])).rejects.toThrow('not read-only');
    await expect(assertReadOnlySession(async () => [])).rejects.toThrow('not read-only');
  });

  it('constructs no refresh/provider dependency in verify mode and always closes', async () => {
    const calls: string[] = [];
    const db = new FakeDb();
    const attestation = await refreshHistoricalQualityBase(db as unknown as DrizzleDB, projection, fakeEmbedder(), dependencies());
    expect(attestation).toBeDefined();

    await expect(runHistoricalQualityBaseCommand(['--verify'], {
      createVerifier: async () => ({
        db: db as unknown as DrizzleDB,
        query: async () => [{ transactionReadOnly: 'on' }],
        close: async () => { calls.push('close-verifier'); },
      }),
      createRefresh: async () => { calls.push('forbidden-refresh'); throw new Error('provider constructed'); },
      dependencies: () => dependencies(),
      projection,
      log: (line) => calls.push(line),
    })).resolves.toBe('verified');
    expect(calls).toEqual(['Historical quality base verifier session read-only: on', 'close-verifier']);
  });

  it('fails unpublished --verify without fallback and closes the verifier', async () => {
    const calls: string[] = [];
    const db = new FakeDb();
    await expect(runHistoricalQualityBaseCommand(['--verify'], {
      createVerifier: async () => ({
        db: db as unknown as DrizzleDB,
        query: async () => [{ transactionReadOnly: 'on' }],
        close: async () => { calls.push('close-verifier'); },
      }),
      createRefresh: async () => { calls.push('forbidden-refresh'); throw new Error('must not refresh'); },
      dependencies: () => dependencies(),
      projection,
      log: () => undefined,
    })).rejects.toThrow('quality metadata');
    expect(calls).toEqual(['close-verifier']);
  });

  it('does not turn an unclassified verifier failure into a writable refresh', async () => {
    const calls: string[] = [];
    const failingDependencies = dependencies();
    failingDependencies.readState = async () => { throw new Error('database unavailable'); };
    await expect(runHistoricalQualityBaseCommand([], {
      createVerifier: async () => ({
        db: new FakeDb() as unknown as DrizzleDB,
        query: async () => [],
        close: async () => { calls.push('close-verifier'); },
      }),
      createRefresh: async () => { calls.push('forbidden-refresh'); throw new Error('must not refresh'); },
      dependencies: () => failingDependencies,
      projection,
      log: () => undefined,
    })).rejects.toThrow('database unavailable');
    expect(calls).toEqual(['close-verifier']);
  });

  it('closes stale verifier and refreshed writer resources', async () => {
    const calls: string[] = [];
    const stale = new FakeDb();
    const writer = new FakeDb();
    await expect(runHistoricalQualityBaseCommand([], {
      createVerifier: async () => ({
        db: stale as unknown as DrizzleDB,
        query: async () => [{ transactionReadOnly: 'on' }],
        close: async () => { calls.push('close-stale'); },
      }),
      createRefresh: async () => ({
        db: writer as unknown as DrizzleDB,
        embedder: fakeEmbedder(),
        close: async () => { calls.push('close-writer'); },
      }),
      dependencies: () => dependencies(),
      projection,
      log: (line) => calls.push(line),
    })).resolves.toBe('refreshed');
    expect(calls).toEqual(['close-stale', 'Historical quality base refreshed and verified.', 'close-writer']);
  });

  it('closes writer resources when refresh fails', async () => {
    const calls: string[] = [];
    await expect(runHistoricalQualityBaseCommand([], {
      createVerifier: async () => ({
        db: new FakeDb() as unknown as DrizzleDB,
        query: async () => [],
        close: async () => { calls.push('close-stale'); },
      }),
      createRefresh: async () => ({
        db: new FakeDb() as unknown as DrizzleDB,
        embedder: fakeEmbedder(),
        close: async () => { calls.push('close-writer'); },
      }),
      dependencies: () => dependencies({ failAt: 'write' }),
      projection,
      log: () => undefined,
    })).rejects.toThrow('write failed');
    expect(calls).toEqual(['close-stale', 'close-writer']);
  });

  it('exposes identity from the same adapter configuration used for generate', () => {
    const adapter = new EmbedderAdapter({ apiKey: 'test', baseURL: 'https://embedding.test/v1', dimensions: 2000 });
    expect(adapter.identity).toEqual({
      provider: 'openrouter',
      model: 'openai/text-embedding-3-large',
      dimensions: 2000,
      configurationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
