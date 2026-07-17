import { describe, expect, it } from 'bun:test';

import { hierarchicalPairedBootstrap, hierarchicalScalarBootstrap, percentileLinearInterpolation, type PairedMetricObservation, type ScalarMetricObservation } from '../hyde.statistics.js';
import { HYDE_EVAL_STRATA } from '../hyde.types.js';

function pairedFixture(): PairedMetricObservation[] {
  return HYDE_EVAL_STRATA.flatMap((stratum, stratumIndex) => [
    {
      stratum,
      caseId: `${stratum}-a`,
      run: 1,
      legacy: stratumIndex,
      frameV1: stratumIndex + 2,
    },
    {
      stratum,
      caseId: `${stratum}-a`,
      run: 2,
      legacy: stratumIndex + 2,
      frameV1: stratumIndex + 4,
    },
    {
      stratum,
      caseId: `${stratum}-b`,
      run: 1,
      legacy: stratumIndex + 4,
      frameV1: stratumIndex + 6,
    },
  ]);
}

describe('HyDE percentile interpolation', () => {
  it('uses explicit linear interpolation at both 95% interval quantiles', () => {
    expect(percentileLinearInterpolation([0, 10], 0.025)).toBe(0.25);
    expect(percentileLinearInterpolation([10, 0], 0.975)).toBe(9.75);
    expect(percentileLinearInterpolation([4], 0.5)).toBe(4);
  });
});

describe('stratified hierarchical paired bootstrap', () => {
  it('is byte-deterministic, input-order invariant, and keeps paired deltas paired', () => {
    const observations = pairedFixture();
    const first = hierarchicalPairedBootstrap(observations, { seed: 123, replicates: 80 });
    const second = hierarchicalPairedBootstrap(observations, { seed: 123, replicates: 80 });
    const reordered = hierarchicalPairedBootstrap([...observations].reverse(), {
      seed: 123,
      replicates: 80,
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(reordered));
    expect(first.pointEstimate.delta).toBe(2);
    expect(first.confidenceIntervals.delta.lower).toBeCloseTo(2, 12);
    expect(first.confidenceIntervals.delta.upper).toBeCloseTo(2, 12);
    expect(first.provenance).toEqual({
      seed: 123,
      prng: 'mulberry32-v1',
      replicateCount: 80,
      quantileMethod: 'linear-interpolation-r7',
    });
  });

  it('means runs within case, cases within stratum, then equally weights exact strata', () => {
    const observations: PairedMetricObservation[] = [];
    HYDE_EVAL_STRATA.forEach((stratum, stratumIndex) => {
      if (stratumIndex === 0) {
        observations.push(
          { stratum, caseId: 'high-a', run: 1, legacy: 0, frameV1: 0 },
          { stratum, caseId: 'high-a', run: 2, legacy: 100, frameV1: 100 },
          { stratum, caseId: 'high-b', run: 1, legacy: 100, frameV1: 100 },
        );
        return;
      }
      const caseCount = stratumIndex + 1;
      for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
        observations.push({
          stratum,
          caseId: `${stratum}-${caseIndex}`,
          run: 1,
          legacy: 0,
          frameV1: 0,
        });
      }
    });

    const result = hierarchicalPairedBootstrap(observations, { seed: 9, replicates: 100 });
    // First stratum: mean(mean(0,100), mean(100)) = 75. Other strata = 0.
    expect(result.pointEstimate).toEqual({ legacy: 15, frameV1: 15, delta: 0 });
    // Variation confirms both case and run levels are actually resampled.
    expect(result.confidenceIntervals.legacy.lower).toBeLessThan(
      result.confidenceIntervals.legacy.upper,
    );
  });

  it('rejects incomplete strata, duplicate case/runs, cross-stratum cases, and non-finite modes', () => {
    expect(() => hierarchicalPairedBootstrap(pairedFixture().filter(
      (observation) => observation.stratum !== HYDE_EVAL_STRATA[4],
    ), { replicates: 2 })).toThrow('all five exact strata');

    const duplicate = pairedFixture();
    duplicate.push({ ...duplicate[0] });
    expect(() => hierarchicalPairedBootstrap(duplicate, { replicates: 2 })).toThrow('Duplicate');

    const crossStratum = pairedFixture();
    crossStratum[3] = { ...crossStratum[3], caseId: crossStratum[0].caseId };
    expect(() => hierarchicalPairedBootstrap(crossStratum, { replicates: 2 })).toThrow('multiple strata');

    const nonFinite = pairedFixture();
    nonFinite[0] = { ...nonFinite[0], frameV1: Number.NaN };
    expect(() => hierarchicalPairedBootstrap(nonFinite, { replicates: 2 })).toThrow('Both mode values');
  });
});

describe('frame-only hierarchical scalar bootstrap', () => {
  it('supports deterministic all-rejected or failed-open absolute metrics', () => {
    const observations: ScalarMetricObservation[] = HYDE_EVAL_STRATA.flatMap((stratum, index) => [
      { stratum, caseId: `${stratum}-case`, run: 1, value: index % 2 },
      { stratum, caseId: `${stratum}-case`, run: 2, value: (index + 1) % 2 },
    ]);
    const result = hierarchicalScalarBootstrap(observations, { seed: 77, replicates: 60 });
    const reordered = hierarchicalScalarBootstrap([...observations].reverse(), {
      seed: 77,
      replicates: 60,
    });

    expect(result.pointEstimate).toBe(0.5);
    expect(result.confidenceInterval.lower).toBeLessThan(result.confidenceInterval.upper);
    expect(JSON.stringify(result)).toBe(JSON.stringify(reordered));
    expect(result.provenance.replicateCount).toBe(60);
  });
});
