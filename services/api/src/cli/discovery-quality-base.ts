import { createHash } from 'node:crypto';

import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm/sql';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import { embeddingConfigurationFingerprint, HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY } from '../lib/embedding/embedding.identity';
import * as schema from '../schemas/database.schema';
import type { HistoricalQualityBaseAttestation } from '../schemas/database.schema';
import { fingerprintHistoricalQualityVector, historicalQualityAttestationRoot, HISTORICAL_QUALITY_METADATA_KEY, parseHistoricalQualityBaseAttestation } from './discovery-quality-attestation';
import { HISTORICAL_QUALITY_APPROVED_FINGERPRINTS } from './discovery-quality.contract';
import { createNeonControlPlane, type NeonControlPlane } from './discovery-env-matrix.neon';
import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget, type AttestedWritableQualityBaseTarget } from './discovery-quality-refresh-target';

export interface HistoricalQualitySeedDocument {
  readonly documentId: string;
  readonly participantId: string;
  readonly sourceRowId: string;
  readonly sourceType: 'premise' | 'context';
  readonly strategy: string;
  readonly targetCorpus: string;
  readonly targetFrame: string;
  readonly text: string;
  readonly sourcePaths: readonly string[];
  readonly contentFingerprint: string;
}

export interface HistoricalSharedPoolSeedProjection {
  readonly users: readonly { readonly id: string }[];
  readonly networks: readonly [{ readonly id: string; readonly title: string; readonly prompt: string }];
  readonly memberships: readonly { readonly networkId: string; readonly userId: string }[];
  readonly intents: readonly { readonly id: string; readonly userId: string; readonly text: string }[];
  readonly intentNetworkAssignments: readonly { readonly networkId: string; readonly intentId: string }[];
  readonly premises: readonly { readonly id: string; readonly participantId: string; readonly userId: string; readonly intentId: string; readonly text: string; readonly sourcePath: string }[];
  readonly contexts: readonly { readonly id: string; readonly participantId: string; readonly userId: string; readonly text: string; readonly sourcePaths: readonly string[] }[];
  readonly documents: readonly HistoricalQualitySeedDocument[];
}

export interface HistoricalQualityEmbeddingIdentity {
  provider: string;
  model: string;
  dimensions: 2000;
  configurationFingerprint: string;
}

export interface HistoricalQualityEmbedder {
  readonly identity: HistoricalQualityEmbeddingIdentity;
  generate(texts: string[]): Promise<number[][]>;
}

export interface HistoricalQualityBaseState {
  users: Array<{ id: string; email: string; name: string; emailVerified: boolean; isGhost: boolean; deletedAt: unknown }>;
  networks: Array<{ id: string; title: string; prompt: string | null; isPersonal: boolean; deletedAt: unknown }>;
  memberships: Array<{ networkId: string; userId: string; permissions: string[]; autoAssign: boolean; deletedAt: unknown }>;
  intents: Array<{ id: string; userId: string; text?: string; payload: string; summary: string | null; sourceType: string | null; sourceId: string | null; status: string | null; isIncognito: boolean; archivedAt: unknown; embedding: number[] | null }>;
  intentNetworkAssignments: Array<{ networkId: string; intentId: string; relevancyScore: string | null }>;
  premises: Array<{ id: string; userId: string; assertion: { text: string; tier: string }; provenance: { source: string; sourceId?: string; confidence: number; timestamp: string }; validity: { volatile: boolean }; status: string; retractedAt: unknown; deletedAt: unknown; embedding: number[] | null }>;
  premiseNetworkAssignments: Array<{ premiseId: string; networkId: string; relevancyScore: string | null }>;
  contexts: Array<{ id: string; userId: string; text: string; networkId: string | null; premiseHash: string | null; embedding: number[] | null }>;
  documents: Array<HistoricalQualitySeedDocument & { embedding: number[] }>;
  qualityMetadata: null | {
    key: string;
    schemaMigrationFingerprint: string;
    fixtureFingerprint: string;
    fixtureCorpusVersion: string;
    qualityAttestation: HistoricalQualityBaseAttestation | null;
  };
  legacyMetadata: Array<{ key: string; qualityAttestation: HistoricalQualityBaseAttestation | null }>;
  fixtureOpportunityIds: string[];
}

export interface HistoricalQualityMetadataRow {
  key: string;
  schemaMigrationFingerprint: string;
  fixtureFingerprint: string;
  fixtureCorpusVersion: string;
  qualityAttestation: HistoricalQualityBaseAttestation;
}

