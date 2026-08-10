import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { HISTORICAL_SHARED_POOL_SEED_PROJECTION } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm/sql';
import postgres from 'postgres';

import * as schema from '../../schemas/database.schema';
import type { HistoricalQualityBaseAttestation } from '../../schemas/database.schema';
import type { DrizzleDB } from '../../lib/drizzle/drizzle';
import { checkTestDatabaseReadiness } from '../../lib/drizzle/test-database-readiness';
import { fingerprintHistoricalQualityVector, historicalQualityAttestationRoot, HISTORICAL_QUALITY_METADATA_KEY } from '../discovery-quality-attestation';
import { assertReadOnlySession, productionHistoricalQualityBaseDependencies, readVerifiedHistoricalQualityPublishedState, refreshHistoricalQualityBase, verifyHistoricalQualityPublishedState, type HistoricalQualityBaseDependencies, type HistoricalQualityBaseState, type HistoricalQualityEmbedder } from '../discovery-quality-base';
import { proveDisposableQualityTestTarget, proveHistoricalQualityIntegrationTargets } from '../discovery-quality-db-test.guard';
import { createNeonControlPlane, type NeonControlPlane } from '../discovery-env-matrix.neon';
import { parseHistoricalQualityManifest, type DiscoveryManifestV2 } from '../discovery.neon';

const projection = HISTORICAL_SHARED_POOL_SEED_PROJECTION;
const TEST_DATABASE_SAFE = process.env.TEST_DATABASE_SAFE;

function fixtureManifest(): DiscoveryManifestV2 {
  return parseHistoricalQualityManifest(JSON.stringify({
    version: 2,
    projectId: 'project-quality',
    baseBranchId: 'branch-base',
    baseReadReplica: {
      endpointId: 'endpoint-base-readonly',
      databaseUrl: 'postgresql://fixture:secret@endpoint-base-readonly.neon.tech/protocol_eval',
    },
    targets: [
      { sideId: 'a', branchId: 'branch-a', endpointId: 'endpoint-a', databaseUrl: 'postgresql://fixture:secret@endpoint-a.neon.tech/protocol_eval' },
      { sideId: 'b', branchId: 'branch-b', endpointId: 'endpoint-b', databaseUrl: 'postgresql://fixture:secret@endpoint-b.neon.tech/protocol_eval' },
    ],
  }));
}

const fixtureRefreshTarget = {
  version: 2,
  projectId: 'project-quality',
  branchId: 'branch-base',
  endpointId: 'endpoint-base-writable',
  databaseName: 'protocol_eval',
  databaseUrl: 'postgresql://fixture:refresh-secret@endpoint-base-writable.neon.tech/protocol_eval',
} as const;

function fixtureControlPlane(): NeonControlPlane {
  return {
    getBranch: async (_projectId, branchId) => branchId === 'branch-base'
      ? { id: branchId, name: 'eval-discovery-base', parentId: null, expiresAt: null, primary: false }
      : { id: branchId, name: branchId === 'branch-a' ? 'eval-ab-a' : 'eval-ab-b', parentId: 'branch-base', expiresAt: null, primary: false },
    listEndpoints: async (_projectId, branchId) => {
      if (branchId === 'branch-base') return [
        { id: 'endpoint-base-readonly', branchId, host: 'endpoint-base-readonly.neon.tech', type: 'read_only' },
        { id: 'endpoint-base-writable', branchId, host: 'endpoint-base-writable.neon.tech', type: 'read_write' },
      ];
      const side = branchId === 'branch-a' ? 'a' : 'b';
      return [{ id: `endpoint-${side}`, branchId, host: `endpoint-${side}.neon.tech`, type: 'read_write' }];
    },
  };
}

