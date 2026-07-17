import { createHmac } from 'node:crypto';

import { parseHydeJudgmentArtifact, parseHydeResolvedAdjudicationArtifact, parseHydeResolverDecisionsArtifact, resolveAdjudications } from './hyde.adjudication.js';
import { buildBlindExport, fingerprintHydeArtifact, parseHydeBlindPrivateKey, parseHydeCollectionArtifact } from './hyde.artifacts.js';
import { HYDE_CASES } from './hyde.cases.js';
import { evaluateHydeGates } from './hyde.gates.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCES, HYDE_BOOTSTRAP_REPLICATES, HYDE_BOOTSTRAP_SEED, HYDE_CANONICAL_RUNS, HYDE_CORPUS_VERSION, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_CASE_COUNT, HYDE_EXPECTED_PAIR_COUNT, HYDE_EXPECTED_SOURCE_CASE_COUNTS, HYDE_EXPECTED_SOURCE_PAIR_COUNTS, HYDE_GATE_POLICY_VERSION, HYDE_RUBRIC_VERSION } from './hyde.policy.js';
import { HYDE_ANALYSIS_ARTIFACT_TYPE, HYDE_CANDIDATE_TASK_KIND, HYDE_GROUNDING_TASK_KIND, HydeAnalysisArtifactSchema, type HydeAnalysisArtifact, type HydeBlindPrivateMapping, type HydeCollectionArtifact, type HydePairedMetricAnalysis, type HydeResolvedAdjudicationArtifact, type HydeScalarMetricAnalysis } from './hyde.schemas.js';
import { validateHydeCollectionPreflight } from './hyde.preflight.js';
import { computeRunRetrievalMetrics } from './hyde.scorer.js';
import { hierarchicalPairedBootstrap, hierarchicalScalarBootstrap, percentileLinearInterpolation, type HierarchicalBootstrapOptions, type PairedMetricObservation, type ScalarMetricObservation } from './hyde.statistics.js';
import { HYDE_EVAL_STRATA, type HydeBackgroundSource, type HydeEvalCase, type HydeEvalStratum, type RelevanceGrade } from './hyde.types.js';

export interface AnalyzeHydeEvidenceOptions {
  generatedAt?: string;
  /** Test/diagnostic override. Any non-policy value makes the analysis insufficient. */
  bootstrapReplicates?: number;
  /** Test/diagnostic override. Any non-policy value makes the analysis insufficient. */
  bootstrapSeed?: number;
  /** Original independently submitted judgment artifacts required for canonical revalidation. */
  judgmentArtifacts?: readonly unknown[];
  /** Original optional blind resolver decisions required when resolution used a resolver. */
  resolverDecisions?: unknown;
}

type CompletedSlot = Extract<HydeCollectionArtifact['pairedBlocks'][number]['legacy'], { status: 'completed' }>;
type RunResult = CompletedSlot['result'];
type DocumentDiagnostic = RunResult['documents'][number];
type ResourceCall = RunResult['resources']['generatorCalls'][number];

interface CompletedPair {
  caseId: string;
  stratum: HydeEvalStratum;
  backgroundSource: HydeBackgroundSource;
  run: number;
  legacy: RunResult;
  frameV1: RunResult;
}

interface GroundingLabel {
  grounding: 'supported' | 'unsupported';
  opaqueId: string;
}

interface MetricObservationSet {
  precisionAt5: PairedMetricObservation[];
  ndcgAt5: PairedMetricObservation[];
  hardNegativeFprAt5: PairedMetricObservation[];
  margin: PairedMetricObservation[];
  unsupportedAdditionRate: PairedMetricObservation[];
  groundingErrorRate: PairedMetricObservation[];
  frameAllRejectedRate: ScalarMetricObservation[];
  frameFailedOpenRate: ScalarMetricObservation[];
}

interface DistributionSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  mean: number | null;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons)].sort(compareAscii);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return fingerprintHydeArtifact(left) === fingerprintHydeArtifact(right);
}

function expectedOpaqueId(secret: string, locator: string): string {
  return `blind-${createHmac('sha256', secret).update(locator).digest('hex')}`;
}

function documentKey(caseId: string, run: number, mode: 'legacy' | 'frame-v1', documentIndex: number): string {
  return `${caseId}\0${run}\0${mode}\0${documentIndex}`;
}

function mappingLocator(mapping: HydeBlindPrivateMapping): string {
  return mapping.taskKind === HYDE_CANDIDATE_TASK_KIND
    ? `candidate\0${mapping.candidateId}`
    : `grounding\0${mapping.caseId}\0${mapping.run}\0${mapping.mode}\0${mapping.documentIndex}`;
}

function distribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) return { count: 0, p50: null, p95: null, mean: null };
  return {
    count: values.length,
    p50: percentileLinearInterpolation(values, 0.5),
    p95: percentileLinearInterpolation(values, 0.95),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot compute a mean without observations');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pairedPerStratum(observations: readonly PairedMetricObservation[]) {
  return HYDE_EVAL_STRATA.map((stratum) => {
    const rows = observations.filter((observation) => observation.stratum === stratum);
    const caseIds = [...new Set(rows.map((row) => row.caseId))].sort(compareAscii);
    const legacy = mean(caseIds.map((caseId) => mean(rows.filter((row) => row.caseId === caseId).map((row) => row.legacy))));
    const frameV1 = mean(caseIds.map((caseId) => mean(rows.filter((row) => row.caseId === caseId).map((row) => row.frameV1))));
    return { stratum, legacy, frameV1, delta: frameV1 - legacy };
  });
}