export interface HistoricalQualityBaseDependencies {
  schemaMigrationFingerprint(): Promise<string>;
  observeVisibility?(stage: 'provider-work', db: DrizzleDB): Promise<void>;
  deleteQualityMetadata(db: unknown): Promise<void>;
  assertNoUnexpectedDependents(db: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<void>;
  replaceSeedRows(db: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<void>;
  deleteCandidateDocuments(db: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<void>;
  readState(db: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<HistoricalQualityBaseState>;
  writeCandidateDocuments(db: unknown, documents: readonly HistoricalQualitySeedDocument[], vectors: readonly number[][]): Promise<void>;
  readRoundTrippedVectors(db: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<Array<{ documentId: string; text: string; embedding: number[] }>>;
  insertQualityMetadata(db: unknown, metadata: HistoricalQualityMetadataRow): Promise<void>;
  beforePublishedVerification?(db: unknown): Promise<void>;
}

const PREMISE_PROVENANCE_TIMESTAMP = '2026-08-09T19:02:56.000Z';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprintCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function historicalSharedPoolSeedFingerprint(projection: HistoricalSharedPoolSeedProjection): string {
  return fingerprintCanonicalJson(projection);
}

function historicalRetrievalDocumentFingerprint(documents: readonly HistoricalQualitySeedDocument[]): string {
  return fingerprintCanonicalJson(sorted(documents, (document) => document.documentId));
}

function assertApprovedProjection(projection: HistoricalSharedPoolSeedProjection): void {
  if (historicalSharedPoolSeedFingerprint(projection) !== HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.seedProjectionFingerprint) {
    fail('approved seed projection fingerprint');
  }
  if (historicalRetrievalDocumentFingerprint(projection.documents) !== HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.retrievalDocumentFingerprint) {
    fail('approved retrieval document fingerprint');
  }
}

function assertApprovedEmbeddingIdentity(identity: HistoricalQualityBaseAttestation['embedding']): void {
  const approved = HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY;
  if (identity.provider !== approved.provider || identity.model !== approved.model || identity.dimensions !== approved.dimensions) {
    fail('embedding identity authority');
  }
  if (identity.configurationFingerprint !== embeddingConfigurationFingerprint(identity)) {
    fail('embedding configuration fingerprint');
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sorted<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...rows].sort((left, right) => compareText(key(left), key(right)));
}

function fail(label: string, detail = 'mismatch'): never {
  throw new Error(`Historical quality base integrity failed: ${label} ${detail}`);
}

function assertExactIds(label: string, expected: readonly string[], actual: readonly string[]): void {
  const expectedSorted = [...expected].sort(compareText);
  const actualSorted = [...actual].sort(compareText);
  if (new Set(actual).size !== actual.length || JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) fail(label, 'IDs');
}

function participantByUserId(projection: HistoricalSharedPoolSeedProjection): Map<string, string> {
  return new Map(projection.contexts.map((row) => [row.userId, row.participantId]));
}

function expectedContextDocument(projection: HistoricalSharedPoolSeedProjection, contextId: string): HistoricalQualitySeedDocument {
  const document = projection.documents.find((row) => row.sourceRowId === contextId && row.sourceType === 'context');
  if (!document) fail('context document', contextId);
  return document;
}

function assertSeedRows(state: HistoricalQualityBaseState, projection: HistoricalSharedPoolSeedProjection): void {
  const userIds = projection.users.map((row) => row.id);
  const networkIds = projection.networks.map((row) => row.id);
  const intentIds = projection.intents.map((row) => row.id);
  const premiseIds = projection.premises.map((row) => row.id);
  const contextIds = projection.contexts.map((row) => row.id);
  assertExactIds('user', userIds, state.users.map((row) => row.id));
  assertExactIds('network', networkIds, state.networks.map((row) => row.id));
  assertExactIds('intent', intentIds, state.intents.map((row) => row.id));
  assertExactIds('premise', premiseIds, state.premises.map((row) => row.id));
  assertExactIds('context', contextIds, state.contexts.map((row) => row.id));

  const participants = participantByUserId(projection);
  for (const row of state.users) {
    const participantId = participants.get(row.id);
    if (!participantId || row.email !== `${participantId}@historical-quality.invalid`
      || row.name !== `Historical quality ${participantId}` || row.emailVerified !== false
      || row.isGhost !== false || row.deletedAt !== null) fail('user scalar/lifecycle', row.id);
  }

  const expectedNetworks = new Map(projection.networks.map((row) => [row.id, row]));
  for (const row of state.networks) {
    const expected = expectedNetworks.get(row.id);
    if (!expected || row.title !== expected.title || row.prompt !== expected.prompt || row.isPersonal !== false || row.deletedAt !== null) fail('network scalar/lifecycle', row.id);
  }

  const expectedMemberships = new Set(projection.memberships.map((row) => `${row.networkId}\0${row.userId}`));
  const actualMemberships = new Set(state.memberships.map((row) => `${row.networkId}\0${row.userId}`));
  if (expectedMemberships.size !== actualMemberships.size || [...expectedMemberships].some((key) => !actualMemberships.has(key))) fail('membership', 'mapping');
  for (const row of state.memberships) {
    if (row.permissions.length !== 1 || row.permissions[0] !== 'member' || row.autoAssign !== false || row.deletedAt !== null) fail('membership scalar/lifecycle', `${row.networkId}:${row.userId}`);
  }

  const expectedIntents = new Map(projection.intents.map((row) => [row.id, row]));
  for (const row of state.intents) {
    const expected = expectedIntents.get(row.id);
    if (!expected || row.userId !== expected.userId || row.payload !== expected.text || row.summary !== expected.text
      || row.sourceType !== 'discovery_form' || row.sourceId !== expected.userId || row.status !== 'ACTIVE'
      || row.isIncognito !== false || row.archivedAt !== null || row.embedding !== null) fail('intent scalar/lifecycle', row.id);
  }

  const expectedIntentAssignments = new Set(projection.intentNetworkAssignments.map((row) => `${row.intentId}\0${row.networkId}`));
  const actualIntentAssignments = new Set(state.intentNetworkAssignments.map((row) => `${row.intentId}\0${row.networkId}`));
  if (expectedIntentAssignments.size !== actualIntentAssignments.size || [...expectedIntentAssignments].some((key) => !actualIntentAssignments.has(key))) fail('intent-network assignment', 'mapping');
  for (const row of state.intentNetworkAssignments) if (row.relevancyScore !== '1') fail('intent-network scalar', row.intentId);

  const expectedPremises = new Map(projection.premises.map((row) => [row.id, row]));
  for (const row of state.premises) {
    const expected = expectedPremises.get(row.id);
    if (!expected || row.userId !== expected.userId || row.assertion.text !== expected.text || row.assertion.tier !== 'assertive'
      || row.provenance.source !== 'enrichment' || row.provenance.sourceId !== expected.sourcePath || row.provenance.confidence !== 1
      || row.provenance.timestamp !== PREMISE_PROVENANCE_TIMESTAMP || row.validity.volatile !== false || row.status !== 'ACTIVE' || row.retractedAt !== null || row.deletedAt !== null
      || row.embedding !== null) fail('premise scalar/lifecycle', row.id);
  }
  const expectedPremiseAssignments = new Set(projection.premises.map((row) => `${row.id}\0${projection.networks[0].id}`));
  const actualPremiseAssignments = new Set(state.premiseNetworkAssignments.map((row) => `${row.premiseId}\0${row.networkId}`));
  if (expectedPremiseAssignments.size !== actualPremiseAssignments.size || [...expectedPremiseAssignments].some((key) => !actualPremiseAssignments.has(key))) fail('premise-network assignment', 'mapping');
  for (const row of state.premiseNetworkAssignments) if (row.relevancyScore !== '1') fail('premise-network scalar', row.premiseId);

  const expectedContexts = new Map(projection.contexts.map((row) => [row.id, row]));
  for (const row of state.contexts) {
    const expected = expectedContexts.get(row.id);
    const document = expected ? expectedContextDocument(projection, expected.id) : null;
    if (!expected || !document || row.userId !== expected.userId || row.networkId !== projection.networks[0].id
      || row.text !== expected.text || row.premiseHash !== document.contentFingerprint
      || row.embedding !== null) fail('context scalar/lifecycle', row.id);
  }
  if (state.fixtureOpportunityIds.length > 0) fail('fixture-actor opportunity', state.fixtureOpportunityIds[0]);
}

function assertDocumentRows(state: HistoricalQualityBaseState, projection: HistoricalSharedPoolSeedProjection): HistoricalQualityBaseAttestation {
  const metadata = state.qualityMetadata;
  if (!metadata || metadata.key !== HISTORICAL_QUALITY_METADATA_KEY || metadata.qualityAttestation === null) fail('quality metadata', 'absent');
  const attestation = parseHistoricalQualityBaseAttestation(metadata.qualityAttestation);
  const expectedDocuments = sorted(projection.documents, (row) => row.documentId);
  const actualDocuments = sorted(state.documents, (row) => row.documentId);
  assertExactIds('candidate document', expectedDocuments.map((row) => row.documentId), actualDocuments.map((row) => row.documentId));
  const expectedById = new Map(expectedDocuments.map((row) => [row.documentId, row]));
  const vectors = actualDocuments.map((row) => {
    const expected = expectedById.get(row.documentId);
    if (!expected || row.participantId !== expected.participantId || row.sourceRowId !== expected.sourceRowId
      || row.sourceType !== expected.sourceType || row.strategy !== expected.strategy || row.targetCorpus !== expected.targetCorpus
      || row.targetFrame !== expected.targetFrame || row.text !== expected.text
      || JSON.stringify(row.sourcePaths) !== JSON.stringify(expected.sourcePaths)
      || row.contentFingerprint !== expected.contentFingerprint) fail('candidate document scalar/link', row.documentId);
    if (row.embedding.length !== 2000 || row.embedding.some((value) => !Number.isFinite(value))) fail('candidate vector dimensions/finite', row.documentId);
    return {
      documentId: row.documentId,
      textFingerprint: expected.contentFingerprint,
      vectorFingerprint: fingerprintHistoricalQualityVector(row.embedding),
    };
  });
  if (JSON.stringify(attestation.vectors) !== JSON.stringify(vectors)) fail('vector fingerprint mapping');
  if (attestation.corpusVersion !== HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.corpusVersion
    || attestation.planFingerprint !== HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.planFingerprint
    || attestation.seedProjectionFingerprint !== HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.seedProjectionFingerprint
    || attestation.documentSetFingerprint !== HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.retrievalDocumentFingerprint) {
    fail('attestation approved plan/seed/document mapping');
  }
  assertApprovedEmbeddingIdentity(attestation.embedding);
  if (metadata.fixtureCorpusVersion !== attestation.corpusVersion
    || metadata.fixtureFingerprint !== historicalQualityAttestationRoot(attestation)) fail('metadata object/root mapping');
  return attestation;
}

/** Verifies the exact committed seed state and rejects any published candidate state. */
export async function verifyHistoricalQualitySeedState(
  db: DrizzleDB,
  projection: HistoricalSharedPoolSeedProjection,
  dependencies: HistoricalQualityBaseDependencies = productionHistoricalQualityBaseDependencies,
): Promise<void> {
  assertApprovedProjection(projection);
  const state = await dependencies.readState(db, projection);
  assertSeedRows(state, projection);
  if (state.documents.length !== 0) fail('candidate document', 'present in seed state');
  if (state.qualityMetadata !== null) fail('quality metadata', 'present in seed state');
}

/** Verifies exact seed rows plus atomically published candidate vectors and metadata. */
export async function verifyHistoricalQualityPublishedState(
  db: DrizzleDB,
  projection: HistoricalSharedPoolSeedProjection,
  dependencies: HistoricalQualityBaseDependencies = productionHistoricalQualityBaseDependencies,
): Promise<void> {
  assertApprovedProjection(projection);
  const state = await dependencies.readState(db, projection);
  let attestation: HistoricalQualityBaseAttestation;
  try {
    assertSeedRows(state, projection);
    attestation = assertDocumentRows(state, projection);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Historical quality base integrity failed:')) throw error;
    fail('published state', error instanceof Error ? error.message : 'invalid state');
  }
  const expectedSchemaFingerprint = await dependencies.schemaMigrationFingerprint();
  if (state.qualityMetadata?.schemaMigrationFingerprint !== expectedSchemaFingerprint) fail('schema migration fingerprint mapping');
  if (state.legacyMetadata.some((row) => row.qualityAttestation !== null)) fail('legacy metadata attestation', 'must remain null');
  parseHistoricalQualityBaseAttestation(attestation);
}

function assertProviderVectors(vectors: readonly number[][], documentCount: number): void {
  if (vectors.length !== documentCount) throw new Error('Historical quality embedder returned an unexpected vector count');
  vectors.forEach((vector, index) => {
    if (vector.length !== 2000 || vector.some((value) => !Number.isFinite(value))) {
      throw new Error(`Historical quality provider vector ${index} must contain 2000 finite dimensions`);
    }
  });
}

function buildAttestation(
  projection: HistoricalSharedPoolSeedProjection,
  identity: HistoricalQualityEmbeddingIdentity,
  rows: readonly { documentId: string; text: string; embedding: number[] }[],
): HistoricalQualityBaseAttestation {
  assertApprovedProjection(projection);
  assertApprovedEmbeddingIdentity(identity);
  const expectedDocuments = sorted(projection.documents, (row) => row.documentId);
  const orderedRows = sorted(rows, (row) => row.documentId);
  assertExactIds('round-tripped vector', expectedDocuments.map((row) => row.documentId), orderedRows.map((row) => row.documentId));
  const expectedById = new Map(expectedDocuments.map((row) => [row.documentId, row]));
  const candidate: HistoricalQualityBaseAttestation = {
    version: 1,
    corpusVersion: HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.corpusVersion,
    planFingerprint: HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.planFingerprint,
    seedProjectionFingerprint: HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.seedProjectionFingerprint,
    documentSetFingerprint: HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.retrievalDocumentFingerprint,
    embedding: { ...identity },
    vectors: orderedRows.map((row) => {
      const document = expectedById.get(row.documentId);
      if (!document || row.text !== document.text) fail('round-tripped document text', row.documentId);
      return {
        documentId: row.documentId,
        textFingerprint: document.contentFingerprint,
        vectorFingerprint: fingerprintHistoricalQualityVector(row.embedding),
      };
    }),
  };
  return parseHistoricalQualityBaseAttestation(candidate);
}

/** Commits unpublished seed state, performs provider work, then publishes atomically. */
export async function refreshHistoricalQualityBase(
  db: DrizzleDB,
  projection: HistoricalSharedPoolSeedProjection,
  embedder: HistoricalQualityEmbedder,
  dependencies: HistoricalQualityBaseDependencies = productionHistoricalQualityBaseDependencies,
): Promise<HistoricalQualityBaseAttestation> {
  await db.transaction(async (tx) => {
    await dependencies.deleteQualityMetadata(tx);
    await dependencies.assertNoUnexpectedDependents(tx, projection);
    await dependencies.replaceSeedRows(tx, projection);
    await dependencies.deleteCandidateDocuments(tx, projection);
    await verifyHistoricalQualitySeedState(tx as unknown as DrizzleDB, projection, dependencies);
  });

  await dependencies.observeVisibility?.('provider-work', db);
  const providerVectors = await embedder.generate(projection.documents.map((row) => row.text));
  assertProviderVectors(providerVectors, projection.documents.length);
  const schemaMigrationFingerprint = await dependencies.schemaMigrationFingerprint();

  return db.transaction(async (tx) => {
    await dependencies.writeCandidateDocuments(tx, projection.documents, providerVectors);
    const roundTripped = await dependencies.readRoundTrippedVectors(tx, projection);
    const attestation = buildAttestation(projection, embedder.identity, roundTripped);
    await dependencies.insertQualityMetadata(tx, {
      key: HISTORICAL_QUALITY_METADATA_KEY,
      schemaMigrationFingerprint,
      fixtureFingerprint: historicalQualityAttestationRoot(attestation),
      fixtureCorpusVersion: attestation.corpusVersion,
      qualityAttestation: attestation,
    });
    await dependencies.beforePublishedVerification?.(tx);
    await verifyHistoricalQualityPublishedState(tx as unknown as DrizzleDB, projection, dependencies);
    return attestation;
  });
}

/** Refuses verification unless PostgreSQL confirms a read-only session. */
export async function assertReadOnlySession(query: (statement: string) => Promise<unknown>): Promise<'on'> {
  const result = await query("select current_setting('transaction_read_only') as \"transactionReadOnly\"");
  const rows = Array.isArray(result) ? result : [];
  const transactionReadOnly = rows[0] && typeof rows[0] === 'object'
    ? (rows[0] as { transactionReadOnly?: unknown }).transactionReadOnly
    : undefined;
  if (transactionReadOnly !== 'on') throw new Error('Historical quality base verification session is not read-only');
  return 'on';
}

function qualityContext(document: HistoricalQualitySeedDocument): Record<string, unknown> {
  return {
    participantId: document.participantId,
    sourceType: document.sourceType,
    sourcePaths: document.sourcePaths,
    targetFrame: document.targetFrame,
    contentFingerprint: document.contentFingerprint,
  };
}

async function readProductionState(dbValue: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<HistoricalQualityBaseState> {
  const db = dbValue as DrizzleDB;
  const userIds = projection.users.map((row) => row.id);
  const networkIds = projection.networks.map((row) => row.id);
  const intentIds = projection.intents.map((row) => row.id);
  const premiseIds = projection.premises.map((row) => row.id);
  const contextIds = projection.contexts.map((row) => row.id);
  const documentIds = projection.documents.map((row) => row.documentId);
  const [users, networks, memberships, intents, assignments, premises, premiseAssignments, contexts, documents, metadata, opportunities] = await Promise.all([
    db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, emailVerified: schema.users.emailVerified, isGhost: schema.users.isGhost, deletedAt: schema.users.deletedAt }).from(schema.users).where(inArray(schema.users.id, userIds)),
    db.select({ id: schema.networks.id, title: schema.networks.title, prompt: schema.networks.prompt, isPersonal: schema.networks.isPersonal, deletedAt: schema.networks.deletedAt }).from(schema.networks).where(inArray(schema.networks.id, networkIds)),
    db.select({ networkId: schema.networkMembers.networkId, userId: schema.networkMembers.userId, permissions: schema.networkMembers.permissions, autoAssign: schema.networkMembers.autoAssign, deletedAt: schema.networkMembers.deletedAt }).from(schema.networkMembers).where(or(inArray(schema.networkMembers.userId, userIds), inArray(schema.networkMembers.networkId, networkIds))),
    db.select({ id: schema.intents.id, userId: schema.intents.userId, payload: schema.intents.payload, summary: schema.intents.summary, sourceType: schema.intents.sourceType, sourceId: schema.intents.sourceId, status: schema.intents.status, isIncognito: schema.intents.isIncognito, archivedAt: schema.intents.archivedAt, embedding: schema.intents.embedding }).from(schema.intents).where(or(inArray(schema.intents.id, intentIds), inArray(schema.intents.userId, userIds))),
    db.select({ intentId: schema.intentNetworks.intentId, networkId: schema.intentNetworks.networkId, relevancyScore: schema.intentNetworks.relevancyScore }).from(schema.intentNetworks).where(or(inArray(schema.intentNetworks.intentId, intentIds), inArray(schema.intentNetworks.networkId, networkIds))),
    db.select({ id: schema.premises.id, userId: schema.premises.userId, assertion: schema.premises.assertion, provenance: schema.premises.provenance, validity: schema.premises.validity, status: schema.premises.status, retractedAt: schema.premises.retractedAt, deletedAt: schema.premises.deletedAt, embedding: schema.premises.embedding }).from(schema.premises).where(or(inArray(schema.premises.id, premiseIds), inArray(schema.premises.userId, userIds))),
    db.select({ premiseId: schema.premiseNetworks.premiseId, networkId: schema.premiseNetworks.networkId, relevancyScore: schema.premiseNetworks.relevancyScore }).from(schema.premiseNetworks).where(or(inArray(schema.premiseNetworks.premiseId, premiseIds), inArray(schema.premiseNetworks.networkId, networkIds))),
    db.select({ id: schema.userContexts.id, userId: schema.userContexts.userId, networkId: schema.userContexts.networkId, text: schema.userContexts.text, premiseHash: schema.userContexts.premiseHash, embedding: schema.userContexts.embedding }).from(schema.userContexts).where(or(inArray(schema.userContexts.id, contextIds), inArray(schema.userContexts.userId, userIds), inArray(schema.userContexts.networkId, networkIds))),
    db.select({ id: schema.hydeDocuments.id, sourceId: schema.hydeDocuments.sourceId, sourceText: schema.hydeDocuments.sourceText, strategy: schema.hydeDocuments.strategy, targetCorpus: schema.hydeDocuments.targetCorpus, context: schema.hydeDocuments.context, hydeText: schema.hydeDocuments.hydeText, embedding: schema.hydeDocuments.hydeEmbedding }).from(schema.hydeDocuments).where(or(inArray(schema.hydeDocuments.id, documentIds), inArray(schema.hydeDocuments.sourceId, [...premiseIds, ...contextIds]))),
    db.select({ key: schema.evalMatrixMetadata.key, schemaMigrationFingerprint: schema.evalMatrixMetadata.schemaMigrationFingerprint, fixtureFingerprint: schema.evalMatrixMetadata.fixtureFingerprint, fixtureCorpusVersion: schema.evalMatrixMetadata.fixtureCorpusVersion, qualityAttestation: schema.evalMatrixMetadata.qualityAttestation }).from(schema.evalMatrixMetadata),
    db.select({ id: schema.opportunities.id, actors: schema.opportunities.actors }).from(schema.opportunities),
  ]);
  const documentProjection = new Map(projection.documents.map((row) => [row.documentId, row]));
  const qualityMetadata = metadata.find((row) => row.key === HISTORICAL_QUALITY_METADATA_KEY) ?? null;
  return {
    users,
    networks,
    memberships,
    intents,
    intentNetworkAssignments: assignments,
    premises,
    premiseNetworkAssignments: premiseAssignments,
    contexts,
    documents: documents.map((row) => {
      const expected = documentProjection.get(row.id);
      const context = row.context && typeof row.context === 'object' ? row.context as Record<string, unknown> : {};
      return {
        documentId: row.id,
        participantId: String(context.participantId ?? ''),
        sourceRowId: row.sourceId ?? '',
        sourceType: context.sourceType === 'premise' ? 'premise' as const : 'context' as const,
        strategy: row.strategy,
        targetCorpus: row.targetCorpus,
        targetFrame: String(context.targetFrame ?? ''),
        text: row.sourceText ?? row.hydeText,
        sourcePaths: Array.isArray(context.sourcePaths) ? context.sourcePaths.map(String) : [],
        contentFingerprint: String(context.contentFingerprint ?? expected?.contentFingerprint ?? ''),
        embedding: row.embedding,
      };
    }),
    qualityMetadata,
    legacyMetadata: metadata.filter((row) => row.key !== HISTORICAL_QUALITY_METADATA_KEY).map((row) => ({ key: row.key, qualityAttestation: row.qualityAttestation })),
    fixtureOpportunityIds: opportunities.filter((row) => Array.isArray(row.actors) && row.actors.some((actor) => userIds.includes(String(actor.userId)))).map((row) => row.id),
  };
}

async function assertNoUnexpectedProductionDependents(dbValue: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<void> {
  const db = dbValue as DrizzleDB;
  const userIds = projection.users.map((row) => row.id);
  const networkIds = projection.networks.map((row) => row.id);
  const intentIds = projection.intents.map((row) => row.id);
  const premiseIds = projection.premises.map((row) => row.id);
  const contextIds = projection.contexts.map((row) => row.id);
  const documentIds = projection.documents.map((row) => row.documentId);
  const checks: Array<{ label: string; rows: Promise<Array<{ id: string }>> }> = [
    { label: 'user social', rows: db.select({ id: schema.userSocials.id }).from(schema.userSocials).where(inArray(schema.userSocials.userId, userIds)).limit(1) },
    { label: 'unexpected fixture intent', rows: db.select({ id: schema.intents.id }).from(schema.intents).where(and(inArray(schema.intents.userId, userIds), notInArray(schema.intents.id, intentIds))).limit(1) },
    { label: 'unexpected fixture premise', rows: db.select({ id: schema.premises.id }).from(schema.premises).where(and(inArray(schema.premises.userId, userIds), notInArray(schema.premises.id, premiseIds))).limit(1) },
    { label: 'unexpected fixture context', rows: db.select({ id: schema.userContexts.id }).from(schema.userContexts).where(and(or(inArray(schema.userContexts.userId, userIds), inArray(schema.userContexts.networkId, networkIds)), notInArray(schema.userContexts.id, contextIds))).limit(1) },
    { label: 'unexpected intent network', rows: db.select({ id: schema.intentNetworks.intentId }).from(schema.intentNetworks).where(and(inArray(schema.intentNetworks.intentId, intentIds), notInArray(schema.intentNetworks.networkId, networkIds))).limit(1) },
    { label: 'unexpected premise network', rows: db.select({ id: schema.premiseNetworks.premiseId }).from(schema.premiseNetworks).where(and(inArray(schema.premiseNetworks.premiseId, premiseIds), notInArray(schema.premiseNetworks.networkId, networkIds))).limit(1) },
    { label: 'unexpected fixture membership', rows: db.select({ id: schema.networkMembers.userId }).from(schema.networkMembers).where(or(and(inArray(schema.networkMembers.networkId, networkIds), notInArray(schema.networkMembers.userId, userIds)), and(inArray(schema.networkMembers.userId, userIds), notInArray(schema.networkMembers.networkId, networkIds)))).limit(1) },
    { label: 'intent proposal', rows: db.select({ id: schema.intentProposals.id }).from(schema.intentProposals).where(inArray(schema.intentProposals.consumedIntentId, intentIds)).limit(1) },
    { label: 'intent verification attempt', rows: db.select({ id: schema.intentVerificationBackfillAttempts.intentId }).from(schema.intentVerificationBackfillAttempts).where(inArray(schema.intentVerificationBackfillAttempts.intentId, intentIds)).limit(1) },
    { label: 'unexpected candidate document', rows: db.select({ id: schema.hydeDocuments.id }).from(schema.hydeDocuments).where(and(inArray(schema.hydeDocuments.sourceId, [...premiseIds, ...contextIds]), notInArray(schema.hydeDocuments.id, documentIds))).limit(1) },
  ];
  for (const check of checks) {
    const [row] = await check.rows;
    if (row) throw new Error(`Refusing historical quality base refresh: unexpected ${check.label} ${row.id}`);
  }
  const state = await readProductionState(db, projection);
  if (state.fixtureOpportunityIds[0]) throw new Error(`Refusing historical quality base refresh: fixture-actor opportunity ${state.fixtureOpportunityIds[0]}`);
}

async function replaceProductionSeedRows(dbValue: unknown, projection: HistoricalSharedPoolSeedProjection): Promise<void> {
  const db = dbValue as DrizzleDB;
  const userIds = projection.users.map((row) => row.id);
  const intentIds = projection.intents.map((row) => row.id);
  const premiseIds = projection.premises.map((row) => row.id);
  const contextIds = projection.contexts.map((row) => row.id);
  const networkId = projection.networks[0].id;
  const participants = participantByUserId(projection);
  await db.delete(schema.premiseNetworks).where(inArray(schema.premiseNetworks.premiseId, premiseIds));
  await db.delete(schema.premises).where(inArray(schema.premises.id, premiseIds));
  await db.delete(schema.userContexts).where(inArray(schema.userContexts.id, contextIds));
  await db.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, intentIds));
  await db.delete(schema.intents).where(inArray(schema.intents.id, intentIds));
  for (const membership of projection.memberships) await db.delete(schema.networkMembers).where(and(eq(schema.networkMembers.networkId, membership.networkId), eq(schema.networkMembers.userId, membership.userId)));
  await db.insert(schema.users).values(projection.users.map(({ id }) => {
    const participantId = participants.get(id)!;
    return { id, email: `${participantId}@historical-quality.invalid`, name: `Historical quality ${participantId}`, emailVerified: false, isGhost: false, deletedAt: null };
  })).onConflictDoUpdate({ target: schema.users.id, set: { email: sql`excluded.email`, name: sql`excluded.name`, emailVerified: false, isGhost: false, deletedAt: null } });
  await db.insert(schema.networks).values(projection.networks.map((row) => ({ ...row, isPersonal: false, deletedAt: null }))).onConflictDoUpdate({ target: schema.networks.id, set: { title: sql`excluded.title`, prompt: sql`excluded.prompt`, isPersonal: false, deletedAt: null } });
  await db.insert(schema.networkMembers).values(projection.memberships.map((row) => ({ ...row, permissions: ['member'], autoAssign: false, deletedAt: null })));
  await db.insert(schema.intents).values(projection.intents.map((row) => ({ id: row.id, userId: row.userId, payload: row.text, summary: row.text, sourceType: 'discovery_form' as const, sourceId: row.userId, status: 'ACTIVE' as const, isIncognito: false, archivedAt: null, embedding: null })));
  await db.insert(schema.intentNetworks).values(projection.intentNetworkAssignments.map((row) => ({ ...row, relevancyScore: '1' })));
  await db.insert(schema.premises).values(projection.premises.map((row) => ({ id: row.id, userId: row.userId, assertion: { text: row.text, tier: 'assertive' as const }, provenance: { source: 'enrichment' as const, sourceId: row.sourcePath, confidence: 1, timestamp: PREMISE_PROVENANCE_TIMESTAMP }, validity: { volatile: false }, status: 'ACTIVE' as const, retractedAt: null, deletedAt: null, embedding: null })));
  await db.insert(schema.premiseNetworks).values(projection.premises.map((row) => ({ premiseId: row.id, networkId, relevancyScore: '1' })));
  await db.insert(schema.userContexts).values(projection.contexts.map((row) => ({ id: row.id, userId: row.userId, networkId, text: row.text, premiseHash: expectedContextDocument(projection, row.id).contentFingerprint, embedding: null })));
  if (userIds.length !== 25) fail('named projection user cardinality');
}

const QUALITY_BASE_RUNTIME_PATH = new URL('./discovery-quality-base.runtime.ts', import.meta.url).pathname;

type QualityBaseRuntimeChild = {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
};
export type QualityBaseRuntimeSpawnOptions = {
  cmd: string[];
  env: NodeJS.ProcessEnv;
  stdout: 'pipe';
  stderr: 'pipe';
};
export type QualityBaseRuntimeSpawn = (options: QualityBaseRuntimeSpawnOptions) => QualityBaseRuntimeChild;

async function discardRuntimeOutput(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* discard untrusted output */ }
}

function verifierEnvironment(env: NodeJS.ProcessEnv, databaseUrl: string): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  const secretPrefix = /^(OPENROUTER|OPENAI|ANTHROPIC|GOOGLE|GEMINI|MISTRAL|COHERE|TOGETHER|FIREWORKS|PERPLEXITY|REDIS|NEON|EMBEDDING|CHAT|EVAL|SMARTEST)_/;
  for (const [key, value] of Object.entries(env)) {
    if (!secretPrefix.test(key) && key !== 'DISCOVERY_QUALITY_BASE_REFRESH_TARGET') clean[key] = value;
  }
  const readOnlyOption = '-c transaction_read_only=on';
  clean.PGOPTIONS = clean.PGOPTIONS ? `${clean.PGOPTIONS} ${readOnlyOption}` : readOnlyOption;
  clean.DATABASE_URL = databaseUrl;
  return clean;
}

/** Starts the already-attested runtime in a fresh process. */
export async function handoffHistoricalQualityBaseRuntime(input: {
  target: AttestedWritableQualityBaseTarget;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  runtimePath?: string;
  spawn?: QualityBaseRuntimeSpawn;
}): Promise<string> {
  const verifyOnly = input.args.includes('--verify');
  const sourceEnv = input.env ?? process.env;
  const { NEON_API_KEY: _neonApiKey, DISCOVERY_QUALITY_BASE_REFRESH_TARGET: _target, ...refreshEnv } = sourceEnv;
  const env = verifyOnly
    ? verifierEnvironment(sourceEnv, input.target.databaseUrl)
    : { ...refreshEnv, DATABASE_URL: input.target.databaseUrl };
  const options: QualityBaseRuntimeSpawnOptions = {
    cmd: [process.execPath, input.runtimePath ?? QUALITY_BASE_RUNTIME_PATH, ...input.args],
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  };
  const child = input.spawn ? input.spawn(options) : Bun.spawn(options) as QualityBaseRuntimeChild;
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(''),
    discardRuntimeOutput(child.stderr),
  ]);
  if (exitCode !== 0) throw new Error('Historical quality base runtime child exited unsuccessfully');
  return stdout;
}