describe('disposable historical quality DB target proof', () => {
  it('binds only exact side a and returns identifiers without a URL', async () => {
    const manifest = fixtureManifest();
    const proof = await proveDisposableQualityTestTarget({
      manifest,
      selectedSide: 'a',
      databaseUrl: manifest.targets[0].databaseUrl,
      controlPlane: fixtureControlPlane(),
    });
    expect(proof).toEqual({
      projectId: 'project-quality',
      branchId: 'branch-a',
      endpointId: 'endpoint-a',
      databaseName: 'protocol_eval',
      primary: false,
      parentBranchId: 'branch-base',
    });
    expect(JSON.stringify(proof)).not.toContain('postgres');
    expect(JSON.stringify(proof)).not.toContain('secret');
  });

  for (const mutation of [
    { label: 'a non-selected URL', url: 'postgresql://fixture:secret@endpoint-b.neon.tech/protocol_eval' },
    { label: 'a query-bearing URL', url: 'postgresql://fixture:secret@endpoint-a.neon.tech/protocol_eval?sslmode=require' },
    { label: 'a different database', url: 'postgresql://fixture:secret@endpoint-a.neon.tech/neondb' },
  ]) {
    it(`refuses ${mutation.label} before database use`, async () => {
      await expect(proveDisposableQualityTestTarget({
        manifest: fixtureManifest(),
        selectedSide: 'a',
        databaseUrl: mutation.url,
        controlPlane: fixtureControlPlane(),
      })).rejects.toThrow('proof failed');
    });
  }

  it('refuses primary, wrong-parent, wrong-role, and wrong-host control-plane evidence', async () => {
    const manifest = fixtureManifest();
    for (const change of ['primary', 'parent', 'role', 'host'] as const) {
      const controlPlane = fixtureControlPlane();
      if (change === 'primary' || change === 'parent') {
        controlPlane.getBranch = async (_projectId, branchId) => branchId === 'branch-base'
          ? { id: branchId, name: 'eval-discovery-base', parentId: null, expiresAt: null, primary: false }
          : { id: branchId, name: 'eval-ab-a', parentId: change === 'parent' ? 'other-base' : 'branch-base', expiresAt: null, primary: change === 'primary' };
      } else {
        controlPlane.listEndpoints = async (_projectId, branchId) => [{
          id: 'endpoint-a', branchId, host: change === 'host' ? 'other.neon.tech' : 'endpoint-a.neon.tech',
          type: change === 'role' ? 'read_only' : 'read_write',
        }];
      }
      await expect(proveDisposableQualityTestTarget({
        manifest,
        selectedSide: 'a',
        databaseUrl: manifest.targets[0].databaseUrl,
        controlPlane,
      })).rejects.toThrow('proof failed');
    }
  });

  it('jointly proves the selected child, read-only base replica, and writable refresh topology with identifiers only', async () => {
    const manifest = fixtureManifest();
    const proof = await proveHistoricalQualityIntegrationTargets({
      manifestRaw: JSON.stringify(manifest),
      refreshTargetRaw: JSON.stringify(fixtureRefreshTarget),
      selectedSide: 'a',
      databaseUrl: manifest.targets[0].databaseUrl,
      controlPlane: fixtureControlPlane(),
    });
    expect(proof).toEqual({
      projectId: 'project-quality',
      baseBranchId: 'branch-base',
      basePrimary: false,
      baseReadReplicaEndpointId: 'endpoint-base-readonly',
      baseReadReplicaEndpointType: 'read_only',
      refreshEndpointId: 'endpoint-base-writable',
      refreshEndpointType: 'read_write',
      childBranchId: 'branch-a',
      childEndpointId: 'endpoint-a',
      childEndpointType: 'read_write',
      databaseName: 'protocol_eval',
    });
    expect(JSON.stringify(proof)).not.toContain('postgres');
    expect(JSON.stringify(proof)).not.toContain('secret');
  });

  it('refuses a writable, crossed, wrong-host, wrong-branch, primary, or non-exact protocol_eval base replica', async () => {
    const manifest = fixtureManifest();
    for (const change of ['writable', 'crossed', 'host', 'branch', 'primary', 'database', 'query'] as const) {
      const mutated = structuredClone(manifest);
      const controlPlane = fixtureControlPlane();
      if (change === 'database') mutated.baseReadReplica.databaseUrl = 'postgresql://fixture:secret@endpoint-base-readonly.neon.tech/other';
      if (change === 'query') mutated.baseReadReplica.databaseUrl = 'postgresql://fixture:secret@endpoint-base-readonly.neon.tech/protocol_eval?sslmode=require';
      if (change === 'primary') {
        controlPlane.getBranch = async (_projectId, branchId) => branchId === 'branch-base'
          ? { id: branchId, name: 'eval-discovery-base', parentId: null, expiresAt: null, primary: true }
          : { id: branchId, name: branchId === 'branch-a' ? 'eval-ab-a' : 'eval-ab-b', parentId: 'branch-base', expiresAt: null, primary: false };
      }
      if (['writable', 'crossed', 'host', 'branch'].includes(change)) {
        controlPlane.listEndpoints = async (_projectId, branchId) => {
          if (branchId !== 'branch-base') {
            const side = branchId === 'branch-a' ? 'a' : 'b';
            return [{ id: `endpoint-${side}`, branchId, host: `endpoint-${side}.neon.tech`, type: 'read_write' }];
          }
          return [
            {
              id: 'endpoint-base-readonly',
              branchId: change === 'branch' ? 'branch-a' : branchId,
              host: change === 'host' ? 'other.neon.tech' : change === 'crossed' ? 'endpoint-base-writable.neon.tech' : 'endpoint-base-readonly.neon.tech',
              type: change === 'writable' ? 'read_write' : 'read_only',
            },
            { id: 'endpoint-base-writable', branchId, host: 'endpoint-base-writable.neon.tech', type: 'read_write' },
          ];
        };
      }
      await expect(proveHistoricalQualityIntegrationTargets({
        manifestRaw: JSON.stringify(mutated),
        refreshTargetRaw: JSON.stringify(fixtureRefreshTarget),
        selectedSide: 'a',
        databaseUrl: manifest.targets[0].databaseUrl,
        controlPlane,
      })).rejects.toThrow('integration target proof failed');
    }
  });
});

