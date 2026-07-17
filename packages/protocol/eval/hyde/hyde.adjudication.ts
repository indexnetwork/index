import { HYDE_CANDIDATE_TASK_KIND, HYDE_GROUNDING_TASK_KIND, HYDE_JUDGMENT_ARTIFACT_TYPE, HYDE_RESOLVED_ADJUDICATION_ARTIFACT_TYPE, HydeJudgmentArtifactSchema, HydeResolvedAdjudicationArtifactSchema, HydeResolverDecisionsArtifactSchema, type HydeBlindPublicBatch, type HydeIndependentJudgment, type HydeJudgmentArtifact, type HydeResolvedAdjudicationArtifact, type HydeResolvedItem, type HydeResolverDecision, type HydeResolverDecisionsArtifact, type HydeUnsupportedAddition } from './hyde.schemas.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION } from './hyde.policy.js';
import { fingerprintHydeArtifact, parseHydeBlindPublicBatch } from './hyde.artifacts.js';

/** Parse and strictly validate an independent judgment artifact. */
export function parseHydeJudgmentArtifact(value: unknown): HydeJudgmentArtifact {
  return HydeJudgmentArtifactSchema.parse(value);
}

/** Parse and strictly validate blinded resolver decisions. */
export function parseHydeResolverDecisionsArtifact(value: unknown): HydeResolverDecisionsArtifact {
  return HydeResolverDecisionsArtifactSchema.parse(value);
}

/** Parse and strictly validate a resolved adjudication artifact. */
export function parseHydeResolvedAdjudicationArtifact(value: unknown): HydeResolvedAdjudicationArtifact {
  return HydeResolvedAdjudicationArtifactSchema.parse(value);
}

export const parseJudgmentArtifact = parseHydeJudgmentArtifact;
export const parseResolverDecisions = parseHydeResolverDecisionsArtifact;
export const parseResolvedAdjudicationArtifact = parseHydeResolvedAdjudicationArtifact;

export interface BuildJudgmentArtifactInput {
  adjudicatorId: string;
  adjudicatorKind: 'human' | 'llm-triage';
  blindedIndependentAttestation: boolean;
  judgments: HydeIndependentJudgment[];
  createdAt?: string;
}

/** Build a parsed independent-judgment boundary artifact from completed labels. */
export function buildHydeJudgmentArtifact(
  batch: HydeBlindPublicBatch,
  input: BuildJudgmentArtifactInput,
): HydeJudgmentArtifact {
  return parseHydeJudgmentArtifact({
    artifactType: HYDE_JUDGMENT_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    adjudicatorId: input.adjudicatorId,
    adjudicatorKind: input.adjudicatorKind,
    batchFingerprint: batch.batchFingerprint,
    blindedIndependentAttestation: input.blindedIndependentAttestation,
    judgments: input.judgments,
  });
}

interface JudgmentAssessment {
  artifact: HydeJudgmentArtifact;
  complete: boolean;
  reasons: string[];
  byId: Map<string, HydeIndependentJudgment>;
}

