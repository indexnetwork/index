import { createHash, createHmac, randomBytes } from 'node:crypto';

import type { HydeEvalCase } from './hyde.types.js';
import { HYDE_BLIND_PRIVATE_KEY_ARTIFACT_TYPE, HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE, HYDE_CANDIDATE_RUBRIC, HYDE_CANDIDATE_TASK_KIND, HYDE_COLLECTION_ARTIFACT_TYPE, HYDE_GROUNDING_RUBRIC, HYDE_GROUNDING_TASK_KIND, HydeAnalysisArtifactSchema, HydeBlindPrivateKeySchema, HydeBlindPublicBatchSchema, HydeCollectionArtifactSchema, type HydeAnalysisArtifact, type HydeBlindPrivateKey, type HydeBlindPrivateMapping, type HydeBlindPublicBatch, type HydeBlindPublicItem, type HydeCollectionArtifact } from './hyde.schemas.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_CANONICAL_RUNS, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_CASE_COUNT, HYDE_RUBRIC_VERSION } from './hyde.policy.js';

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareAscii(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Stable JSON SHA-256 used for artifact parent and batch fingerprints. */
export function fingerprintHydeArtifact(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

/** Parse and strictly validate a collection boundary artifact. */
export function parseHydeCollectionArtifact(value: unknown): HydeCollectionArtifact {
  return HydeCollectionArtifactSchema.parse(value);
}

/** Parse and strictly validate a canonical analysis boundary artifact. */
export function parseHydeAnalysisArtifact(value: unknown): HydeAnalysisArtifact {
  return HydeAnalysisArtifactSchema.parse(value);
}

/** Parse a blind public batch and verify its content fingerprint. */
export function parseHydeBlindPublicBatch(value: unknown): HydeBlindPublicBatch {
  const parsed = HydeBlindPublicBatchSchema.parse(value);
  const { batchFingerprint: _batchFingerprint, ...content } = parsed;
  if (fingerprintHydeArtifact(content) !== parsed.batchFingerprint) {
    throw new Error('Blind public batch fingerprint does not match its content');
  }
  return parsed;
}

/** Parse and strictly validate a private blind mapping artifact. */
export function parseHydeBlindPrivateKey(value: unknown): HydeBlindPrivateKey {
  return HydeBlindPrivateKeySchema.parse(value);
}

export const parseCollectionArtifact = parseHydeCollectionArtifact;
export const parseAnalysisArtifact = parseHydeAnalysisArtifact;
export const parseBlindPublicBatch = parseHydeBlindPublicBatch;
export const parseBlindPrivateKey = parseHydeBlindPrivateKey;

export interface BuildBlindExportOptions {
  /** Fixed test/replay secret. Production callers should omit this. */
  secret?: string | Uint8Array;
  createdAt?: string;
}

export interface HydeCandidateJudgmentTemplateItem {
  opaqueId: string;
  taskKind: typeof HYDE_CANDIDATE_TASK_KIND;
  relevanceGrade: null;
}

export interface HydeGroundingJudgmentTemplateItem {
  opaqueId: string;
  taskKind: typeof HYDE_GROUNDING_TASK_KIND;
  grounding: null;
  unsupportedAdditions: [];
}

export interface HydeJudgmentTemplate {
  batchFingerprint: string;
  items: Array<HydeCandidateJudgmentTemplateItem | HydeGroundingJudgmentTemplateItem>;
}

export interface HydeBlindExport {
  publicBatch: HydeBlindPublicBatch;
  privateKey: HydeBlindPrivateKey;
  judgmentTemplate: HydeJudgmentTemplate;
}

interface UnblindedCandidateItem {
  locator: string;
  publicItem: Omit<Extract<HydeBlindPublicItem, { taskKind: 'candidate-relevance' }>, 'opaqueId'>;
  privateMapping: Omit<Extract<HydeBlindPrivateMapping, { taskKind: 'candidate-relevance' }>, 'opaqueId'>;
}

interface UnblindedGroundingItem {
  locator: string;
  publicItem: Omit<Extract<HydeBlindPublicItem, { taskKind: 'generated-document-grounding' }>, 'opaqueId'>;
  privateMapping: Omit<Extract<HydeBlindPrivateMapping, { taskKind: 'generated-document-grounding' }>, 'opaqueId'>;
}

type UnblindedItem = UnblindedCandidateItem | UnblindedGroundingItem;

function encodedSecret(secret: string | Uint8Array | undefined): string {
  if (typeof secret === 'string') return secret;
  if (secret) return Buffer.from(secret).toString('base64url');
  return randomBytes(32).toString('base64url');
}

function blindId(secret: string, locator: string): string {
  return `blind-${createHmac('sha256', secret).update(locator).digest('hex')}`;
}

function assertCollectionHasCompleteEvidence(collection: HydeCollectionArtifact): void {
  if (!collection.canonicality.candidate || collection.canonicality.reasons.length > 0) {
    throw new Error('Blind export requires collection.canonicality.candidate=true with no noncanonical reasons');
  }
  if (collection.candidateEmbeddingSetups.some((setup) => setup.status !== 'completed')) {
    throw new Error('Blind export rejects every candidate embedding setup failure');
  }
  const expectedPairs = new Set(collection.config.selectedCaseIds.flatMap((caseId) =>
    Array.from({ length: collection.config.runs }, (_, index) => `${caseId}\0${index + 1}`)));
  const blocksByPair = new Map(collection.pairedBlocks.map((block) => [`${block.caseId}\0${block.run}`, block]));
  if (expectedPairs.size !== blocksByPair.size
    || [...expectedPairs].some((key) => {
      const block = blocksByPair.get(key);
      return !block || block.legacy.status !== 'completed' || block.frameV1.status !== 'completed';
    })) {
    throw new Error('Blind export rejects every failed or missing legacy/frame-v1 slot');
  }
}

function assertCorpusMatchesCollection(collection: HydeCollectionArtifact, cases: readonly HydeEvalCase[]): void {
  if (collection.config.selectedCaseIds.length !== HYDE_EXPECTED_CASE_COUNT || collection.config.runs !== HYDE_CANONICAL_RUNS) {
    throw new Error(`Blind export requires a full ${HYDE_EXPECTED_CASE_COUNT}-case, ${HYDE_CANONICAL_RUNS}-run collection; filtered/debug exports are unsupported`);
  }
  if (cases.length !== HYDE_EXPECTED_CASE_COUNT) throw new Error(`Blind export requires ${HYDE_EXPECTED_CASE_COUNT} cases, got ${cases.length}`);
  const caseIds = cases.map((entry) => entry.id);
  if (new Set(caseIds).size !== caseIds.length) throw new Error('Blind export case IDs must be unique');
  if (JSON.stringify(caseIds) !== JSON.stringify(collection.config.selectedCaseIds)) {
    throw new Error('Blind export cases must match collection selectedCaseIds in order');
  }
  const candidateIds = cases.flatMap((entry) => entry.candidates.map((candidate) => candidate.id));
  if (candidateIds.length !== HYDE_EXPECTED_CANDIDATE_COUNT || new Set(candidateIds).size !== HYDE_EXPECTED_CANDIDATE_COUNT) {
    throw new Error(`Blind export requires exactly ${HYDE_EXPECTED_CANDIDATE_COUNT} unique candidates, got ${candidateIds.length}`);
  }
}

function collectUnblindedItems(
  collection: HydeCollectionArtifact,
  cases: readonly HydeEvalCase[],
): UnblindedItem[] {
  const casesById = new Map(cases.map((entry) => [entry.id, entry]));
  const items: UnblindedItem[] = [];

  for (const c of cases) {
    for (const candidate of c.candidates) {
      items.push({
        locator: `candidate\0${candidate.id}`,
        publicItem: {
          taskKind: HYDE_CANDIDATE_TASK_KIND,
          rubric: HYDE_CANDIDATE_RUBRIC,
          sourceText: c.sourceText,
          itemText: candidate.text,
        },
        privateMapping: {
          taskKind: HYDE_CANDIDATE_TASK_KIND,
          candidateId: candidate.id,
        },
      });
    }
  }

  for (const block of collection.pairedBlocks) {
    const c = casesById.get(block.caseId);
    if (!c) throw new Error(`Collection block references unknown case ${block.caseId}`);
    for (const [slotKey, mode] of [['legacy', 'legacy'], ['frameV1', 'frame-v1']] as const) {
      const slot = block[slotKey];
      if (slot.status !== 'completed') continue;
      slot.result.documents.forEach((document, documentIndex) => {
        items.push({
          locator: `grounding\0${block.caseId}\0${block.run}\0${mode}\0${documentIndex}`,
          publicItem: {
            taskKind: HYDE_GROUNDING_TASK_KIND,
            rubric: HYDE_GROUNDING_RUBRIC,
            sourceText: c.sourceText,
            itemText: document.text,
          },
          privateMapping: {
            taskKind: HYDE_GROUNDING_TASK_KIND,
            caseId: block.caseId,
            run: block.run,
            mode,
            documentIndex,
          },
        });
      });
    }
  }
  return items;
}

/**
 * Build the public adjudication batch and its private re-identification key.
 * Only source text and judged text cross the public boundary.
 */
export function buildBlindExport(
  collectionValue: HydeCollectionArtifact,
  cases: readonly HydeEvalCase[],
  options: BuildBlindExportOptions = {},
): HydeBlindExport {
  const collection = parseHydeCollectionArtifact(collectionValue);
  assertCollectionHasCompleteEvidence(collection);
  assertCorpusMatchesCollection(collection, cases);
  const secret = encodedSecret(options.secret);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const collectionFingerprint = fingerprintHydeArtifact(collection);
  const unblinded = collectUnblindedItems(collection, cases);
  const blinded = unblinded.map((item) => ({
    opaqueId: blindId(secret, item.locator),
    item,
  })).sort((left, right) => compareAscii(left.opaqueId, right.opaqueId));
  if (new Set(blinded.map((entry) => entry.opaqueId)).size !== blinded.length) {
    throw new Error('HMAC collision while building blind export');
  }

  const publicItems: HydeBlindPublicItem[] = blinded.map(({ opaqueId, item }) => ({
    opaqueId,
    ...item.publicItem,
  })) as HydeBlindPublicItem[];
  const mappings: HydeBlindPrivateMapping[] = blinded.map(({ opaqueId, item }) => ({
    opaqueId,
    ...item.privateMapping,
  })) as HydeBlindPrivateMapping[];
  const publicContent = {
    artifactType: HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    studyId: collection.studyId,
    createdAt,
    rubricVersion: HYDE_RUBRIC_VERSION,
    collectionFingerprint,
    corpusFingerprint: collection.corpusFingerprint,
    configFingerprint: collection.configFingerprint,
    items: publicItems,
  };
  const batchFingerprint = fingerprintHydeArtifact(publicContent);
  const publicBatch = parseHydeBlindPublicBatch({
    ...publicContent,
    batchFingerprint,
  });
  const privateKey = parseHydeBlindPrivateKey({
    artifactType: HYDE_BLIND_PRIVATE_KEY_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    studyId: collection.studyId,
    createdAt,
    batchFingerprint,
    collectionFingerprint,
    corpusFingerprint: collection.corpusFingerprint,
    configFingerprint: collection.configFingerprint,
    hmacSecret: secret,
    mappings,
  });

  return {
    publicBatch,
    privateKey,
    judgmentTemplate: {
      batchFingerprint,
      items: publicBatch.items.map((item) => item.taskKind === HYDE_CANDIDATE_TASK_KIND
        ? { opaqueId: item.opaqueId, taskKind: item.taskKind, relevanceGrade: null }
        : { opaqueId: item.opaqueId, taskKind: item.taskKind, grounding: null, unsupportedAdditions: [] }),
    },
  };
}

// Preserve an explicit import-time boundary name for artifact readers.
export { HYDE_COLLECTION_ARTIFACT_TYPE };