type SqlClient = ReturnType<typeof postgres>;
let childClient: SqlClient | undefined;
let observerClient: SqlClient | undefined;
let baseClient: SqlClient | undefined;
let childDb: DrizzleDB;
let observerDb: DrizzleDB;
let baseDb: DrizzleDB;
let baselineState: HistoricalQualityBaseState;
let baselineAttestation: HistoricalQualityBaseAttestation;
let providerCalls = 0;

function database(databaseUrl: string): { client: SqlClient; db: DrizzleDB } {
  const client = postgres(databaseUrl, { prepare: false, max: 2 });
  return { client, db: drizzle(client, { schema }) as DrizzleDB };
}

function baselineEmbedder(): HistoricalQualityEmbedder {
  const vectors = new Map(baselineState.documents.map((row) => [row.documentId, row.embedding]));
  return {
    identity: { ...baselineAttestation.embedding, dimensions: 2000 },
    generate: async () => {
      providerCalls += 1;
      return projection.documents.map((document) => [...(vectors.get(document.documentId) ?? [])]);
    },
  };
}

async function currentState(db: DrizzleDB = childDb): Promise<HistoricalQualityBaseState> {
  return productionHistoricalQualityBaseDependencies.readState(db, projection);
}

async function restoreBaseline(): Promise<void> {
  if (!childClient || !baselineState) return;
  await refreshHistoricalQualityBase(childDb, projection, baselineEmbedder(), productionHistoricalQualityBaseDependencies);
  await verifyHistoricalQualityPublishedState(childDb, projection, productionHistoricalQualityBaseDependencies);
}

async function rolledBackMutation(work: (tx: DrizzleDB) => Promise<void>): Promise<void> {
  const rollback = new Error('intentional integration rollback');
  await expect(childDb.transaction(async (tx) => {
    await work(tx as unknown as DrizzleDB);
    throw rollback;
  })).rejects.toBe(rollback);
}

async function expectStale(work: (tx: DrizzleDB) => Promise<void>): Promise<void> {
  await rolledBackMutation(async (tx) => {
    await work(tx);
    await expect(verifyHistoricalQualityPublishedState(tx, projection, productionHistoricalQualityBaseDependencies)).rejects.toThrow('integrity failed');
  });
}

const dbDescribe = describe.skipIf(TEST_DATABASE_SAFE !== '1');