/** Parses and attests the writable target before binding any database runtime. */
export async function runHistoricalQualityBaseBootstrap(input: {
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  controlPlane?: NeonControlPlane;
  handoff?: (target: AttestedWritableQualityBaseTarget, args: readonly string[]) => Promise<string>;
}): Promise<string> {
  const env = input.env ?? process.env;
  const target = parseQualityBaseRefreshTarget(env.DISCOVERY_QUALITY_BASE_REFRESH_TARGET);
  const attested = await attestWritableQualityBaseTarget({
    target,
    controlPlane: input.controlPlane ?? createNeonControlPlane(env.NEON_API_KEY ?? ''),
  });
  return (input.handoff ?? ((boundTarget, args) => handoffHistoricalQualityBaseRuntime({ target: boundTarget, args, env })))(attested, input.args);
}

export const productionHistoricalQualityBaseDependencies: HistoricalQualityBaseDependencies = {
  schemaMigrationFingerprint: async () => (await import('./discovery-env-matrix-base.main')).computeSchemaMigrationFingerprint(),
  deleteQualityMetadata: async (dbValue) => { await (dbValue as DrizzleDB).delete(schema.evalMatrixMetadata).where(eq(schema.evalMatrixMetadata.key, HISTORICAL_QUALITY_METADATA_KEY)); },
  assertNoUnexpectedDependents: assertNoUnexpectedProductionDependents,
  replaceSeedRows: replaceProductionSeedRows,
  deleteCandidateDocuments: async (dbValue, projection) => { await (dbValue as DrizzleDB).delete(schema.hydeDocuments).where(inArray(schema.hydeDocuments.id, projection.documents.map((row) => row.documentId))); },
  readState: readProductionState,
  writeCandidateDocuments: async (dbValue, documents, vectors) => {
    await (dbValue as DrizzleDB).insert(schema.hydeDocuments).values(documents.map((document, index) => ({
      id: document.documentId,
      sourceType: 'context' as const,
      sourceId: document.sourceRowId,
      sourceText: document.text,
      strategy: document.strategy,
      targetCorpus: document.targetCorpus,
      context: qualityContext(document),
      hydeText: document.text,
      hydeEmbedding: vectors[index]!,
      expiresAt: null,
    })));
  },
  readRoundTrippedVectors: async (dbValue, projection) => (dbValue as DrizzleDB)
    .select({ documentId: schema.hydeDocuments.id, text: schema.hydeDocuments.sourceText, embedding: schema.hydeDocuments.hydeEmbedding })
    .from(schema.hydeDocuments)
    .where(inArray(schema.hydeDocuments.id, projection.documents.map((row) => row.documentId)))
    .orderBy(schema.hydeDocuments.id)
    .then((rows) => rows.map((row) => ({ documentId: row.documentId, text: row.text ?? '', embedding: row.embedding }))),
  insertQualityMetadata: async (dbValue, metadata) => { await (dbValue as DrizzleDB).insert(schema.evalMatrixMetadata).values({ ...metadata, seededAt: new Date() }); },
};

if (import.meta.main) runHistoricalQualityBaseBootstrap({ args: process.argv.slice(2) })
  .then((stdout) => { if (stdout) process.stdout.write(stdout); })
  .catch(() => {
    console.error('Historical quality base command failed');
    process.exitCode = 1;
  });
