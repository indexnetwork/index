import { describe, expect, it } from 'bun:test';

import { evaluateHydeGates, type HydeGateMetricInputs } from '../hyde.gates.js';
import type { HydePairedMetricAnalysis, HydeScalarMetricAnalysis } from '../hyde.schemas.js';
import { HYDE_EVAL_STRATA } from '../hyde.types.js';

function paired(deltaLower: number, deltaUpper: number, frameUpper = 0): HydePairedMetricAnalysis {
  return {
    available: true,
    pointEstimate: { legacy: 0, frameV1: 0, delta: 0 },
    confidenceIntervals: {
      legacy: { lower: 0, upper: 0 },
      frameV1: { lower: 0, upper: frameUpper },
      delta: { lower: deltaLower, upper: deltaUpper },
    },
    provenance: { seed: 1, prng: 'mulberry32-v1', replicateCount: 2, quantileMethod: 'linear-interpolation-r7' },
    perStratum: HYDE_EVAL_STRATA.map((stratum) => ({ stratum, legacy: 0, frameV1: 0, delta: 0 })),
  };
}

function scalar(upper: number): HydeScalarMetricAnalysis {
  return {
    available: true,
    pointEstimate: 0,
    confidenceInterval: { lower: 0, upper },
    provenance: { seed: 1, prng: 'mulberry32-v1', replicateCount: 2, quantileMethod: 'linear-interpolation-r7' },
    perStratum: HYDE_EVAL_STRATA.map((stratum) => ({ stratum, value: 0 })),
  };
}

function passingInputs(): HydeGateMetricInputs {
  return {
    precisionAt5: paired(-0.05, 0),
    ndcgAt5: paired(-0.05, 0),
    hardNegativeFprAt5: paired(0, 0.02),
    margin: paired(-0.03, 0),
    groundingErrorRate: paired(-1, -Number.EPSILON, 0.05),
    frameAllRejectedRate: scalar(0.05),
    frameFailedOpenRate: scalar(0.02),
  };
}

describe('HyDE exact versioned gates', () => {
  it('passes every inclusive comparator exactly at its threshold', () => {
    const evaluation = evaluateHydeGates(passingInputs());
    expect(evaluation.overall).toBe('pass');
    expect(evaluation.records).toHaveLength(8);
    expect(evaluation.records.every((gate) => gate.status === 'pass')).toBeTrue();
    expect(evaluation.records.map((gate) => [gate.id, gate.comparator, gate.threshold])).toEqual([
      ['grounding-delta-upper-exclusive-zero', '<', 0],
      ['frame-grounding-upper', '<=', 0.05],
      ['precision-at-5-delta-lower', '>=', -0.05],
      ['ndcg-at-5-delta-lower', '>=', -0.05],
      ['margin-delta-lower', '>=', -0.03],
      ['hard-negative-fpr-delta-upper', '<=', 0.02],
      ['frame-all-rejected-upper', '<=', 0.05],
      ['frame-failed-open-upper', '<=', 0.02],
    ]);
  });

  it('fails the strict grounding-delta gate at exactly zero', () => {
    const inputs = passingInputs();
    inputs.groundingErrorRate = paired(-1, 0, 0.05);
    const evaluation = evaluateHydeGates(inputs);
    expect(evaluation.overall).toBe('fail');
    expect(evaluation.records[0]).toMatchObject({ boundValue: 0, comparator: '<', threshold: 0, status: 'fail' });
    expect(evaluation.records.slice(1).every((gate) => gate.status === 'pass')).toBeTrue();
  });

  it('marks every gate insufficient when any canonicality or completeness reason exists', () => {
    const evaluation = evaluateHydeGates(passingInputs(), ['one expected pair is incomplete']);
    expect(evaluation.overall).toBe('insufficient');
    expect(evaluation.records.every((gate) => gate.status === 'insufficient')).toBeTrue();
    expect(evaluation.records.every((gate) => gate.reason.includes('one expected pair is incomplete'))).toBeTrue();
  });
});