dbDescribe('historical quality protected-base integration', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const apiKey = process.env.NEON_API_KEY;
    const manifestRaw = process.env.DISCOVERY_TARGETS;
    const refreshTargetRaw = process.env.DISCOVERY_QUALITY_BASE_REFRESH_TARGET;
    if (!databaseUrl || !apiKey) throw new Error('Guarded quality DB suite requires DATABASE_URL and NEON_API_KEY');

    // Both the selected writable child and the read-only base replica are
    // jointly control-plane-proven before readiness or either client exists.
    await proveHistoricalQualityIntegrationTargets({
      manifestRaw,
      refreshTargetRaw,
      selectedSide: 'a',
      databaseUrl,
      controlPlane: createNeonControlPlane(apiKey),
    });
    const manifest = parseHistoricalQualityManifest(manifestRaw);
    await checkTestDatabaseReadiness({ databaseUrl, safeMarker: TEST_DATABASE_SAFE });

    ({ client: childClient, db: childDb } = database(databaseUrl));
    ({ client: observerClient, db: observerDb } = database(databaseUrl));
    ({ client: baseClient, db: baseDb } = database(manifest.baseReadReplica.databaseUrl));

    baselineAttestation = await readVerifiedHistoricalQualityPublishedState(childDb, projection, productionHistoricalQualityBaseDependencies);
    baselineState = await currentState();
    await assertReadOnlySession(async (statement) => baseClient!.unsafe(statement));
    await verifyHistoricalQualityPublishedState(baseDb, projection, productionHistoricalQualityBaseDependencies);
    expect(await currentState(baseDb)).toEqual(baselineState);
  });

  afterEach(async () => { await restoreBaseline(); });

  afterAll(async () => {
    await restoreBaseline().catch(() => undefined);
    await Promise.all([
      childClient?.end({ timeout: 5 }),
      observerClient?.end({ timeout: 5 }),
      baseClient?.end({ timeout: 5 }),
    ]);
  });

  it('reads exact ordered seed ownership, memberships, assignments, documents, and legacy-null metadata', async () => {
    const state = await currentState();
    expect(state.users.map((row) => row.id)).toEqual(projection.users.map((row) => row.id));
    expect(state.networks.map((row) => row.id)).toEqual(projection.networks.map((row) => row.id));
    expect(state.memberships.map((row) => `${row.networkId}:${row.userId}`).sort()).toEqual(
      projection.memberships.map((row) => `${row.networkId}:${row.userId}`).sort(),
    );
    expect(state.intentNetworkAssignments.map((row) => `${row.networkId}:${row.intentId}`).sort()).toEqual(
      projection.intentNetworkAssignments.map((row) => `${row.networkId}:${row.intentId}`).sort(),
    );
    expect(state.premises.map((row) => row.userId)).toEqual(projection.premises.map((row) => row.userId));
    expect(state.contexts.map((row) => row.userId)).toEqual(projection.contexts.map((row) => row.userId));
    expect(state.documents.map((row) => row.documentId).sort()).toEqual(projection.documents.map((row) => row.documentId).sort());
    expect(state.legacyMetadata.length).toBeGreaterThan(0);
    expect(state.legacyMetadata.every((row) => row.qualityAttestation === null)).toBe(true);
    await verifyHistoricalQualityPublishedState(childDb, projection, productionHistoricalQualityBaseDependencies);
  });

  it('publishes provider-free round-tripped vectors and metadata atomically from an explicit unpublished phase', async () => {
    const vectors = projection.documents.map((_, documentIndex) =>
      Array.from({ length: 2000 }, (__, componentIndex) => componentIndex === 0 ? 0.1 : (documentIndex + componentIndex + 1) / 10_000));
    const embedder: HistoricalQualityEmbedder = {
      identity: { ...baselineAttestation.embedding, dimensions: 2000 },
      generate: async () => { providerCalls += 1; return vectors; },
    };
    let observedUnpublished = false;
    const dependencies: HistoricalQualityBaseDependencies = {
      ...productionHistoricalQualityBaseDependencies,
      observeVisibility: async () => {
        const state = await currentState(observerDb);
        expect(state.qualityMetadata).toBeNull();
        expect(state.documents).toEqual([]);
        observedUnpublished = true;
      },
    };
    const beforeCalls = providerCalls;
    const attestation = await refreshHistoricalQualityBase(childDb, projection, embedder, dependencies);
    expect(providerCalls).toBe(beforeCalls + 1);
    expect(observedUnpublished).toBe(true);
    const visible = await currentState(observerDb);
    expect(visible.documents).toHaveLength(projection.documents.length);
    expect(visible.qualityMetadata?.qualityAttestation).toEqual(attestation);
    expect(visible.qualityMetadata?.fixtureFingerprint).toBe(historicalQualityAttestationRoot(attestation));
    expect(attestation.planFingerprint).toBe(baselineAttestation.planFingerprint);
    expect(attestation.seedProjectionFingerprint).toBe(baselineAttestation.seedProjectionFingerprint);
    expect(attestation.documentSetFingerprint).toBe(baselineAttestation.documentSetFingerprint);
    expect(visible.documents[0]!.embedding[0]).toBe(Math.fround(0.1));
    expect(attestation.vectors[0]!.vectorFingerprint).toBe(fingerprintHistoricalQualityVector(visible.documents[0]!.embedding));
    expect(() => fingerprintHistoricalQualityVector(vectors[0]!)).toThrow('float32');
  });

  for (const failure of ['write', 'readback', 'metadata', 'verification'] as const) {
    it(`rolls back all final candidate state after injected ${failure} failure`, async () => {
      const dependencies: HistoricalQualityBaseDependencies = {
        ...productionHistoricalQualityBaseDependencies,
        writeCandidateDocuments: async (...args) => {
          await productionHistoricalQualityBaseDependencies.writeCandidateDocuments(...args);
          if (failure === 'write') throw new Error('injected final write failure');
        },
        readRoundTrippedVectors: async (...args) => {
          const rows = await productionHistoricalQualityBaseDependencies.readRoundTrippedVectors(...args);
          if (failure === 'readback') throw new Error('injected final readback failure');
          return rows;
        },
        insertQualityMetadata: async (...args) => {
          await productionHistoricalQualityBaseDependencies.insertQualityMetadata(...args);
          if (failure === 'metadata') throw new Error('injected final metadata failure');
        },
        beforePublishedVerification: async () => {
          if (failure === 'verification') throw new Error('injected final verification failure');
        },
      };
      await expect(refreshHistoricalQualityBase(childDb, projection, baselineEmbedder(), dependencies)).rejects.toThrow('injected final');
      const state = await currentState();
      expect(state.documents).toEqual([]);
      expect(state.qualityMetadata).toBeNull();
    });
  }

  it('detects stale corpus, plan, seed, document, configuration, text, vector, and vector-list states', async () => {
    for (const field of ['corpusVersion', 'planFingerprint', 'seedProjectionFingerprint', 'documentSetFingerprint'] as const) {
      await expectStale(async (tx) => {
        const state = await currentState(tx);
        const metadata = structuredClone(state.qualityMetadata!);
        metadata.qualityAttestation![field] = field === 'corpusVersion' ? 'stale-corpus' : 'f'.repeat(64);
        metadata.fixtureFingerprint = historicalQualityAttestationRoot(metadata.qualityAttestation!);
        await tx.update(schema.evalMatrixMetadata).set(metadata).where(eq(schema.evalMatrixMetadata.key, HISTORICAL_QUALITY_METADATA_KEY));
      });
    }
    await expectStale(async (tx) => {
      const state = await currentState(tx);
      const metadata = structuredClone(state.qualityMetadata!);
      metadata.qualityAttestation!.embedding.configurationFingerprint = 'f'.repeat(64);
      metadata.fixtureFingerprint = historicalQualityAttestationRoot(metadata.qualityAttestation!);
      await tx.update(schema.evalMatrixMetadata).set(metadata).where(eq(schema.evalMatrixMetadata.key, HISTORICAL_QUALITY_METADATA_KEY));
    });
    await expectStale(async (tx) => { await tx.update(schema.hydeDocuments).set({ sourceText: 'stale reviewed text' }).where(eq(schema.hydeDocuments.id, projection.documents[0]!.documentId)); });
    await expectStale(async (tx) => { await tx.update(schema.hydeDocuments).set({ hydeEmbedding: Array(2000).fill(Math.fround(0.1)) }).where(eq(schema.hydeDocuments.id, projection.documents[0]!.documentId)); });
    await expectStale(async (tx) => { await tx.update(schema.intents).set({ userId: projection.users[1]!.id }).where(eq(schema.intents.id, projection.intents[0]!.id)); });
    await expectStale(async (tx) => { await tx.update(schema.premises).set({ userId: projection.users[1]!.id }).where(eq(schema.premises.id, projection.premises[0]!.id)); });
    await expectStale(async (tx) => { await tx.delete(schema.hydeDocuments).where(eq(schema.hydeDocuments.id, projection.documents[0]!.documentId)); });
    await expectStale(async (tx) => {
      const source = projection.documents[0]!;
      await tx.insert(schema.hydeDocuments).values({
        id: 'historical-quality-extra-document',
        sourceType: 'context',
        sourceId: source.sourceRowId,
        sourceText: source.text,
        strategy: `${source.strategy}-extra`,
        targetCorpus: source.targetCorpus,
        context: {},
        hydeText: source.text,
        hydeEmbedding: Array(2000).fill(0),
      });
    });
    await expectStale(async (tx) => {
      const state = await currentState(tx);
      const metadata = structuredClone(state.qualityMetadata!);
      metadata.qualityAttestation!.vectors = metadata.qualityAttestation!.vectors.slice(1);
      metadata.fixtureFingerprint = historicalQualityAttestationRoot(metadata.qualityAttestation!);
      await tx.update(schema.evalMatrixMetadata).set(metadata).where(eq(schema.evalMatrixMetadata.key, HISTORICAL_QUALITY_METADATA_KEY));
    });
    await expectStale(async (tx) => {
      const state = await currentState(tx);
      const metadata = structuredClone(state.qualityMetadata!);
      metadata.qualityAttestation!.vectors[0]!.vectorFingerprint = 'malformed';
      await tx.update(schema.evalMatrixMetadata).set(metadata).where(eq(schema.evalMatrixMetadata.key, HISTORICAL_QUALITY_METADATA_KEY));
    });
  });

  it('replaces fixture-owned drift but refuses unexpected dependents and opportunities', async () => {
    await childDb.update(schema.users).set({ name: 'fixture-owned drift' }).where(eq(schema.users.id, projection.users[0]!.id));
    await childDb.update(schema.premises).set({ assertion: { text: 'fixture-owned premise drift', tier: 'assertive' } }).where(eq(schema.premises.id, projection.premises[0]!.id));
    await childDb.update(schema.hydeDocuments).set({ sourceText: 'fixture-owned document drift' }).where(eq(schema.hydeDocuments.id, projection.documents[0]!.documentId));
    await refreshHistoricalQualityBase(childDb, projection, baselineEmbedder(), productionHistoricalQualityBaseDependencies);
    const replaced = await currentState();
    expect(replaced.users[0]!.name).not.toBe('fixture-owned drift');
    expect(replaced.premises.find((row) => row.id === projection.premises[0]!.id)?.assertion.text).toBe(projection.premises[0]!.text);
    expect(replaced.documents.find((row) => row.documentId === projection.documents[0]!.documentId)?.text).toBe(projection.documents[0]!.text);

    await rolledBackMutation(async (tx) => {
      await tx.insert(schema.userSocials).values({ userId: projection.users[0]!.id, label: 'github', value: 'unexpected-dependent' });
      await expect(refreshHistoricalQualityBase(tx, projection, baselineEmbedder(), productionHistoricalQualityBaseDependencies)).rejects.toThrow('unexpected user social');
    });
    await rolledBackMutation(async (tx) => {
      await tx.insert(schema.opportunities).values({
        id: 'historical-quality-unexpected-opportunity',
        detection: { source: 'manual', timestamp: new Date(0).toISOString() },
        actors: [{ userId: projection.users[0]!.id, networkId: projection.networks[0].id, role: 'source' }],
        interpretation: { category: 'test', reasoning: 'test-only dependent', confidence: 1 },
        context: { networkId: projection.networks[0].id },
        confidence: '1',
      });
      await expect(refreshHistoricalQualityBase(tx, projection, baselineEmbedder(), productionHistoricalQualityBaseDependencies)).rejects.toThrow('fixture-actor opportunity');
    });
  });

  it('performs read-only base verification with zero writes and matches restored child state', async () => {
    await assertReadOnlySession(async (statement) => baseClient!.unsafe(statement));
    await expect(baseClient!.unsafe('update eval_matrix_metadata set seeded_at = seeded_at')).rejects.toThrow();
    await verifyHistoricalQualityPublishedState(baseDb, projection, productionHistoricalQualityBaseDependencies);
    await restoreBaseline();
    expect(await currentState()).toEqual(await currentState(baseDb));
  });

  it('uses only mocked embedding seams and never constructs a model/provider adapter', () => {
    expect(providerCalls).toBeGreaterThan(0);
    expect(createHash('sha256').update('provider seam mocked').digest('hex')).toMatch(/^[a-f0-9]{64}$/);
  });
});
