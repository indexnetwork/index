import { HYDE_GATE_POLICY_VERSION, HYDE_GATE_THRESHOLDS } from './hyde.policy.js';
import { HYDE_GATE_IDS, type HydeGateRecord, type HydePairedMetricAnalysis, type HydeScalarMetricAnalysis } from './hyde.schemas.js';

export interface HydeGateMetricInputs {
  precisionAt5: HydePairedMetricAnalysis;
  ndcgAt5: HydePairedMetricAnalysis;
  hardNegativeFprAt5: HydePairedMetricAnalysis;
  margin: HydePairedMetricAnalysis;
  groundingErrorRate: HydePairedMetricAnalysis;
  frameAllRejectedRate: HydeScalarMetricAnalysis;
  frameFailedOpenRate: HydeScalarMetricAnalysis;
}

export interface HydeGateEvaluation {
  policyVersion: typeof HYDE_GATE_POLICY_VERSION;
  overall: 'pass' | 'fail' | 'insufficient';
  records: HydeGateRecord[];
}

type Comparator = HydeGateRecord['comparator'];
type GateStatus = HydeGateRecord['status'];

interface GateDefinition {
  id: typeof HYDE_GATE_IDS[number];
  comparator: Comparator;
  threshold: number;
  readBound: () => number | null;
}

function unavailableReasons(metrics: HydeGateMetricInputs): string[] {
  const reasons: string[] = [];
  for (const [name, metric] of Object.entries(metrics)) {
    if (!metric.available) reasons.push(...metric.reasons.map((reason: string) => `${name}: ${reason}`));
  }
  return reasons;
}

function compare(value: number, comparator: Comparator, threshold: number): boolean {
  if (comparator === '<') return value < threshold;
  if (comparator === '<=') return value <= threshold;
  return value >= threshold;
}

function boundReason(status: Exclude<GateStatus, 'insufficient'>, value: number, definition: GateDefinition): string {
  return `${definition.id} bound ${value} ${status === 'pass' ? 'satisfies' : 'does not satisfy'} ${definition.comparator} ${definition.threshold}`;
}

/** Evaluate only the eight versioned canonical gates, with their exact bound semantics. */
export function evaluateHydeGates(
  metrics: HydeGateMetricInputs,
  canonicalityReasons: readonly string[] = [],
): HydeGateEvaluation {
  const globalReasons = [...new Set([...canonicalityReasons, ...unavailableReasons(metrics)])];
  const definitions: GateDefinition[] = [
    {
      id: 'grounding-delta-upper-exclusive-zero',
      comparator: '<',
      threshold: HYDE_GATE_THRESHOLDS.groundingDeltaCiUpperExclusive,
      readBound: () => metrics.groundingErrorRate.available
        ? metrics.groundingErrorRate.confidenceIntervals.delta.upper
        : null,
    },
    {
      id: 'frame-grounding-upper',
      comparator: '<=',
      threshold: HYDE_GATE_THRESHOLDS.frameGroundingCiUpperInclusive,
      readBound: () => metrics.groundingErrorRate.available
        ? metrics.groundingErrorRate.confidenceIntervals.frameV1.upper
        : null,
    },
    {
      id: 'precision-at-5-delta-lower',
      comparator: '>=',
      threshold: HYDE_GATE_THRESHOLDS.precisionAt5DeltaCiLowerInclusive,
      readBound: () => metrics.precisionAt5.available
        ? metrics.precisionAt5.confidenceIntervals.delta.lower
        : null,
    },
    {
      id: 'ndcg-at-5-delta-lower',
      comparator: '>=',
      threshold: HYDE_GATE_THRESHOLDS.ndcgAt5DeltaCiLowerInclusive,
      readBound: () => metrics.ndcgAt5.available
        ? metrics.ndcgAt5.confidenceIntervals.delta.lower
        : null,
    },
    {
      id: 'margin-delta-lower',
      comparator: '>=',
      threshold: HYDE_GATE_THRESHOLDS.marginDeltaCiLowerInclusive,
      readBound: () => metrics.margin.available
        ? metrics.margin.confidenceIntervals.delta.lower
        : null,
    },
    {
      id: 'hard-negative-fpr-delta-upper',
      comparator: '<=',
      threshold: HYDE_GATE_THRESHOLDS.hardNegativeFprDeltaCiUpperInclusive,
      readBound: () => metrics.hardNegativeFprAt5.available
        ? metrics.hardNegativeFprAt5.confidenceIntervals.delta.upper
        : null,
    },
    {
      id: 'frame-all-rejected-upper',
      comparator: '<=',
      threshold: HYDE_GATE_THRESHOLDS.frameAllRejectedCiUpperInclusive,
      readBound: () => metrics.frameAllRejectedRate.available
        ? metrics.frameAllRejectedRate.confidenceInterval.upper
        : null,
    },
    {
      id: 'frame-failed-open-upper',
      comparator: '<=',
      threshold: HYDE_GATE_THRESHOLDS.frameFailedOpenCiUpperInclusive,
      readBound: () => metrics.frameFailedOpenRate.available
        ? metrics.frameFailedOpenRate.confidenceInterval.upper
        : null,
    },
  ];

  const records: HydeGateRecord[] = definitions.map((definition) => {
    const boundValue = definition.readBound();
    if (globalReasons.length > 0 || boundValue === null) {
      return {
        policyVersion: HYDE_GATE_POLICY_VERSION,
        id: definition.id,
        boundValue,
        comparator: definition.comparator,
        threshold: definition.threshold,
        status: 'insufficient',
        reason: globalReasons.length > 0
          ? `Canonical evidence is insufficient: ${globalReasons.join('; ')}`
          : 'Required confidence-interval bound is unavailable',
      };
    }
    const status = compare(boundValue, definition.comparator, definition.threshold) ? 'pass' : 'fail';
    return {
      policyVersion: HYDE_GATE_POLICY_VERSION,
      id: definition.id,
      boundValue,
      comparator: definition.comparator,
      threshold: definition.threshold,
      status,
      reason: boundReason(status, boundValue, definition),
    };
  });
  const overall = records.some((record) => record.status === 'insufficient')
    ? 'insufficient'
    : records.every((record) => record.status === 'pass') ? 'pass' : 'fail';
  return { policyVersion: HYDE_GATE_POLICY_VERSION, overall, records };
}
