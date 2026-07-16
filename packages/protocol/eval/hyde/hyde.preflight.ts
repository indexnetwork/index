import { createHash } from 'node:crypto';

import { fingerprintHydeArtifact, parseHydeCollectionArtifact } from './hyde.artifacts.js';
import { assertFrozenHydeCorpus, HYDE_CASES, HYDE_CORPUS_FINGERPRINT } from './hyde.cases.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, HYDE_BACKGROUND_SOURCES, HYDE_BOOTSTRAP_SEED, HYDE_CANONICAL_EMBEDDING_PIN, HYDE_CANONICAL_FRAME_GENERATION_VERSION, HYDE_CANONICAL_MODEL_PINS, HYDE_CANONICAL_PROVENANCE_PINS, HYDE_CANONICAL_RUNS, HYDE_CORPUS_VERSION, HYDE_EXECUTION_SEED, HYDE_EXPECTED_CASE_COUNT, HYDE_EXPECTED_PAIR_COUNT, HYDE_GATE_POLICY_VERSION, HYDE_LENS_BONUS, HYDE_MAX_LENSES, HYDE_MIN_SCORE, HYDE_RUBRIC_VERSION } from './hyde.policy.js';
import type { HydeCollectionArtifact } from './hyde.schemas.js';
import type { HydeEvalCase } from './hyde.types.js';

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return fingerprintHydeArtifact(left) === fingerprintHydeArtifact(right);
}

function uniqueReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons)].sort(compareAscii);
}

function caseRunHash(executionSeed: number, caseId: string, run: number): string {
  return createHash('sha256')
    .update(String(executionSeed))
    .update('\0')
    .update(caseId)
    .update('\0')
    .update(String(run))
    .digest('hex');
}

function canonicalSchedule(caseIds: readonly string[]) {
  const half = HYDE_CANONICAL_RUNS / 2;
  return caseIds.flatMap((caseId) => Array.from({ length: HYDE_CANONICAL_RUNS }, (_, index) => ({
    caseId,
    run: index + 1,
    hash: caseRunHash(HYDE_EXECUTION_SEED, caseId, index + 1),
  })).sort((left, right) => compareAscii(left.hash, right.hash) || left.run - right.run)
    .map((entry, index) => ({
      ...entry,
      modeOrder: index < half
        ? ['legacy', 'frame-v1'] as const
        : ['frame-v1', 'legacy'] as const,
    }))).sort((left, right) => compareAscii(left.hash, right.hash)
      || compareAscii(left.caseId, right.caseId)
      || left.run - right.run)
    .map((entry, executionOrdinal) => ({ ...entry, executionOrdinal }));
}

function expectedConfigFingerprint(collection: HydeCollectionArtifact): string {
  const schedule = [...collection.pairedBlocks]
    .sort((left, right) => left.executionOrdinal - right.executionOrdinal)
    .map((block) => ({
      caseId: block.caseId,
      run: block.run,
      hash: caseRunHash(collection.config.seeds.execution, block.caseId, block.run),
      modeOrder: block.modeOrder,
    }));
  return fingerprintHydeArtifact({
    policyVersion: collection.policyVersion,
    config: collection.config,
    policyPins: HYDE_CANONICAL_PROVENANCE_PINS,
    models: collection.provenance.models,
    embedding: collection.provenance.embedding,
    generationVersion: collection.provenance.generationVersion,
    backgroundSourceGraphMapping: collection.provenance.backgroundSourceGraphMapping,
    schedule,
  });
}

type CompletedSlot = Extract<HydeCollectionArtifact['pairedBlocks'][number]['legacy'], { status: 'completed' }>;
type RunResult = CompletedSlot['result'];

