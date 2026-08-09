import type { CaseResultLike } from "../shared/index.js";

export type HistoricalEvidenceType = "intent" | "premise" | "user_context";

export interface HistoricalRetrievalEvidenceRow {
  participantId: string;
  score: number;
  evidenceType: HistoricalEvidenceType;
  evidenceId: string;
}

export interface HistoricalRetrievedUser {
  participantId: string;
  retrievalRank: number;
  bestScore: number;
  evidenceTypes: HistoricalEvidenceType[];
  evidenceIds: string[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ERROR_CLASS = /^[a-z][a-z0-9_-]{0,63}$/;
const EVIDENCE_TYPES = new Set<HistoricalEvidenceType>(["intent", "premise", "user_context"]);

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} must be a non-empty stable ID`);
}

export function dedupeHistoricalRetrieval(rows: readonly HistoricalRetrievalEvidenceRow[]): HistoricalRetrievedUser[] {
  const grouped = new Map<string, { bestScore: number; evidenceTypes: Set<HistoricalEvidenceType>; evidenceIds: Set<string> }>();
  for (const row of rows) {
    if (row.participantId.trim() === "") throw new Error("Historical retrieval participantId must be non-empty");
    if (!Number.isFinite(row.score)) throw new Error(`Historical retrieval ${row.participantId} requires a finite score`);
    if (row.evidenceId.trim() === "") throw new Error(`Historical retrieval ${row.participantId} evidenceId must be non-empty`);
    const current = grouped.get(row.participantId) ?? {
      bestScore: Number.NEGATIVE_INFINITY,
      evidenceTypes: new Set<HistoricalEvidenceType>(),
      evidenceIds: new Set<string>(),
    };
    current.bestScore = Math.max(current.bestScore, row.score);
    current.evidenceTypes.add(row.evidenceType);
    current.evidenceIds.add(row.evidenceId);
    grouped.set(row.participantId, current);
  }
  return [...grouped.entries()]
    .sort(([aId, a], [bId, b]) => b.bestScore - a.bestScore || aId.localeCompare(bId))
    .map(([participantId, value], index) => ({
      participantId,
      retrievalRank: index + 1,
      bestScore: value.bestScore,
      evidenceTypes: [...value.evidenceTypes].sort(),
      evidenceIds: [...value.evidenceIds].sort(),
    }));
}

export type HistoricalFailureStage =
  | "execution"
  | "retrieval"
  | "evaluation_admission"
  | "evaluation_rejection"
  | "finalization"
  | "none";

const FAILURE_STAGES: readonly HistoricalFailureStage[] = [
  "execution",
  "retrieval",
  "evaluation_admission",
  "evaluation_rejection",
  "finalization",
  "none",
];

export interface HistoricalFailureInput {
  completed: boolean;
  targetId: string;
  retrievedParticipantIds: readonly string[];
  evaluator: {
    eligible: boolean;
    submitted: boolean;
    returned: boolean;
    finalIncluded: boolean;
  };
}

export function classifyHistoricalFailureStage(input: HistoricalFailureInput): HistoricalFailureStage {
  if (!input.completed) return "execution";
  if (!input.retrievedParticipantIds.includes(input.targetId)) return "retrieval";
  if (!input.evaluator.eligible || !input.evaluator.submitted) return "evaluation_admission";
  if (!input.evaluator.returned) return "evaluation_rejection";
  if (!input.evaluator.finalIncluded) return "finalization";
  return "none";
}

export type HistoricalCandidateRole = "target" | "semantic-negative" | "background";

export interface HistoricalCandidateMetricInput {
  participantId: string;
  role: HistoricalCandidateRole;
}

export interface HistoricalEvaluatorTrace {
  participantId: string;
  eligible: boolean;
  submitted: boolean;
  returned: boolean;
  score: number | null;
  errorClass?: string;
}

export interface HistoricalParticipantMetricsInput {
  completed: boolean;
  candidates: readonly HistoricalCandidateMetricInput[];
  retrievalEvidence: readonly HistoricalRetrievalEvidenceRow[];
  evaluatorTraces: readonly HistoricalEvaluatorTrace[];
  /** Ordered, thresholded evaluator output. This is the sole final-rank authority. */
  evaluatedOpportunities: readonly string[];
}

export interface HistoricalParticipantMetric {
  participantId: string;
  role: HistoricalCandidateRole;
  retrieval: null | {
    rank: number;
    bestScore: number;
    evidenceIds: string[];
    evidenceTypes: HistoricalEvidenceType[];
  };
  evaluator: {
    eligible: boolean;
    submitted: boolean;
    returned: boolean;
    score: number | null;
    errorClass?: string;
  };
  finalRank: number | null;
  failureStage: HistoricalFailureStage;
}

function assertExactCandidates(candidates: readonly HistoricalCandidateMetricInput[]): Map<string, HistoricalCandidateMetricInput> {
  if (candidates.length !== 24) throw new Error("Historical quality requires exactly 24 candidates");
  const byId = new Map<string, HistoricalCandidateMetricInput>();
  const roleCounts: Record<HistoricalCandidateRole, number> = {
    target: 0,
    "semantic-negative": 0,
    background: 0,
  };
  for (const candidate of candidates) {
    assertSafeId(candidate.participantId, "Historical candidate participantId");
    if (byId.has(candidate.participantId)) throw new Error(`Historical quality duplicate participant ${candidate.participantId}`);
    if (!Object.prototype.hasOwnProperty.call(roleCounts, candidate.role)) throw new Error(`Historical quality participant ${candidate.participantId} has an invalid role`);
    byId.set(candidate.participantId, candidate);
    roleCounts[candidate.role] += 1;
  }
  if (roleCounts.target !== 1 || roleCounts["semantic-negative"] !== 3 || roleCounts.background !== 20) {
    throw new Error("Historical quality requires 1 target, 3 semantic-negative, and 20 background candidates");
  }
  return byId;
}

function assertEvaluatorTrace(trace: HistoricalEvaluatorTrace, retrieved: boolean): void {
  assertSafeId(trace.participantId, "Historical evaluator participantId");
  if (typeof trace.eligible !== "boolean" || typeof trace.submitted !== "boolean" || typeof trace.returned !== "boolean") {
    throw new Error(`Historical evaluator ${trace.participantId} states must be boolean`);
  }
  if (trace.submitted && !trace.eligible) throw new Error(`Historical evaluator ${trace.participantId} submitted without eligibility`);
  if (trace.returned && !trace.submitted) throw new Error(`Historical evaluator ${trace.participantId} returned without submission`);
  if (trace.eligible && !retrieved) throw new Error(`Historical evaluator ${trace.participantId} eligible without retrieval`);
  if (trace.returned) {
    if (trace.score === null || !Number.isFinite(trace.score)) {
      throw new Error(`Historical evaluator ${trace.participantId} requires a finite score when returned`);
    }
  } else if (trace.score !== null) {
    throw new Error(`Historical evaluator ${trace.participantId} score requires a returned evaluation`);
  }
  if (trace.errorClass !== undefined && !SAFE_ERROR_CLASS.test(trace.errorClass)) {
    throw new Error(`Historical evaluator ${trace.participantId} requires a safe error class`);
  }
}

export function buildHistoricalParticipantMetrics(input: HistoricalParticipantMetricsInput): HistoricalParticipantMetric[] {
  if (typeof input.completed !== "boolean") throw new Error("Historical quality completed state must be boolean");
  const candidatesById = assertExactCandidates(input.candidates);
  for (const row of input.retrievalEvidence) {
    assertSafeId(row.participantId, "Historical retrieval participantId");
    assertSafeId(row.evidenceId, "Historical retrieval evidenceId");
    if (!EVIDENCE_TYPES.has(row.evidenceType)) throw new Error(`Historical retrieval ${row.participantId} has an invalid evidence type`);
  }
  const retrieved = dedupeHistoricalRetrieval(input.retrievalEvidence);
  const retrievedById = new Map(retrieved.map((row) => [row.participantId, row]));
  for (const participantId of retrievedById.keys()) {
    if (!candidatesById.has(participantId)) throw new Error(`Historical retrieval contains unknown participant ${participantId}`);
  }

  if (input.evaluatorTraces.length !== 24) throw new Error("Historical quality requires one evaluator trace for each of 24 candidates");
  const tracesById = new Map<string, HistoricalEvaluatorTrace>();
  for (const trace of input.evaluatorTraces) {
    if (!candidatesById.has(trace.participantId)) throw new Error(`Historical evaluator contains unknown participant ${trace.participantId}`);
    if (tracesById.has(trace.participantId)) throw new Error(`Historical evaluator duplicate participant ${trace.participantId}`);
    assertEvaluatorTrace(trace, retrievedById.has(trace.participantId));
    tracesById.set(trace.participantId, trace);
  }
  if (tracesById.size !== candidatesById.size) throw new Error("Historical quality requires one evaluator trace for each candidate");

  const finalRanks = new Map<string, number>();
  for (const [index, participantId] of input.evaluatedOpportunities.entries()) {
    assertSafeId(participantId, "Historical thresholded participantId");
    if (finalRanks.has(participantId)) throw new Error(`Historical quality duplicate thresholded participant ${participantId}`);
    const trace = tracesById.get(participantId);
    if (!trace) throw new Error(`Historical thresholded output contains unknown participant ${participantId}`);
    if (!trace.returned) throw new Error(`Historical thresholded participant must have returned: ${participantId}`);
    finalRanks.set(participantId, index + 1);
  }

  const retrievedParticipantIds = [...retrievedById.keys()];
  return [...candidatesById.values()]
    .sort((a, b) => a.participantId.localeCompare(b.participantId))
    .map((candidate) => {
      const retrieval = retrievedById.get(candidate.participantId);
      const trace = tracesById.get(candidate.participantId)!;
      const finalRank = input.completed ? finalRanks.get(candidate.participantId) ?? null : null;
      const evaluator = {
        eligible: trace.eligible,
        submitted: trace.submitted,
        returned: trace.returned,
        score: trace.score,
        ...(trace.errorClass === undefined ? {} : { errorClass: trace.errorClass }),
      };
      return {
        participantId: candidate.participantId,
        role: candidate.role,
        retrieval: retrieval === undefined ? null : {
          rank: retrieval.retrievalRank,
          bestScore: retrieval.bestScore,
          evidenceIds: [...retrieval.evidenceIds],
          evidenceTypes: [...retrieval.evidenceTypes],
        },
        evaluator,
        finalRank,
        failureStage: classifyHistoricalFailureStage({
          completed: input.completed,
          targetId: candidate.participantId,
          retrievedParticipantIds,
          evaluator: {
            eligible: trace.eligible,
            submitted: trace.submitted,
            returned: trace.returned,
            finalIncluded: finalRank !== null,
          },
        }),
      };
    });
}

export interface HistoricalStageCounts {
  total: number;
  retrieved: number;
  evaluatorEligible: number;
  evaluatorSubmitted: number;
  evaluatorReturned: number;
  finalIncluded: number;
}

export interface HistoricalRankSummary {
  count: number;
  sum: number;
  mean: number | null;
}

export interface HistoricalStageFunnel {
  slots: number;
  participants: number;
  target: HistoricalStageCounts;
  semanticNegatives: HistoricalStageCounts;
  backgrounds: HistoricalStageCounts;
  targetRetrievalRank: HistoricalRankSummary;
  targetFinalRank: HistoricalRankSummary;
  failureStages: Record<HistoricalFailureStage, number>;
}

export type HistoricalQualitySlotSummary =
  | {
    qualityVerdictAvailable: true;
    completed: true;
    summary: HistoricalStageFunnel;
  }
  | {
    qualityVerdictAvailable: false;
    completed: false;
    summary: null;
    message: "no quality verdict";
  };

export interface HistoricalQualitySlotInput {
  completed: boolean;
  participantMetrics?: readonly HistoricalParticipantMetric[];
  /** Transport completeness only. Deliberately ignored by quality aggregation. */
  passes?: number;
}

export type HistoricalQualityRunSummary =
  | {
    qualityVerdictAvailable: true;
    completedSlots: number;
    requestedSlots: number;
    summary: HistoricalStageFunnel;
  }
  | {
    qualityVerdictAvailable: false;
    completedSlots: number;
    requestedSlots: number;
    summary: null;
    message: "no quality verdict";
  };

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => SAFE_ID.test(value) && (index === 0 || values[index - 1]!.localeCompare(value) < 0));
}

function isValidMetricSet(metrics: readonly HistoricalParticipantMetric[]): boolean {
  try {
    const candidates = metrics.map(({ participantId, role }) => ({ participantId, role }));
    assertExactCandidates(candidates);
    const retrievedIds = metrics.filter(({ retrieval }) => retrieval !== null).map(({ participantId }) => participantId);
    const retrievalRanks: number[] = [];
    const finalRanks: number[] = [];

    for (const metric of metrics) {
      if (metric.retrieval !== null) {
        if (!Number.isInteger(metric.retrieval.rank) || metric.retrieval.rank < 1 || metric.retrieval.rank > 24) return false;
        if (!Number.isFinite(metric.retrieval.bestScore)) return false;
        if (metric.retrieval.evidenceIds.length === 0 || !isSortedUnique(metric.retrieval.evidenceIds)) return false;
        if (metric.retrieval.evidenceTypes.length === 0
          || metric.retrieval.evidenceTypes.some((type) => !EVIDENCE_TYPES.has(type))
          || metric.retrieval.evidenceTypes.some((type, index, values) => index > 0 && values[index - 1]!.localeCompare(type) >= 0)) return false;
        retrievalRanks.push(metric.retrieval.rank);
      }
      assertEvaluatorTrace({ participantId: metric.participantId, ...metric.evaluator }, metric.retrieval !== null);
      if (metric.finalRank !== null) {
        if (!Number.isInteger(metric.finalRank) || metric.finalRank < 1 || metric.finalRank > 24 || !metric.evaluator.returned) return false;
        finalRanks.push(metric.finalRank);
      }
      if (!FAILURE_STAGES.includes(metric.failureStage) || metric.failureStage === "execution") return false;
      const expectedFailure = classifyHistoricalFailureStage({
        completed: true,
        targetId: metric.participantId,
        retrievedParticipantIds: retrievedIds,
        evaluator: {
          eligible: metric.evaluator.eligible,
          submitted: metric.evaluator.submitted,
          returned: metric.evaluator.returned,
          finalIncluded: metric.finalRank !== null,
        },
      });
      if (metric.failureStage !== expectedFailure) return false;
    }

    const contiguous = (ranks: number[]): boolean => [...ranks].sort((a, b) => a - b).every((rank, index) => rank === index + 1);
    return contiguous(retrievalRanks) && contiguous(finalRanks);
  } catch {
    return false;
  }
}

function emptyStageCounts(): HistoricalStageCounts {
  return { total: 0, retrieved: 0, evaluatorEligible: 0, evaluatorSubmitted: 0, evaluatorReturned: 0, finalIncluded: 0 };
}

function emptyRankSummary(): HistoricalRankSummary {
  return { count: 0, sum: 0, mean: null };
}

function emptyFunnel(): HistoricalStageFunnel {
  return {
    slots: 0,
    participants: 0,
    target: emptyStageCounts(),
    semanticNegatives: emptyStageCounts(),
    backgrounds: emptyStageCounts(),
    targetRetrievalRank: emptyRankSummary(),
    targetFinalRank: emptyRankSummary(),
    failureStages: {
      execution: 0,
      retrieval: 0,
      evaluation_admission: 0,
      evaluation_rejection: 0,
      finalization: 0,
      none: 0,
    },
  };
}

function addMetricToCounts(counts: HistoricalStageCounts, metric: HistoricalParticipantMetric): void {
  counts.total += 1;
  counts.retrieved += Number(metric.retrieval !== null);
  counts.evaluatorEligible += Number(metric.evaluator.eligible);
  counts.evaluatorSubmitted += Number(metric.evaluator.submitted);
  counts.evaluatorReturned += Number(metric.evaluator.returned);
  counts.finalIncluded += Number(metric.finalRank !== null);
}

function finalizeRankSummary(summary: HistoricalRankSummary): void {
  summary.mean = summary.count === 0 ? null : summary.sum / summary.count;
}

function funnelFromMetrics(metrics: readonly HistoricalParticipantMetric[]): HistoricalStageFunnel {
  const funnel = emptyFunnel();
  funnel.slots = 1;
  funnel.participants = metrics.length;
  for (const metric of metrics) {
    const counts = metric.role === "target"
      ? funnel.target
      : metric.role === "semantic-negative"
        ? funnel.semanticNegatives
        : funnel.backgrounds;
    addMetricToCounts(counts, metric);
    funnel.failureStages[metric.failureStage] += 1;
    if (metric.role === "target" && metric.retrieval !== null) {
      funnel.targetRetrievalRank.count += 1;
      funnel.targetRetrievalRank.sum += metric.retrieval.rank;
    }
    if (metric.role === "target" && metric.finalRank !== null) {
      funnel.targetFinalRank.count += 1;
      funnel.targetFinalRank.sum += metric.finalRank;
    }
  }
  finalizeRankSummary(funnel.targetRetrievalRank);
  finalizeRankSummary(funnel.targetFinalRank);
  return funnel;
}

export function summarizeHistoricalQualitySlot(input: HistoricalQualitySlotInput): HistoricalQualitySlotSummary {
  if (!input.completed || input.participantMetrics === undefined || !isValidMetricSet(input.participantMetrics)) {
    return { qualityVerdictAvailable: false, completed: false, summary: null, message: "no quality verdict" };
  }
  return {
    qualityVerdictAvailable: true,
    completed: true,
    summary: funnelFromMetrics(input.participantMetrics),
  };
}

function addStageCounts(target: HistoricalStageCounts, source: HistoricalStageCounts): void {
  target.total += source.total;
  target.retrieved += source.retrieved;
  target.evaluatorEligible += source.evaluatorEligible;
  target.evaluatorSubmitted += source.evaluatorSubmitted;
  target.evaluatorReturned += source.evaluatorReturned;
  target.finalIncluded += source.finalIncluded;
}

function aggregateFunnels(funnels: readonly HistoricalStageFunnel[]): HistoricalStageFunnel {
  const aggregate = emptyFunnel();
  for (const funnel of funnels) {
    aggregate.slots += funnel.slots;
    aggregate.participants += funnel.participants;
    addStageCounts(aggregate.target, funnel.target);
    addStageCounts(aggregate.semanticNegatives, funnel.semanticNegatives);
    addStageCounts(aggregate.backgrounds, funnel.backgrounds);
    aggregate.targetRetrievalRank.count += funnel.targetRetrievalRank.count;
    aggregate.targetRetrievalRank.sum += funnel.targetRetrievalRank.sum;
    aggregate.targetFinalRank.count += funnel.targetFinalRank.count;
    aggregate.targetFinalRank.sum += funnel.targetFinalRank.sum;
    for (const stage of FAILURE_STAGES) aggregate.failureStages[stage] += funnel.failureStages[stage];
  }
  finalizeRankSummary(aggregate.targetRetrievalRank);
  finalizeRankSummary(aggregate.targetFinalRank);
  return aggregate;
}

function isValidStageCounts(counts: HistoricalStageCounts, expectedTotal: number): boolean {
  const values = [
    counts.total,
    counts.retrieved,
    counts.evaluatorEligible,
    counts.evaluatorSubmitted,
    counts.evaluatorReturned,
    counts.finalIncluded,
  ];
  return values.every((value) => Number.isInteger(value) && value >= 0)
    && counts.total === expectedTotal
    && counts.retrieved >= counts.evaluatorEligible
    && counts.evaluatorEligible >= counts.evaluatorSubmitted
    && counts.evaluatorSubmitted >= counts.evaluatorReturned
    && counts.evaluatorReturned >= counts.finalIncluded;
}

function isValidRankSummary(summary: HistoricalRankSummary, expectedCount: number): boolean {
  return Number.isInteger(summary.count)
    && summary.count === expectedCount
    && Number.isInteger(summary.sum)
    && summary.sum >= summary.count
    && summary.sum <= summary.count * 24
    && summary.mean === (summary.count === 0 ? null : summary.sum / summary.count);
}

function isValidSingleSlotFunnel(funnel: HistoricalStageFunnel): boolean {
  if (funnel.slots !== 1
    || funnel.participants !== 24
    || !isValidStageCounts(funnel.target, 1)
    || !isValidStageCounts(funnel.semanticNegatives, 3)
    || !isValidStageCounts(funnel.backgrounds, 20)
    || !isValidRankSummary(funnel.targetRetrievalRank, funnel.target.retrieved)
    || !isValidRankSummary(funnel.targetFinalRank, funnel.target.finalIncluded)) return false;

  const total = (key: keyof HistoricalStageCounts): number =>
    funnel.target[key] + funnel.semanticNegatives[key] + funnel.backgrounds[key];
  return FAILURE_STAGES.every((stage) => Number.isInteger(funnel.failureStages[stage]) && funnel.failureStages[stage] >= 0)
    && funnel.failureStages.execution === 0
    && funnel.failureStages.retrieval === 24 - total("retrieved")
    && funnel.failureStages.evaluation_admission === total("retrieved") - total("evaluatorSubmitted")
    && funnel.failureStages.evaluation_rejection === total("evaluatorSubmitted") - total("evaluatorReturned")
    && funnel.failureStages.finalization === total("evaluatorReturned") - total("finalIncluded")
    && funnel.failureStages.none === total("finalIncluded");
}

export function summarizeHistoricalQualityRun(
  slots: readonly (HistoricalQualitySlotSummary | null | undefined)[],
  requestedSlots = slots.length,
): HistoricalQualityRunSummary {
  if (!Number.isInteger(requestedSlots) || requestedSlots < 1) {
    throw new Error("Historical quality run requires a positive requested slot count");
  }
  const completed = slots.filter((slot): slot is Extract<HistoricalQualitySlotSummary, { qualityVerdictAvailable: true }> =>
    slot?.qualityVerdictAvailable === true && slot.completed === true && isValidSingleSlotFunnel(slot.summary));
  if (slots.length !== requestedSlots || completed.length !== requestedSlots) {
    return {
      qualityVerdictAvailable: false,
      completedSlots: completed.length,
      requestedSlots,
      summary: null,
      message: "no quality verdict",
    };
  }
  return {
    qualityVerdictAvailable: true,
    completedSlots: completed.length,
    requestedSlots,
    summary: aggregateFunnels(completed.map(({ summary }) => summary)),
  };
}

export function executionCompletenessFields(
  completed: boolean,
): Pick<CaseResultLike, "runs" | "passes" | "passRate" | "flaky"> {
  return { runs: 1, passes: completed ? 1 : 0, passRate: completed ? 1 : 0, flaky: false };
}