function scalarPerStratum(observations: readonly ScalarMetricObservation[]) {
  return HYDE_EVAL_STRATA.map((stratum) => {
    const rows = observations.filter((observation) => observation.stratum === stratum);
    const caseIds = [...new Set(rows.map((row) => row.caseId))].sort(compareAscii);
    return {
      stratum,
      value: mean(caseIds.map((caseId) => mean(rows.filter((row) => row.caseId === caseId).map((row) => row.value)))),
    };
  });
}

function unavailable(reasons: readonly string[]): HydePairedMetricAnalysis {
  return { available: false, reasons: uniqueReasons(reasons) };
}

function scalarUnavailable(reasons: readonly string[]): HydeScalarMetricAnalysis {
  return { available: false, reasons: uniqueReasons(reasons) };
}

function pairedMetric(
  observations: readonly PairedMetricObservation[],
  reasons: readonly string[],
  options: HierarchicalBootstrapOptions,
): HydePairedMetricAnalysis {
  if (reasons.length > 0) return unavailable(reasons);
  const result = hierarchicalPairedBootstrap(observations, options);
  return { available: true, ...result, perStratum: pairedPerStratum(observations) };
}

function scalarMetric(
  observations: readonly ScalarMetricObservation[],
  reasons: readonly string[],
  options: HierarchicalBootstrapOptions,
): HydeScalarMetricAnalysis {
  if (reasons.length > 0) return scalarUnavailable(reasons);
  const result = hierarchicalScalarBootstrap(observations, options);
  return { available: true, ...result, perStratum: scalarPerStratum(observations) };
}

function unsupportedRate(documents: readonly DocumentDiagnostic[], labels: ReadonlyMap<string, GroundingLabel>, prefix: string): number {
  if (documents.length === 0) return 0;
  const unsupported = documents.filter((_, index) => labels.get(`${prefix}\0${index}`)?.grounding === 'unsupported').length;
  return unsupported / documents.length;
}

function exposureRate(documents: readonly DocumentDiagnostic[], labels: ReadonlyMap<string, GroundingLabel>, prefix: string): number {
  const returned = documents.map((document, index) => ({ document, label: labels.get(`${prefix}\0${index}`) }))
    .filter((entry) => entry.document.returned);
  if (returned.length === 0) return 0;
  return returned.filter((entry) => entry.label?.grounding === 'unsupported').length / returned.length;
}

function collectCompletedPairs(
  collection: HydeCollectionArtifact,
  cases: readonly HydeEvalCase[],
  reasons: string[],
) {
  const expectedKeys = new Set(cases.flatMap((c) => Array.from(
    { length: HYDE_CANONICAL_RUNS },
    (_, index) => `${c.id}\0${index + 1}`,
  )));
  const observedByKey = new Map(collection.pairedBlocks.map((block) => [`${block.caseId}\0${block.run}`, block]));
  const missingPairCount = [...expectedKeys].filter((key) => !observedByKey.has(key)).length;
  const extraPairCount = [...observedByKey.keys()].filter((key) => !expectedKeys.has(key)).length;
  if (missingPairCount > 0) reasons.push(`${missingPairCount} expected case/run pairs are missing`);
  if (extraPairCount > 0) reasons.push(`${extraPairCount} noncanonical case/run pairs are present`);

  const casesById = new Map(cases.map((c) => [c.id, c]));
  const pairs: CompletedPair[] = [];
  let failedPairCount = 0;
  for (const key of expectedKeys) {
    const block = observedByKey.get(key);
    if (!block) continue;
    if (block.legacy.status !== 'completed' || block.frameV1.status !== 'completed') {
      failedPairCount += 1;
      reasons.push(`Incomplete paired run ${block.caseId} run ${block.run}`);
      continue;
    }
    const c = casesById.get(block.caseId);
    if (!c) continue;
    pairs.push({
      caseId: block.caseId,
      stratum: c.stratum,
      backgroundSource: c.backgroundSource,
      run: block.run,
      legacy: block.legacy.result,
      frameV1: block.frameV1.result,
    });
  }
  const incompletePairCount = missingPairCount + failedPairCount;
  return {
    pairs,
    observedPairCount: [...observedByKey.keys()].filter((key) => expectedKeys.has(key)).length,
    completedPairCount: pairs.length,
    failedPairCount,
    missingPairCount,
    incompletePairCount,
    incompletePairRate: incompletePairCount / HYDE_EXPECTED_PAIR_COUNT,
  };
}

