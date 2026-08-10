import type { HistoricalQualityCase, HistoricalStageFunnel } from '../api/client';

export interface HistoricalQualityCaseGroup {
  logicalCaseId: string;
  trigger: HistoricalQualityCase['trigger'];
  repetitions: number[];
  completedRepetitions: number;
  requestedRepetitions: number;
  stageFunnel: HistoricalStageFunnel;
  targetRetrievalRanks: Array<number | null>;
  targetFinalRanks: Array<number | null>;
  rows: HistoricalQualityCase[];
}

const FAILURE_STAGES: Array<keyof HistoricalStageFunnel['failureStages']> = [
  'execution',
  'retrieval',
  'evaluation_admission',
  'evaluation_rejection',
  'finalization',
  'none',
];

function aggregateFunnels(funnels: readonly HistoricalStageFunnel[]): HistoricalStageFunnel {
  const counts = () => ({
    total: 0,
    retrieved: 0,
    evaluatorEligible: 0,
    evaluatorSubmitted: 0,
    evaluatorReturned: 0,
    finalIncluded: 0,
  });
  const aggregate: HistoricalStageFunnel = {
    slots: 0,
    participants: 0,
    target: counts(),
    semanticNegatives: counts(),
    backgrounds: counts(),
    targetRetrievalRank: { count: 0, sum: 0, mean: null },
    targetFinalRank: { count: 0, sum: 0, mean: null },
    failureStages: {
      execution: 0,
      retrieval: 0,
      evaluation_admission: 0,
      evaluation_rejection: 0,
      finalization: 0,
      none: 0,
    },
  };
  const addCounts = (
    target: HistoricalStageFunnel['target'],
    source: HistoricalStageFunnel['target'],
  ) => {
    target.total += source.total;
    target.retrieved += source.retrieved;
    target.evaluatorEligible += source.evaluatorEligible;
    target.evaluatorSubmitted += source.evaluatorSubmitted;
    target.evaluatorReturned += source.evaluatorReturned;
    target.finalIncluded += source.finalIncluded;
  };

  for (const funnel of funnels) {
    aggregate.slots += funnel.slots;
    aggregate.participants += funnel.participants;
    addCounts(aggregate.target, funnel.target);
    addCounts(aggregate.semanticNegatives, funnel.semanticNegatives);
    addCounts(aggregate.backgrounds, funnel.backgrounds);
    aggregate.targetRetrievalRank.count += funnel.targetRetrievalRank.count;
    aggregate.targetRetrievalRank.sum += funnel.targetRetrievalRank.sum;
    aggregate.targetFinalRank.count += funnel.targetFinalRank.count;
    aggregate.targetFinalRank.sum += funnel.targetFinalRank.sum;
    for (const stage of FAILURE_STAGES) {
      aggregate.failureStages[stage] += funnel.failureStages[stage];
    }
  }
  aggregate.targetRetrievalRank.mean = aggregate.targetRetrievalRank.count === 0
    ? null
    : aggregate.targetRetrievalRank.sum / aggregate.targetRetrievalRank.count;
  aggregate.targetFinalRank.mean = aggregate.targetFinalRank.count === 0
    ? null
    : aggregate.targetFinalRank.sum / aggregate.targetFinalRank.count;
  return aggregate;
}

/** Groups already schema-validated artifact rows without importing protocol or zod at runtime. */
export function groupHistoricalQualityCases(
  cases: readonly HistoricalQualityCase[],
  requested: { requestedSlots: number; repetitionsRequested: number },
): HistoricalQualityCaseGroup[] {
  if (!Number.isInteger(requested.requestedSlots) || requested.requestedSlots < 1
    || !Number.isInteger(requested.repetitionsRequested) || requested.repetitionsRequested < 1) {
    throw new Error('Historical quality grouping requires positive requested-slot and repetition counts');
  }
  if (cases.length !== requested.requestedSlots) {
    throw new Error('Historical quality grouping row count does not match requested slots');
  }
  const grouped = new Map<string, HistoricalQualityCase[]>();
  const tuples = new Set<string>();
  for (const row of cases) {
    const tuple = JSON.stringify([row.logicalCaseId, row.trigger, row.repetition]);
    if (tuples.has(tuple)) throw new Error('Duplicate historical quality repetition');
    tuples.add(tuple);
    if (!row.completed || row.stageFunnel === null) {
      throw new Error('Historical quality grouping requires complete evidence');
    }
    const key = JSON.stringify([row.logicalCaseId, row.trigger]);
    const members = grouped.get(key) ?? [];
    members.push(row);
    grouped.set(key, members);
  }
  if (grouped.size * requested.repetitionsRequested !== requested.requestedSlots) {
    throw new Error('Historical quality grouping failed requested-slot math');
  }
  for (const members of grouped.values()) {
    const repetitions = members.map(({ repetition }) => repetition).sort((left, right) => left - right);
    if (repetitions.length !== requested.repetitionsRequested
      || !repetitions.every((repetition, index) => repetition === index)) {
      throw new Error('Historical quality grouping requires exact repetition coverage');
    }
  }

  return [...grouped.values()]
    .map((members): HistoricalQualityCaseGroup => {
      const rows = [...members].sort((left, right) => left.repetition - right.repetition);
      const targetRanks = rows.map((row) => {
        const target = row.participantMetrics.find((metric) => metric.role === 'target');
        if (!target) throw new Error('Historical quality group is missing its target');
        return {
          retrieval: target.retrieval?.rank ?? null,
          final: target.finalRank,
        };
      });
      return {
        logicalCaseId: rows[0]!.logicalCaseId,
        trigger: rows[0]!.trigger,
        repetitions: rows.map(({ repetition }) => repetition),
        completedRepetitions: requested.repetitionsRequested,
        requestedRepetitions: requested.repetitionsRequested,
        stageFunnel: aggregateFunnels(rows.map((row) => row.stageFunnel!)),
        targetRetrievalRanks: targetRanks.map(({ retrieval }) => retrieval),
        targetFinalRanks: targetRanks.map(({ final }) => final),
        rows,
      };
    })
    .sort((left, right) => left.logicalCaseId.localeCompare(right.logicalCaseId)
      || left.trigger.localeCompare(right.trigger));
}