function validateRunResult(
  result: RunResult,
  c: HydeEvalCase,
  cutoff: number,
  lensBonus: number,
  reasons: string[],
): void {
  const authored = new Map(c.candidates.map((candidate) => [candidate.id, candidate]));
  const authoredIds = c.candidates.map((candidate) => candidate.id);
  const scoreIds = result.allCandidateScores.map((score) => score.candidateId);
  if (!sameJson(scoreIds, authoredIds)) {
    reasons.push(`Candidate score IDs are not the exact authored order for ${result.caseId} run ${result.run} ${result.mode}`);
  }
  if (new Set(scoreIds).size !== scoreIds.length) {
    reasons.push(`Candidate score IDs are not unique for ${result.caseId} run ${result.run} ${result.mode}`);
  }

  const returnedLensIds = new Set(
    result.documents.filter((document) => document.returned).map((document) => document.lens),
  );
  for (const score of result.allCandidateScores) {
    const candidate = authored.get(score.candidateId);
    if (!candidate) continue;
    if (score.role !== candidate.role || score.relevanceGrade !== candidate.relevanceGrade
      || score.corpus !== candidate.corpus
      || !sameJson(score.hardNegativeOf, candidate.hardNegativeOf)) {
      reasons.push(`Candidate corpus linkage or authored diagnostic metadata mismatch for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    const lensMatchIds = score.lensMatches.map((match) => match.lensId);
    if (new Set(lensMatchIds).size !== lensMatchIds.length) {
      reasons.push(`Candidate raw lens-match IDs are not unique for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    if (score.lensMatches.length !== result.returnedDocumentCount) {
      reasons.push(`Candidate raw lens-match count does not cover every returned document for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    if (lensMatchIds.some((lensId) => !returnedLensIds.has(lensId))) {
      reasons.push(`Candidate raw lens-match ID does not identify a returned generated document for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    const recomputedMaxCosine = score.lensMatches.length === 0
      ? 0
      : Math.max(...score.lensMatches.map((match) => match.cosine));
    if (score.maxCosine !== recomputedMaxCosine) {
      reasons.push(`Candidate max cosine does not match retained per-lens cosines for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    const recomputedQualifying = score.lensMatches.filter((match) => match.cosine >= cutoff);
    const recomputedMatchedLensIds = recomputedQualifying.map((match) => match.lensId);
    if (score.qualifyingMatchCount !== recomputedQualifying.length) {
      reasons.push(`Candidate qualifying-match count does not match retained per-lens cosines for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    if (!sameJson(score.matchedLensIds, recomputedMatchedLensIds)) {
      reasons.push(`Candidate matched-lens IDs do not match retained per-lens cosines for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    if (score.qualifyingMatchCount > result.lensCount
      || score.qualifyingMatchCount > result.returnedDocumentCount) {
      reasons.push(`Candidate qualifying-match count exceeds available lenses/documents for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    const recomputedQualified = recomputedQualifying.length > 0;
    if (score.qualified !== recomputedQualified) {
      reasons.push(`Candidate qualification does not match retained per-lens cosines for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
    const recomputedScore = recomputedQualified
      ? Math.min(recomputedMaxCosine + lensBonus * (recomputedQualifying.length - 1), 1)
      : 0;
    if (score.score !== recomputedScore) {
      reasons.push(`Candidate score formula mismatch for ${score.candidateId} in ${result.mode} run ${result.run}`);
    }
  }

  const rankingIds = result.ranking.map((score) => score.candidateId);
  if (new Set(rankingIds).size !== rankingIds.length) {
    reasons.push(`Ranking candidate IDs are not unique for ${result.caseId} run ${result.run} ${result.mode}`);
  }
  const expectedRanking = result.allCandidateScores
    .filter((score): score is RunResult['ranking'][number] => score.qualified)
    .sort((left, right) => right.score - left.score);
  if (!sameJson(result.ranking, expectedRanking)) {
    reasons.push(`Ranking is not the exact stable qualified score subset for ${result.caseId} run ${result.run} ${result.mode}`);
  }

  const returnedCount = result.documents.filter((document) => document.returned).length;
  const overwrittenCount = result.documents.filter((document) => document.mapStatus === 'overwritten').length;
  const failedOpenCount = result.documents.filter((document) => document.validationStatus === 'failed_open').length;
  const rejectedCount = result.documents.filter((document) => document.validationStatus === 'invalid').length;
  const submittedCount = result.mode === 'frame-v1'
    ? result.documents.filter((document) => document.mapStatus === 'submitted'
      && document.validationStatus !== 'not_submitted').length
    : 0;
  if (result.generatedDocumentCount !== result.documents.length) reasons.push(`Generated document count mismatch for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.resources.generatorCalls.length !== result.generatedDocumentCount) reasons.push(`Generator resource/diagnostic count mismatch for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.resources.generatorCalls.some((call) => call.outcome !== 'completed')) reasons.push(`Completed run contains a throwing generator resource call for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.returnedDocumentCount !== returnedCount) reasons.push(`Returned document count mismatch for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.returnedDocumentCount > result.lensCount) reasons.push(`Returned document count exceeds lens count for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.overwrittenDocumentCount !== overwrittenCount) reasons.push(`Overwritten document count mismatch for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.failedOpenCount !== failedOpenCount) reasons.push(`Failed-open document count mismatch for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.validatorSubmittedDocumentCount !== submittedCount) reasons.push(`Validator-submitted document count mismatch for ${result.caseId} run ${result.run} ${result.mode}`);
  if (result.mode === 'frame-v1' && result.rejectedCount !== rejectedCount) reasons.push(`Rejected document count mismatch for ${result.caseId} run ${result.run} frame-v1`);
  if (result.mode === 'legacy' && (result.rejectedCount !== null || result.validatorSubmittedDocumentCount !== 0)) {
    reasons.push(`Legacy validator diagnostics must be inapplicable for ${result.caseId} run ${result.run}`);
  }
}

export interface HydeCollectionPreflightResult {
  collection: HydeCollectionArtifact;
  reasons: string[];
  valid: boolean;
}

/**
 * Validate every collection-only requirement needed before blind human review.
 * Structural parse errors throw; semantic defects are accumulated so callers can
 * print the complete rejection set in one pass.
 */
export function validateHydeCollectionPreflight(
  collectionValue: unknown,
  cases: readonly HydeEvalCase[] = HYDE_CASES,
): HydeCollectionPreflightResult {
  const collection = parseHydeCollectionArtifact(collectionValue);
  const reasons: string[] = [];
  try {
    assertFrozenHydeCorpus(cases);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  if (!sameJson(cases, HYDE_CASES)) reasons.push('Analysis cases differ from the canonical frozen HYDE_CASES corpus');
  if (collection.schemaVersion !== HYDE_ARTIFACT_SCHEMA_VERSION) reasons.push('Collection artifact schema version is noncanonical');
  if (collection.policyVersion !== HYDE_GATE_POLICY_VERSION) reasons.push('Collection gate policy version is noncanonical');
  if (collection.corpusVersion !== HYDE_CORPUS_VERSION) reasons.push('Collection corpus version is noncanonical');
  if (collection.rubricVersion !== HYDE_RUBRIC_VERSION) reasons.push('Collection rubric version is noncanonical');
  if (collection.corpusFingerprint !== HYDE_CORPUS_FINGERPRINT) reasons.push('Collection corpus fingerprint does not match the frozen corpus');
  if (!collection.canonicality.candidate || collection.canonicality.reasons.length > 0) {
    reasons.push('Collection canonicality candidate is false or contains noncanonical reasons');
    reasons.push(...collection.canonicality.reasons.map((reason) => `Collection: ${reason}`));
  }

  const canonicalConfig = {
    selectedCaseIds: cases.map((c) => c.id),
    runs: HYDE_CANONICAL_RUNS,
    cutoff: HYDE_MIN_SCORE,
    lensBonus: HYDE_LENS_BONUS,
    maxLenses: HYDE_MAX_LENSES,
    seeds: { execution: HYDE_EXECUTION_SEED, bootstrap: HYDE_BOOTSTRAP_SEED },
  };
  if (!sameJson(collection.config, canonicalConfig)) reasons.push('Collection config differs from the canonical policy config');
  if (!sameJson(collection.provenance.models, HYDE_CANONICAL_MODEL_PINS)) reasons.push('Collection configured primary model provenance differs from committed canonical pins');
  if (!sameJson(collection.provenance.embedding, HYDE_CANONICAL_EMBEDDING_PIN)) reasons.push('Collection configured primary embedding provenance differs from committed canonical pins');
  if (collection.provenance.generationVersion !== HYDE_CANONICAL_FRAME_GENERATION_VERSION) {
    reasons.push('Collection generation provenance differs from the committed canonical frame version');
  }
  const expectedSourceMapping = HYDE_BACKGROUND_SOURCES.map((backgroundSource) => ({
    backgroundSource,
    graphSourceType: HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[backgroundSource],
  }));
  if (!sameJson(collection.provenance.backgroundSourceGraphMapping, expectedSourceMapping)) {
    reasons.push('Collection background-source graph mapping differs from the canonical background-only contract');
  }
  if (!/^[a-f0-9]{40,64}$/i.test(collection.provenance.git.revision)
    || collection.provenance.git.dirty !== false
    || collection.provenance.git.revisionWithDirtyMarker !== collection.provenance.git.revision) {
    reasons.push('Collection git provenance is not a clean canonical revision');
  }
  if (expectedConfigFingerprint(collection) !== collection.configFingerprint) {
    reasons.push('Collection config fingerprint does not match config, provenance, and schedule content');
  }

  const caseIds = cases.map((c) => c.id);
  const expectedSchedule = canonicalSchedule(caseIds);
  const actualSchedule = collection.pairedBlocks.map((block) => ({
    caseId: block.caseId,
    run: block.run,
    hash: caseRunHash(collection.config.seeds.execution, block.caseId, block.run),
    modeOrder: block.modeOrder,
    executionOrdinal: block.executionOrdinal,
  }));
  if (!sameJson(actualSchedule, expectedSchedule)) reasons.push('Collection execution schedule differs from canonical counterbalancing');

  const casesById = new Map(cases.map((c) => [c.id, c]));
  if (collection.candidateEmbeddingSetups.length !== HYDE_EXPECTED_CASE_COUNT) {
    reasons.push(`Expected exactly ${HYDE_EXPECTED_CASE_COUNT} candidate embedding setups, found ${collection.candidateEmbeddingSetups.length}`);
  }
  for (const [index, setup] of collection.candidateEmbeddingSetups.entries()) {
    const expectedCase = cases[index];
    if (!expectedCase || setup.caseId !== expectedCase.id) {
      reasons.push(`Candidate embedding setup order mismatch at index ${index}`);
      continue;
    }
    if (setup.status !== 'completed') reasons.push(`Candidate embedding setup failed for ${setup.caseId}`);
    if (setup.candidatePoolFingerprint !== fingerprintHydeArtifact(expectedCase.candidates)) {
      reasons.push(`Candidate embedding setup fingerprint mismatch for ${setup.caseId}`);
    }
    if (setup.inputCount !== expectedCase.candidates.length) reasons.push(`Candidate embedding input count mismatch for ${setup.caseId}`);
  }

  if (collection.pairedBlocks.length !== HYDE_EXPECTED_PAIR_COUNT) {
    reasons.push(`Expected exactly ${HYDE_EXPECTED_PAIR_COUNT} paired blocks, found ${collection.pairedBlocks.length}`);
  }
  for (const [index, block] of collection.pairedBlocks.entries()) {
    const expected = expectedSchedule[index];
    if (!expected || block.caseId !== expected.caseId || block.run !== expected.run
      || block.executionOrdinal !== expected.executionOrdinal
      || !sameJson(block.modeOrder, expected.modeOrder)) {
      reasons.push(`Paired block schedule/order mismatch at index ${index}`);
    }
    if (block.legacy.status !== 'completed' || block.frameV1.status !== 'completed') {
      reasons.push(`Incomplete paired run ${block.caseId} run ${block.run}`);
      continue;
    }
    const c = casesById.get(block.caseId);
    if (!c) {
      reasons.push(`Paired block references unknown canonical case ${block.caseId}`);
      continue;
    }
    if (block.stratum !== c.stratum) reasons.push(`Stratum mismatch for ${block.caseId} run ${block.run}`);
    if (block.backgroundSource !== c.backgroundSource) reasons.push(`Background source mismatch for ${block.caseId} run ${block.run}`);
    if (block.graphSourceType !== HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[c.backgroundSource]) {
      reasons.push(`Internal graph source mapping mismatch for ${block.caseId} run ${block.run}`);
    }
    validateRunResult(block.legacy.result, c, collection.config.cutoff, collection.config.lensBonus, reasons);
    validateRunResult(block.frameV1.result, c, collection.config.cutoff, collection.config.lensBonus, reasons);
  }

  const unique = uniqueReasons(reasons);
  return { collection, reasons: unique, valid: unique.length === 0 };
}

/** Throw one complete, reviewable preflight error rather than only the first defect. */
export function assertCanonicalHydeCollectionPreflight(
  collectionValue: unknown,
  cases: readonly HydeEvalCase[] = HYDE_CASES,
): HydeCollectionArtifact {
  const result = validateHydeCollectionPreflight(collectionValue, cases);
  if (!result.valid) {
    throw new Error(`Collection is not exportable:\n${result.reasons.map((reason) => `- ${reason}`).join('\n')}`);
  }
  return result.collection;
}