function remapAdjudication(
  collection: HydeCollectionArtifact,
  resolved: HydeResolvedAdjudicationArtifact,
  privateKey: ReturnType<typeof parseHydeBlindPrivateKey>,
  cases: readonly HydeEvalCase[],
  reasons: string[],
) {
  const collectionFingerprint = fingerprintHydeArtifact(collection);
  if (privateKey.collectionFingerprint !== collectionFingerprint) reasons.push('Private key collection fingerprint does not match collection artifact');
  if (privateKey.studyId !== collection.studyId) reasons.push('Private key study ID does not match collection');
  if (privateKey.corpusFingerprint !== collection.corpusFingerprint) reasons.push('Private key corpus fingerprint does not match collection');
  if (privateKey.configFingerprint !== collection.configFingerprint) reasons.push('Private key config fingerprint does not match collection');
  if (resolved.studyId !== collection.studyId) reasons.push('Resolved adjudication study ID does not match collection');
  if (resolved.batchFingerprint !== privateKey.batchFingerprint) reasons.push('Resolved adjudication batch fingerprint does not match private key');
  try {
    const regenerated = buildBlindExport(collection, cases, {
      secret: privateKey.hmacSecret,
      createdAt: privateKey.createdAt,
    });
    if (regenerated.publicBatch.batchFingerprint !== privateKey.batchFingerprint) {
      reasons.push('Private key batch fingerprint does not match regenerated blinded public content');
    }
    if (!sameJson(regenerated.privateKey.mappings, privateKey.mappings)) {
      reasons.push('Private mappings do not match regenerated canonical blind mappings');
    }
  } catch (error) {
    reasons.push(`Blind parent regeneration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (resolved.status !== 'complete' || !resolved.canonical || resolved.reasons.length > 0) {
    reasons.push('Resolved adjudication is incomplete or noncanonical');
    reasons.push(...resolved.reasons.map((reason) => `Adjudication: ${reason}`));
  }
  if (resolved.coverage.completeAttestedHumanAdjudicatorCount < 2) reasons.push('Fewer than two complete independently attested human adjudicators');
  if (resolved.coverage.invalidHumanArtifactCount > 0) reasons.push('Resolved adjudication contains invalid human artifacts');
  if (resolved.counts.unresolved > 0 || resolved.counts.missingEvidence > 0) reasons.push('Resolved adjudication contains unresolved or missing items');
  const actualResolvedCount = resolved.items.filter((item) => item.status === 'resolved').length;
  const actualUnresolvedCount = resolved.items.length - actualResolvedCount;
  const actualAgreementCount = resolved.items.filter((item) => item.status === 'resolved' && item.resolution === 'agreement').length;
  const actualDisagreementCount = resolved.items.filter((item) => item.status === 'resolved' && item.resolution === 'resolver').length;
  if (resolved.coverage.publicItemCount !== resolved.items.length
    || resolved.counts.resolved !== actualResolvedCount
    || resolved.counts.unresolved !== actualUnresolvedCount
    || resolved.counts.agreement !== actualAgreementCount
    || resolved.counts.disagreement !== actualDisagreementCount) {
    reasons.push('Resolved adjudication coverage/count summaries do not match item records');
  }
  if (resolved.items.some((item) => item.status === 'resolved'
    && new Set(item.adjudicatorIds).size < 2)) {
    reasons.push('Resolved adjudication items do not prove two distinct independent human adjudicators');
  }

  const expectedCandidateIds = new Set(cases.flatMap((c) => c.candidates.map((candidate) => candidate.id)));
  const expectedDocumentKeys = new Set<string>();
  for (const block of collection.pairedBlocks) {
    for (const [slotKey, mode] of [['legacy', 'legacy'], ['frameV1', 'frame-v1']] as const) {
      const slot = block[slotKey];
      if (slot.status !== 'completed') continue;
      slot.result.documents.forEach((_, index) => expectedDocumentKeys.add(documentKey(block.caseId, block.run, mode, index)));
    }
  }

  const candidateMappings = privateKey.mappings.filter((mapping) => mapping.taskKind === HYDE_CANDIDATE_TASK_KIND);
  const groundingMappings = privateKey.mappings.filter((mapping) => mapping.taskKind === HYDE_GROUNDING_TASK_KIND);
  if (candidateMappings.length !== HYDE_EXPECTED_CANDIDATE_COUNT) reasons.push(`Expected ${HYDE_EXPECTED_CANDIDATE_COUNT} candidate mappings, found ${candidateMappings.length}`);
  if (groundingMappings.length !== expectedDocumentKeys.size) reasons.push(`Expected ${expectedDocumentKeys.size} generated-document mappings, found ${groundingMappings.length}`);
  const mappedCandidateIds = new Set(candidateMappings.map((mapping) => mapping.candidateId));
  if (mappedCandidateIds.size !== expectedCandidateIds.size
    || [...expectedCandidateIds].some((candidateId) => !mappedCandidateIds.has(candidateId))) {
    reasons.push(`Candidate mappings do not cover the frozen ${HYDE_EXPECTED_CANDIDATE_COUNT}-candidate corpus exactly`);
  }
  const mappedDocumentKeys = new Set(groundingMappings.map((mapping) => documentKey(
    mapping.caseId,
    mapping.run,
    mapping.mode,
    mapping.documentIndex,
  )));
  if (mappedDocumentKeys.size !== expectedDocumentKeys.size
    || [...expectedDocumentKeys].some((key) => !mappedDocumentKeys.has(key))) {
    reasons.push('Generated-document mappings do not exactly cover every generated diagnostic');
  }
  for (const mapping of privateKey.mappings) {
    if (mapping.opaqueId !== expectedOpaqueId(privateKey.hmacSecret, mappingLocator(mapping))) {
      reasons.push(`Private mapping opaque ID does not match its HMAC locator: ${mapping.opaqueId}`);
    }
  }

  const resolvedById = new Map(resolved.items.map((item) => [item.opaqueId, item]));
  const mappingIds = new Set(privateKey.mappings.map((mapping) => mapping.opaqueId));
  if (resolved.items.length !== privateKey.mappings.length
    || resolvedById.size !== mappingIds.size
    || [...mappingIds].some((opaqueId) => !resolvedById.has(opaqueId))) {
    reasons.push('Resolved judgments do not exactly cover all private mappings');
  }

  const candidateGrades = new Map<string, RelevanceGrade>();
  const groundingLabels = new Map<string, GroundingLabel>();
  for (const mapping of privateKey.mappings) {
    const item = resolvedById.get(mapping.opaqueId);
    if (!item || item.status !== 'resolved') continue;
    if (item.taskKind !== mapping.taskKind) {
      reasons.push(`Resolved task kind does not match private mapping for ${mapping.opaqueId}`);
      continue;
    }
    if (mapping.taskKind === HYDE_CANDIDATE_TASK_KIND && item.taskKind === HYDE_CANDIDATE_TASK_KIND) {
      candidateGrades.set(mapping.candidateId, item.finalRelevanceGrade);
    } else if (mapping.taskKind === HYDE_GROUNDING_TASK_KIND && item.taskKind === HYDE_GROUNDING_TASK_KIND) {
      groundingLabels.set(documentKey(mapping.caseId, mapping.run, mapping.mode, mapping.documentIndex), {
        grounding: item.finalGrounding,
        opaqueId: item.opaqueId,
      });
    }
  }
  if (candidateGrades.size !== HYDE_EXPECTED_CANDIDATE_COUNT) reasons.push('Canonical resolved candidate grades are incomplete');
  if (groundingLabels.size !== expectedDocumentKeys.size) reasons.push('Canonical resolved grounding labels are incomplete');

  for (const c of cases) {
    const positiveIds = c.candidates.filter((candidate) => (candidateGrades.get(candidate.id) ?? 0) > 0).map((candidate) => candidate.id);
    const gradeThreeCount = c.candidates.filter((candidate) => candidateGrades.get(candidate.id) === 3).length;
    const validHardNegativeCount = c.candidates.filter((candidate) => candidate.role === 'hard-negative'
      && candidateGrades.get(candidate.id) === 0
      && candidate.hardNegativeOf !== undefined
      && positiveIds.includes(candidate.hardNegativeOf.positiveCandidateId)).length;
    if (positiveIds.length < 2 || positiveIds.length > 3) reasons.push(`Resolved grades for ${c.id} must preserve 2-3 positives`);
    if (gradeThreeCount < 1) reasons.push(`Resolved grades for ${c.id} must preserve at least one grade-3 candidate`);
    if (validHardNegativeCount < 4) reasons.push(`Resolved grades for ${c.id} must preserve at least four linked grade-0 authored hard negatives`);
  }

  return {
    candidateGrades,
    groundingLabels,
    expectedGeneratedDocumentMappingCount: expectedDocumentKeys.size,
    candidateMappingCount: candidateMappings.length,
    generatedDocumentMappingCount: groundingMappings.length,
  };
}

function revalidateResolvedSources(
  collection: HydeCollectionArtifact,
  privateKey: ReturnType<typeof parseHydeBlindPrivateKey>,
  resolved: HydeResolvedAdjudicationArtifact,
  cases: readonly HydeEvalCase[],
  options: AnalyzeHydeEvidenceOptions,
  reasons: string[],
): void {
  if (!options.judgmentArtifacts || options.judgmentArtifacts.length < 2) {
    reasons.push('Original independent judgment artifacts are required at least twice for canonical adjudication revalidation');
    return;
  }
  try {
    const regenerated = buildBlindExport(collection, cases, {
      secret: privateKey.hmacSecret,
      createdAt: privateKey.createdAt,
    });
    const judgments = options.judgmentArtifacts.map((artifact) => parseHydeJudgmentArtifact(artifact));
    const resolver = options.resolverDecisions === undefined
      ? undefined
      : parseHydeResolverDecisionsArtifact(options.resolverDecisions);
    const recomputed = resolveAdjudications(regenerated.publicBatch, judgments, resolver, {
      createdAt: resolved.createdAt,
    });
    if (!sameJson(recomputed, resolved)) {
      reasons.push('Resolved adjudication does not exactly match recomputation from its original judgment and resolver sources');
    }
  } catch (error) {
    reasons.push(`Adjudication source revalidation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function emptyObservations(): MetricObservationSet {
  return {
    precisionAt5: [],
    ndcgAt5: [],
    hardNegativeFprAt5: [],
    margin: [],
    unsupportedAdditionRate: [],
    groundingErrorRate: [],
    frameAllRejectedRate: [],
    frameFailedOpenRate: [],
  };
}

function collectMetricObservations(
  pairs: readonly CompletedPair[],
  candidateGrades: ReadonlyMap<string, RelevanceGrade>,
  groundingLabels: ReadonlyMap<string, GroundingLabel>,
  retrievalReasons: string[],
): MetricObservationSet {
  const observations = emptyObservations();
  for (const pair of pairs) {
    let legacy;
    let frameV1;
    try {
      const legacyGrades = new Map(pair.legacy.allCandidateScores.flatMap((score) => {
        const grade = candidateGrades.get(score.candidateId);
        return grade === undefined ? [] : [[score.candidateId, grade] as const];
      }));
      const frameGrades = new Map(pair.frameV1.allCandidateScores.flatMap((score) => {
        const grade = candidateGrades.get(score.candidateId);
        return grade === undefined ? [] : [[score.candidateId, grade] as const];
      }));
      legacy = computeRunRetrievalMetrics(pair.legacy.allCandidateScores, legacyGrades);
      frameV1 = computeRunRetrievalMetrics(pair.frameV1.allCandidateScores, frameGrades);
    } catch (error) {
      retrievalReasons.push(`${pair.caseId} run ${pair.run}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const identity = { stratum: pair.stratum, caseId: pair.caseId, run: pair.run };
    observations.precisionAt5.push({ ...identity, legacy: legacy.precisionAt5, frameV1: frameV1.precisionAt5 });
    observations.ndcgAt5.push({ ...identity, legacy: legacy.ndcgAt5, frameV1: frameV1.ndcgAt5 });
    if (legacy.hardNegativeFprAt5 === null || frameV1.hardNegativeFprAt5 === null) {
      retrievalReasons.push(`${pair.caseId} run ${pair.run}: hard-negative FPR is unavailable`);
    } else {
      observations.hardNegativeFprAt5.push({ ...identity, legacy: legacy.hardNegativeFprAt5, frameV1: frameV1.hardNegativeFprAt5 });
    }
    if (legacy.margin === null || frameV1.margin === null) {
      retrievalReasons.push(`${pair.caseId} run ${pair.run}: positive-to-hard-negative margin is unavailable`);
    } else {
      observations.margin.push({ ...identity, legacy: legacy.margin, frameV1: frameV1.margin });
    }
    const legacyPrefix = `${pair.caseId}\0${pair.run}\0legacy`;
    const framePrefix = `${pair.caseId}\0${pair.run}\0frame-v1`;
    observations.unsupportedAdditionRate.push({
      ...identity,
      legacy: unsupportedRate(pair.legacy.documents, groundingLabels, legacyPrefix),
      frameV1: unsupportedRate(pair.frameV1.documents, groundingLabels, framePrefix),
    });
    observations.groundingErrorRate.push({
      ...identity,
      legacy: exposureRate(pair.legacy.documents, groundingLabels, legacyPrefix),
      frameV1: exposureRate(pair.frameV1.documents, groundingLabels, framePrefix),
    });
    observations.frameAllRejectedRate.push({
      ...identity,
      value: pair.frameV1.validatorSubmittedDocumentCount > 0
        && pair.frameV1.rejectedCount === pair.frameV1.validatorSubmittedDocumentCount
        && pair.frameV1.returnedDocumentCount === 0 ? 1 : 0,
    });
    observations.frameFailedOpenRate.push({
      ...identity,
      value: pair.frameV1.validatorSubmittedDocumentCount === 0
        ? 0
        : pair.frameV1.failedOpenCount / pair.frameV1.validatorSubmittedDocumentCount,
    });
  }
  return observations;
}

function sourceCoverage(
  collection: HydeCollectionArtifact,
  cases: readonly HydeEvalCase[],
  completedPairs: readonly CompletedPair[],
) {
  return HYDE_BACKGROUND_SOURCES.map((backgroundSource) => {
    const sourceCaseIds = new Set(cases
      .filter((c) => c.backgroundSource === backgroundSource)
      .map((c) => c.id));
    const observedPairCount = collection.pairedBlocks
      .filter((block) => sourceCaseIds.has(block.caseId)).length;
    return {
      backgroundSource,
      expectedCaseCount: HYDE_EXPECTED_SOURCE_CASE_COUNTS[backgroundSource],
      caseCount: sourceCaseIds.size,
      expectedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS[backgroundSource],
      observedPairCount,
      completedPairCount: completedPairs.filter((pair) => pair.backgroundSource === backgroundSource).length,
    };
  });
}

function pairedPointDiagnostic(
  observations: readonly PairedMetricObservation[],
  sourceCaseIds: ReadonlySet<string>,
) {
  const rows = observations.filter((observation) => sourceCaseIds.has(observation.caseId));
  if (rows.length === 0) return { available: false as const, reasons: ['No complete observations for this background source'] };
  const legacy = mean(rows.map((row) => row.legacy));
  const frameV1 = mean(rows.map((row) => row.frameV1));
  return { available: true as const, pointEstimate: { legacy, frameV1, delta: frameV1 - legacy } };
}

function scalarPointDiagnostic(
  observations: readonly ScalarMetricObservation[],
  sourceCaseIds: ReadonlySet<string>,
) {
  const rows = observations.filter((observation) => sourceCaseIds.has(observation.caseId));
  if (rows.length === 0) return { available: false as const, reasons: ['No complete observations for this background source'] };
  return { available: true as const, pointEstimate: mean(rows.map((row) => row.value)) };
}

function perBackgroundSourceDiagnostics(
  cases: readonly HydeEvalCase[],
  coverage: ReturnType<typeof sourceCoverage>,
  observations: MetricObservationSet,
) {
  return HYDE_BACKGROUND_SOURCES.map((backgroundSource) => {
    const sourceCaseIds = new Set(cases
      .filter((c) => c.backgroundSource === backgroundSource)
      .map((c) => c.id));
    const coverageEntry = coverage.find((entry) => entry.backgroundSource === backgroundSource);
    if (!coverageEntry) throw new Error(`Missing coverage for background source ${backgroundSource}`);
    const { backgroundSource: _source, ...sourceCoverageRecord } = coverageEntry;
    return {
      backgroundSource,
      coverage: sourceCoverageRecord,
      metrics: {
        precisionAt5: pairedPointDiagnostic(observations.precisionAt5, sourceCaseIds),
        ndcgAt5: pairedPointDiagnostic(observations.ndcgAt5, sourceCaseIds),
        hardNegativeFprAt5: pairedPointDiagnostic(observations.hardNegativeFprAt5, sourceCaseIds),
        margin: pairedPointDiagnostic(observations.margin, sourceCaseIds),
        unsupportedAdditionRate: pairedPointDiagnostic(observations.unsupportedAdditionRate, sourceCaseIds),
        groundingErrorRate: pairedPointDiagnostic(observations.groundingErrorRate, sourceCaseIds),
        frameAllRejectedRate: scalarPointDiagnostic(observations.frameAllRejectedRate, sourceCaseIds),
        frameFailedOpenRate: scalarPointDiagnostic(observations.frameFailedOpenRate, sourceCaseIds),
      },
    };
  });
}

function aggregateCalls(calls: readonly ResourceCall[]) {
  return {
    callCount: calls.length,
    inputCount: calls.reduce((sum, call) => sum + call.inputCount, 0),
    outcomes: {
      completed: calls.filter((call) => call.outcome === 'completed').length,
      threw: calls.filter((call) => call.outcome === 'threw').length,
    },
    durationMs: distribution(calls.map((call) => call.durationMs)),
  };
}

function resourceDiagnostics(collection: HydeCollectionArtifact) {
  const slots = collection.pairedBlocks.flatMap((block) => [
    { mode: 'legacy' as const, slot: block.legacy },
    { mode: 'frame-v1' as const, slot: block.frameV1 },
  ]);
  const allResources = slots.flatMap((entry) => entry.slot.status === 'completed'
    ? [entry.slot.result.resources]
    : entry.slot.resources ? [entry.slot.resources] : []);
  const modeRuns = (['legacy', 'frame-v1'] as const).map((mode) => {
    const modeSlots = slots.filter((entry) => entry.mode === mode);
    const results = modeSlots.flatMap((entry) => entry.slot.status === 'completed' ? [entry.slot.result] : []);
    return {
      mode,
      attemptedRunCount: modeSlots.length,
      completedRunCount: results.length,
      failedRunCount: modeSlots.length - results.length,
      durationMs: distribution(modeSlots.map((entry) => entry.slot.timing.durationMs)),
      generatedDocumentCount: results.reduce((sum, result) => sum + result.documents.length, 0),
      returnedDocumentCount: results.reduce((sum, result) => sum + result.returnedDocumentCount, 0),
      emptyGenerationRunCount: results.filter((result) => result.documents.length === 0).length,
      overwrittenDocumentCount: results.reduce((sum, result) => sum + result.overwrittenDocumentCount, 0),
      rejectedDocumentCount: results.reduce((sum, result) => sum + (result.rejectedCount ?? 0), 0),
      failedOpenDocumentCount: results.reduce((sum, result) => sum + result.failedOpenCount, 0),
      allRejectedRunCount: results.filter((result) => result.validatorSubmittedDocumentCount > 0
        && result.rejectedCount === result.validatorSubmittedDocumentCount
        && result.returnedDocumentCount === 0).length,
    };
  });
  return {
    candidateEmbeddings: {
      setupCount: collection.candidateEmbeddingSetups.length,
      completedCount: collection.candidateEmbeddingSetups.filter((setup) => setup.status === 'completed').length,
      failedCount: collection.candidateEmbeddingSetups.filter((setup) => setup.status === 'failed').length,
      inputCount: collection.candidateEmbeddingSetups.reduce((sum, setup) => sum + setup.inputCount, 0),
      durationMs: distribution(collection.candidateEmbeddingSetups.map((setup) => setup.durationMs)),
    },
    modeRuns,
    productionWrapperCalls: {
      lensInference: aggregateCalls(allResources.flatMap((resources) => resources.lensInferenceCalls)),
      generator: aggregateCalls(allResources.flatMap((resources) => resources.generatorCalls)),
      validator: aggregateCalls(allResources.flatMap((resources) => resources.validatorCalls)),
      documentEmbeddings: aggregateCalls(allResources.flatMap((resources) => resources.documentEmbeddingCalls)),
    },
    configuredProviderIdentity: {
      available: false as const,
      reason: 'Artifacts pin configured primary model IDs; production retry/fallback behavior remains enabled, but the provider/model identity used by each call is unavailable at this boundary',
    },
    frameExtractionCalls: {
      available: false as const,
      reason: 'Frame extraction is returned through the injected lens-inferrer interface, so its call timing/concurrency cannot be observed separately without changing production agents',
    },
    tokens: { available: false as const, reason: 'Production wrappers do not expose canonical token accounting in collection artifacts' },
    cost: { available: false as const, reason: 'Provider cost is unavailable from the evidence collection boundary' },
  };
}

function validatorAppendix(
  collection: HydeCollectionArtifact,
  labels: ReadonlyMap<string, GroundingLabel>,
) {
  let generatedDocumentCount = 0;
  let returnedDocumentCount = 0;
  let accepted = 0;
  let rejected = 0;
  let failedOpen = 0;
  let unclassifiable = 0;
  let classifiableCount = 0;
  let agreementCount = 0;
  let falseAcceptCount = 0;
  let falseRejectCount = 0;
  for (const block of collection.pairedBlocks) {
    for (const [slotKey, mode] of [['legacy', 'legacy'], ['frameV1', 'frame-v1']] as const) {
      const slot = block[slotKey];
      if (slot.status !== 'completed') continue;
      slot.result.documents.forEach((document, index) => {
        const human = labels.get(documentKey(block.caseId, block.run, mode, index))?.grounding;
        if (!human) return;
        if (human === 'unsupported') {
          generatedDocumentCount += 1;
          if (document.returned) returnedDocumentCount += 1;
          if (document.validationStatus === 'valid' && document.returned) accepted += 1;
          else if (document.validationStatus === 'invalid' && !document.returned) rejected += 1;
          else if (document.validationStatus === 'failed_open') failedOpen += 1;
          else unclassifiable += 1;
        }
        const production = document.validationStatus === 'invalid' && !document.returned
          ? 'rejected'
          : document.returned && (document.validationStatus === 'valid' || document.validationStatus === 'failed_open')
            ? 'accepted'
            : null;
        if (!production) return;
        classifiableCount += 1;
        if ((human === 'unsupported' && production === 'rejected') || (human === 'supported' && production === 'accepted')) agreementCount += 1;
        if (human === 'unsupported' && production === 'accepted') falseAcceptCount += 1;
        if (human === 'supported' && production === 'rejected') falseRejectCount += 1;
      });
    }
  }
  return {
    canonical: false as const,
    label: 'NONCANONICAL production-validator appendix' as const,
    humanUnsupported: {
      generatedDocumentCount,
      returnedDocumentCount,
      production: { accepted, rejected, failedOpen, unclassifiable },
    },
    comparison: { classifiableCount, agreementCount, falseAcceptCount, falseRejectCount },
  };
}

/**
 * Build canonical human-labeled HyDE evidence analysis. Structurally invalid
 * boundary artifacts throw; all semantic completeness/canonicality defects are
 * accumulated into an explicit insufficient result.
 */
export function analyzeHydeEvidence(
  collectionValue: unknown,
  privateKeyValue: unknown,
  resolvedAdjudicationValue: unknown,
  cases: readonly HydeEvalCase[] = HYDE_CASES,
  options: AnalyzeHydeEvidenceOptions = {},
): HydeAnalysisArtifact {
  const collection = parseHydeCollectionArtifact(collectionValue);
  const privateKey = parseHydeBlindPrivateKey(privateKeyValue);
  const resolved = parseHydeResolvedAdjudicationArtifact(resolvedAdjudicationValue);
  const reasons = validateHydeCollectionPreflight(collection, cases).reasons;
  const completeness = collectCompletedPairs(collection, cases, reasons);
  const labels = remapAdjudication(collection, resolved, privateKey, cases, reasons);
  revalidateResolvedSources(collection, privateKey, resolved, cases, options, reasons);
  if (collection.candidateEmbeddingSetups.some((setup) => setup.status === 'failed')) reasons.push('Candidate embedding setup contains failures');
  if (collection.candidateEmbeddingSetups.length !== HYDE_EXPECTED_CASE_COUNT) reasons.push(`Expected ${HYDE_EXPECTED_CASE_COUNT} candidate embedding setups, found ${collection.candidateEmbeddingSetups.length}`);

  const intervalReasons: string[] = [];
  if (completeness.incompletePairCount > 0) {
    intervalReasons.push(`Intervals unavailable because ${completeness.incompletePairCount} of ${HYDE_EXPECTED_PAIR_COUNT} expected pairs are incomplete`);
  }
  if (labels.candidateGrades.size !== HYDE_EXPECTED_CANDIDATE_COUNT) intervalReasons.push('Intervals unavailable because resolved candidate grades are incomplete');
  if (labels.groundingLabels.size !== labels.expectedGeneratedDocumentMappingCount) intervalReasons.push('Intervals unavailable because resolved grounding labels are incomplete');
  const retrievalReasons = [...intervalReasons];
  const observations = intervalReasons.length === 0
    ? collectMetricObservations(completeness.pairs, labels.candidateGrades, labels.groundingLabels, retrievalReasons)
    : emptyObservations();
  if (retrievalReasons.length > intervalReasons.length) reasons.push(...retrievalReasons);
  const bootstrapOptions = {
    replicates: options.bootstrapReplicates ?? HYDE_BOOTSTRAP_REPLICATES,
    seed: options.bootstrapSeed ?? HYDE_BOOTSTRAP_SEED,
  };
  if (bootstrapOptions.replicates !== HYDE_BOOTSTRAP_REPLICATES) {
    reasons.push(`Bootstrap replicate count ${bootstrapOptions.replicates} differs from canonical ${HYDE_BOOTSTRAP_REPLICATES}`);
  }
  if (bootstrapOptions.seed !== HYDE_BOOTSTRAP_SEED) {
    reasons.push(`Bootstrap seed ${bootstrapOptions.seed} differs from canonical ${HYDE_BOOTSTRAP_SEED}`);
  }
  const expectedObservationCount = HYDE_EXPECTED_PAIR_COUNT;
  const retrievalMetricReasons = [...retrievalReasons];
  if (observations.precisionAt5.length !== expectedObservationCount && retrievalMetricReasons.length === 0) {
    retrievalMetricReasons.push(`Retrieval observations do not cover all ${HYDE_EXPECTED_PAIR_COUNT} pairs`);
  }
  const groundingMetricReasons = [...intervalReasons];
  if (observations.groundingErrorRate.length !== expectedObservationCount && groundingMetricReasons.length === 0) {
    groundingMetricReasons.push(`Grounding observations do not cover all ${HYDE_EXPECTED_PAIR_COUNT} pairs`);
  }

  const coverageBySource = sourceCoverage(collection, cases, completeness.pairs);
  const diagnosticsBySource = perBackgroundSourceDiagnostics(cases, coverageBySource, observations);
  const metrics = {
    precisionAt5: pairedMetric(observations.precisionAt5, retrievalMetricReasons, bootstrapOptions),
    ndcgAt5: pairedMetric(observations.ndcgAt5, retrievalMetricReasons, bootstrapOptions),
    hardNegativeFprAt5: pairedMetric(observations.hardNegativeFprAt5, retrievalMetricReasons, bootstrapOptions),
    margin: pairedMetric(observations.margin, retrievalMetricReasons, bootstrapOptions),
    unsupportedAdditionRate: pairedMetric(observations.unsupportedAdditionRate, groundingMetricReasons, bootstrapOptions),
    groundingErrorRate: pairedMetric(observations.groundingErrorRate, groundingMetricReasons, bootstrapOptions),
    frameAllRejectedRate: scalarMetric(observations.frameAllRejectedRate, groundingMetricReasons, bootstrapOptions),
    frameFailedOpenRate: scalarMetric(observations.frameFailedOpenRate, groundingMetricReasons, bootstrapOptions),
  };
  const metricInsufficiencyReasons = Object.entries(metrics).flatMap(([name, metric]) =>
    metric.available ? [] : metric.reasons.map((reason: string) => `${name}: ${reason}`));
  const finalReasons = uniqueReasons([...reasons, ...metricInsufficiencyReasons]);
  const gates = evaluateHydeGates(metrics, finalReasons);
  return HydeAnalysisArtifactSchema.parse({
    artifactType: HYDE_ANALYSIS_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    policyVersion: HYDE_GATE_POLICY_VERSION,
    corpusVersion: HYDE_CORPUS_VERSION,
    rubricVersion: HYDE_RUBRIC_VERSION,
    studyId: collection.studyId,
    generatedAt: options.generatedAt ?? resolved.createdAt,
    parents: {
      collectionFingerprint: fingerprintHydeArtifact(collection),
      privateKeyFingerprint: fingerprintHydeArtifact(privateKey),
      resolvedAdjudicationFingerprint: fingerprintHydeArtifact(resolved),
      batchFingerprint: privateKey.batchFingerprint,
      corpusFingerprint: collection.corpusFingerprint,
      configFingerprint: collection.configFingerprint,
    },
    canonicality: {
      status: finalReasons.length === 0 ? 'canonical' : 'insufficient',
      reasons: finalReasons,
    },
    completeness: {
      expectedPairCount: HYDE_EXPECTED_PAIR_COUNT,
      observedPairCount: completeness.observedPairCount,
      completedPairCount: completeness.completedPairCount,
      failedPairCount: completeness.failedPairCount,
      missingPairCount: completeness.missingPairCount,
      incompletePairCount: completeness.incompletePairCount,
      incompletePairRate: completeness.incompletePairRate,
      expectedCandidateMappingCount: HYDE_EXPECTED_CANDIDATE_COUNT,
      candidateMappingCount: labels.candidateMappingCount,
      expectedGeneratedDocumentMappingCount: labels.expectedGeneratedDocumentMappingCount,
      generatedDocumentMappingCount: labels.generatedDocumentMappingCount,
    },
    sourceCoverage: coverageBySource,
    perBackgroundSource: diagnosticsBySource,
    adjudication: {
      status: resolved.status,
      canonical: resolved.canonical,
      coverage: resolved.coverage,
      counts: resolved.counts,
    },
    metrics,
    gates,
    resources: resourceDiagnostics(collection),
    limitations: [
      'The eval tests HyDE generation and retrieval inside background discovery jobs; it does not execute BullMQ, network scoping, database persistence or reuse, raw-context fallback, candidate merging, negotiation, or delivery.',
      'Saved-intent cases map to the internal query graph branch used by the current background OpportunityGraph path; query is an implementation label here, not a direct user request.',
      'Canonical retrieval and grounding labels come only from resolved independent human adjudication.',
      'Bootstrap intervals quantify this frozen corpus and execution policy; they do not establish external validity.',
      'Token usage and provider cost are unavailable from the collection artifact.',
      'Model and embedding pins identify configured primary IDs only; production retry/fallback behavior is intentionally retained, and per-call fallback provider/model identity is unavailable and not recorded.',
      'Frame extraction shares the lens-inferrer interface, so its resource timing and concurrency are not separately observable without changing production agents.',
      'Production validator diagnostics are operational, noncanonical diagnostics and never rewrite human labels.',
      'Collection embeddings cannot be recomputed from artifacts; analysis enforces score, qualification, metadata, and ranking invariants but cannot prove vector values.',
      'Independent human grades remain authoritative: if they invalidate authored positive or hard-negative structure, evidence is insufficient rather than relabeled.',
      'Artifacts are unsigned JSON: parent fingerprints detect ordinary mismatch, but coordinated edits to all parent artifacts require external custody and fingerprint review to detect.',
      'Each export file is atomically replaced, but the public/private/template three-file set is not transactional; rerunning export with --force regenerates opaque IDs, so preserve and review all three as one set.',
    ],
    noncanonicalValidatorDiagnostics: validatorAppendix(collection, labels.groundingLabels),
  });
}