function assessCoverage(batch: HydeBlindPublicBatch, artifact: HydeJudgmentArtifact): JudgmentAssessment {
  const reasons: string[] = [];
  const expected = new Map(batch.items.map((item) => [item.opaqueId, item.taskKind]));
  const byId = new Map<string, HydeIndependentJudgment>();
  let duplicateCount = 0;
  let extraCount = 0;
  let kindMismatchCount = 0;

  if (artifact.batchFingerprint !== batch.batchFingerprint) reasons.push('batch fingerprint mismatch');
  for (const judgment of artifact.judgments) {
    if (byId.has(judgment.opaqueId)) duplicateCount += 1;
    else byId.set(judgment.opaqueId, judgment);
    const expectedKind = expected.get(judgment.opaqueId);
    if (!expectedKind) extraCount += 1;
    else if (expectedKind !== judgment.taskKind) kindMismatchCount += 1;
  }
  const missingCount = batch.items.filter((item) => !byId.has(item.opaqueId)).length;
  if (duplicateCount > 0) reasons.push(`${duplicateCount} duplicate judgment entries`);
  if (extraCount > 0) reasons.push(`${extraCount} extra judgment entries`);
  if (missingCount > 0) reasons.push(`${missingCount} missing judgment entries`);
  if (kindMismatchCount > 0) reasons.push(`${kindMismatchCount} task-kind mismatches`);

  return {
    artifact,
    complete: reasons.length === 0 && byId.size === batch.items.length,
    reasons,
    byId,
  };
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergeUnsupportedAdditions(additionLists: readonly HydeUnsupportedAddition[][]): HydeUnsupportedAddition[] {
  const unique = new Map<string, HydeUnsupportedAddition>();
  for (const addition of additionLists.flat()) {
    const key = JSON.stringify([addition.category, addition.excerpts, addition.rationale]);
    if (!unique.has(key)) unique.set(key, addition);
  }
  return [...unique.values()].sort((left, right) =>
    compareAscii(JSON.stringify(left), JSON.stringify(right)));
}

interface ResolverAssessment {
  decisions: Map<string, HydeResolverDecision>;
  submittedDecisionIds: string[];
  resolverId?: string;
  reasons: string[];
}

function assessResolver(
  batch: HydeBlindPublicBatch,
  resolverValue: HydeResolverDecisionsArtifact | undefined,
): ResolverAssessment {
  if (!resolverValue) return { decisions: new Map(), submittedDecisionIds: [], reasons: [] };
  const resolver = parseHydeResolverDecisionsArtifact(resolverValue);
  const reasons: string[] = [];
  const expected = new Map(batch.items.map((item) => [item.opaqueId, item.taskKind]));
  const decisions = new Map<string, HydeResolverDecision>();
  if (resolver.batchFingerprint !== batch.batchFingerprint) reasons.push('resolver batch fingerprint mismatch');
  for (const decision of resolver.decisions) {
    if (decisions.has(decision.opaqueId)) reasons.push('resolver decisions contain duplicate opaque IDs');
    decisions.set(decision.opaqueId, decision);
    const expectedKind = expected.get(decision.opaqueId);
    if (!expectedKind) reasons.push('resolver decisions contain an extra opaque ID');
    else if (expectedKind !== decision.taskKind) reasons.push('resolver decision task kind mismatch');
  }
  const submittedDecisionIds = resolver.decisions.map((decision) => decision.opaqueId);
  if (reasons.length > 0) {
    return { decisions: new Map(), submittedDecisionIds, resolverId: resolver.resolverId, reasons };
  }
  return { decisions, submittedDecisionIds, resolverId: resolver.resolverId, reasons };
}

function duplicateAdjudicatorIds(assessments: JudgmentAssessment[]): Set<string> {
  const counts = new Map<string, number>();
  for (const assessment of assessments) {
    const id = assessment.artifact.adjudicatorId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

function reasonRecord(
  item: HydeBlindPublicBatch['items'][number],
  reason: 'insufficient-independent-human-judgments' | 'invalid-human-coverage' | 'resolver-decision-required',
): HydeResolvedItem {
  return {
    status: reason === 'resolver-decision-required' ? 'unresolved' : 'missing-evidence',
    opaqueId: item.opaqueId,
    taskKind: item.taskKind,
    reason,
  };
}

export interface ResolveAdjudicationsOptions {
  createdAt?: string;
}

/**
 * Resolve blinded judgments without access to the collection artifact, private
 * re-identification key, production validator output, or author labels.
 */
export function resolveAdjudications(
  batchValue: HydeBlindPublicBatch,
  judgmentValues: readonly HydeJudgmentArtifact[],
  resolverValue?: HydeResolverDecisionsArtifact,
  options: ResolveAdjudicationsOptions = {},
): HydeResolvedAdjudicationArtifact {
  const batch = parseHydeBlindPublicBatch(batchValue);
  const assessments = judgmentValues.map((value) => assessCoverage(batch, parseHydeJudgmentArtifact(value)));
  const humanAssessments = assessments.filter((entry) => entry.artifact.adjudicatorKind === 'human');
  const triageAssessments = assessments.filter((entry) => entry.artifact.adjudicatorKind === 'llm-triage');
  const duplicateHumanIds = duplicateAdjudicatorIds(humanAssessments);
  for (const assessment of humanAssessments) {
    if (!assessment.artifact.blindedIndependentAttestation) {
      assessment.reasons.push('missing blinded independent attestation');
      assessment.complete = false;
    }
    if (duplicateHumanIds.has(assessment.artifact.adjudicatorId)) {
      assessment.reasons.push('duplicate human adjudicator ID');
      assessment.complete = false;
    }
  }
  const eligibleHumans = humanAssessments.filter((entry) => entry.complete);
  const resolver = assessResolver(batch, resolverValue);
  const artifactReasons: string[] = [...resolver.reasons];
  const resolvedItems: HydeResolvedItem[] = [];
  let agreementCount = 0;
  let disagreementCount = 0;
  let missingEvidenceCount = 0;
  const usedResolverDecisionIds = new Set<string>();

  if (eligibleHumans.length < 2) {
    artifactReasons.push('At least two distinct complete, independently attested human adjudicators are required');
    const missingReason = humanAssessments.length >= 2
      ? 'invalid-human-coverage'
      : 'insufficient-independent-human-judgments';
    for (const item of batch.items) resolvedItems.push(reasonRecord(item, missingReason));
    missingEvidenceCount = batch.items.length;
  } else {
    const adjudicatorIds = eligibleHumans.map((entry) => entry.artifact.adjudicatorId).sort(compareAscii);
    for (const item of batch.items) {
      const judgments = eligibleHumans.map((entry) => entry.byId.get(item.opaqueId));
      if (judgments.some((judgment) => !judgment)) {
        resolvedItems.push(reasonRecord(item, 'invalid-human-coverage'));
        missingEvidenceCount += 1;
        continue;
      }

      if (item.taskKind === HYDE_CANDIDATE_TASK_KIND) {
        const candidateJudgments = judgments.filter((judgment): judgment is Extract<HydeIndependentJudgment, { taskKind: 'candidate-relevance' }> =>
          judgment?.taskKind === HYDE_CANDIDATE_TASK_KIND);
        const grades = candidateJudgments.map((judgment) => judgment.relevanceGrade);
        const agreed = candidateJudgments.length === judgments.length && grades.every((grade) => grade === grades[0]);
        if (agreed) {
          agreementCount += 1;
          resolvedItems.push({
            status: 'resolved',
            opaqueId: item.opaqueId,
            taskKind: item.taskKind,
            finalRelevanceGrade: grades[0],
            resolution: 'agreement',
            adjudicatorIds,
          });
          continue;
        }

        disagreementCount += 1;
        const decision = resolver.decisions.get(item.opaqueId);
        if (decision?.taskKind === HYDE_CANDIDATE_TASK_KIND && resolver.resolverId) {
          usedResolverDecisionIds.add(item.opaqueId);
          resolvedItems.push({
            status: 'resolved',
            opaqueId: item.opaqueId,
            taskKind: item.taskKind,
            finalRelevanceGrade: decision.finalRelevanceGrade,
            resolution: 'resolver',
            adjudicatorIds,
            resolverId: resolver.resolverId,
            rationale: decision.rationale,
          });
        } else {
          resolvedItems.push(reasonRecord(item, 'resolver-decision-required'));
        }
        continue;
      }

      const groundingJudgments = judgments.filter((judgment): judgment is Extract<HydeIndependentJudgment, { taskKind: 'generated-document-grounding' }> =>
        judgment?.taskKind === HYDE_GROUNDING_TASK_KIND);
      const labels = groundingJudgments.map((judgment) => judgment.grounding);
      const agreed = groundingJudgments.length === judgments.length
        && labels[0] !== 'unable'
        && labels.every((label) => label === labels[0]);
      const mergedHumanAdditions = mergeUnsupportedAdditions(
        groundingJudgments
          .filter((judgment) => judgment.grounding === 'unsupported')
          .map((judgment) => judgment.unsupportedAdditions),
      );
      if (agreed) {
        agreementCount += 1;
        resolvedItems.push({
          status: 'resolved',
          opaqueId: item.opaqueId,
          taskKind: item.taskKind,
          finalGrounding: labels[0] as 'supported' | 'unsupported',
          unsupportedAdditions: labels[0] === 'unsupported' ? mergedHumanAdditions : [],
          resolution: 'agreement',
          adjudicatorIds,
        });
        continue;
      }

      disagreementCount += 1;
      const decision = resolver.decisions.get(item.opaqueId);
      if (decision?.taskKind === HYDE_GROUNDING_TASK_KIND && resolver.resolverId) {
        usedResolverDecisionIds.add(item.opaqueId);
        resolvedItems.push({
          status: 'resolved',
          opaqueId: item.opaqueId,
          taskKind: item.taskKind,
          finalGrounding: decision.finalGrounding,
          unsupportedAdditions: decision.finalGrounding === 'unsupported'
            ? mergeUnsupportedAdditions([mergedHumanAdditions, decision.unsupportedAdditions])
            : [],
          resolution: 'resolver',
          adjudicatorIds,
          resolverId: resolver.resolverId,
          rationale: decision.rationale,
        });
      } else {
        resolvedItems.push(reasonRecord(item, 'resolver-decision-required'));
      }
    }
  }

  const unusedResolverDecisionIds = [...new Set(resolver.submittedDecisionIds)]
    .filter((opaqueId) => !usedResolverDecisionIds.has(opaqueId))
    .sort(compareAscii);
  if (unusedResolverDecisionIds.length > 0) {
    artifactReasons.push(
      `${unusedResolverDecisionIds.length} resolver decisions were unused because decisions are allowed only for disagreement/unable items: ${unusedResolverDecisionIds.join(', ')}`,
    );
  }
  const resolvedCount = resolvedItems.filter((item) => item.status === 'resolved').length;
  const unresolvedCount = resolvedItems.length - resolvedCount;
  const invalidHumanArtifactCount = humanAssessments.length - eligibleHumans.length;
  if (unresolvedCount > 0) artifactReasons.push(`${unresolvedCount} items remain unresolved or lack human evidence`);
  if (invalidHumanArtifactCount > 0) {
    artifactReasons.push(`${invalidHumanArtifactCount} submitted human judgment artifacts are invalid, incomplete, unattested, or duplicated`);
  }
  const status = unresolvedCount === 0 && unusedResolverDecisionIds.length === 0
    ? 'complete'
    : 'incomplete';
  const canonical = status === 'complete'
    && eligibleHumans.length >= 2
    && invalidHumanArtifactCount === 0
    && resolver.reasons.length === 0;
  const sourceJudgments = assessments.map(({ artifact }) => ({
    fingerprint: fingerprintHydeArtifact(artifact),
    adjudicatorId: artifact.adjudicatorId,
    adjudicatorKind: artifact.adjudicatorKind,
  })).sort((left, right) => compareAscii(left.adjudicatorKind, right.adjudicatorKind)
    || compareAscii(left.adjudicatorId, right.adjudicatorId)
    || compareAscii(left.fingerprint, right.fingerprint));

  return parseHydeResolvedAdjudicationArtifact({
    artifactType: HYDE_RESOLVED_ADJUDICATION_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    studyId: batch.studyId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    batchFingerprint: batch.batchFingerprint,
    sourceProvenance: {
      judgmentArtifacts: sourceJudgments,
      ...(resolverValue
        ? { resolverDecisionsFingerprint: fingerprintHydeArtifact(parseHydeResolverDecisionsArtifact(resolverValue)) }
        : {}),
    },
    status,
    canonical,
    reasons: [...new Set(artifactReasons)],
    coverage: {
      publicItemCount: batch.items.length,
      submittedHumanArtifactCount: humanAssessments.length,
      completeAttestedHumanAdjudicatorCount: eligibleHumans.length,
      invalidHumanArtifactCount,
      triageArtifactCount: triageAssessments.length,
      completeTriageArtifactCount: triageAssessments.filter((entry) => entry.complete).length,
    },
    counts: {
      resolved: resolvedCount,
      agreement: agreementCount,
      disagreement: disagreementCount,
      unresolved: unresolvedCount,
      missingEvidence: missingEvidenceCount,
    },
    diagnostics: {
      invalidJudgmentArtifacts: assessments
        .filter((entry) => entry.reasons.length > 0)
        .map((entry) => ({
          adjudicatorId: entry.artifact.adjudicatorId,
          reasons: [...new Set(entry.reasons)],
        })),
      triage: triageAssessments.map((entry) => ({
        adjudicatorId: entry.artifact.adjudicatorId,
        complete: entry.complete,
        attested: entry.artifact.blindedIndependentAttestation,
      })),
    },
    items: resolvedItems,
  });
}
