import { HYDE_BOOTSTRAP_REPLICATES, HYDE_BOOTSTRAP_SEED } from './hyde.policy.js';
import { HYDE_EVAL_STRATA, type HydeEvalStratum } from './hyde.types.js';

export const HYDE_BOOTSTRAP_PRNG = 'mulberry32-v1' as const;
export const HYDE_BOOTSTRAP_QUANTILE_METHOD = 'linear-interpolation-r7' as const;

export interface PairedMetricObservation {
  stratum: HydeEvalStratum;
  caseId: string;
  run: number;
  legacy: number;
  frameV1: number;
}

export interface ScalarMetricObservation {
  stratum: HydeEvalStratum;
  caseId: string;
  run: number;
  value: number;
}

export interface PercentileInterval {
  lower: number;
  upper: number;
}

export interface BootstrapProvenance {
  seed: number;
  prng: typeof HYDE_BOOTSTRAP_PRNG;
  replicateCount: number;
  quantileMethod: typeof HYDE_BOOTSTRAP_QUANTILE_METHOD;
}

export interface PairedBootstrapEstimate {
  legacy: number;
  frameV1: number;
  delta: number;
}

export interface PairedHierarchicalBootstrapResult {
  pointEstimate: PairedBootstrapEstimate;
  confidenceIntervals: {
    legacy: PercentileInterval;
    frameV1: PercentileInterval;
    delta: PercentileInterval;
  };
  provenance: BootstrapProvenance;
}

export interface ScalarHierarchicalBootstrapResult {
  pointEstimate: number;
  confidenceInterval: PercentileInterval;
  provenance: BootstrapProvenance;
}

export interface HierarchicalBootstrapOptions {
  replicates?: number;
  seed?: number;
}

type RandomSource = () => number;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Deterministic 32-bit PRNG used only for reproducible eval resampling. */
export function createSeededPrng(seed: number): RandomSource {
  if (!Number.isSafeInteger(seed)) throw new Error(`Bootstrap seed must be a safe integer (got ${seed})`);
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** R-7 percentile: index=(n-1)p with linear interpolation between adjacent values. */
export function percentileLinearInterpolation(values: readonly number[], probability: number): number {
  if (values.length === 0) throw new Error('Percentile requires at least one value');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`Percentile probability must be between zero and one (got ${probability})`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Percentile values must all be finite');
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const fraction = index - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction;
}

function percentile95(values: readonly number[]): PercentileInterval {
  return {
    lower: percentileLinearInterpolation(values, 0.025),
    upper: percentileLinearInterpolation(values, 0.975),
  };
}

function resolvedOptions(options: HierarchicalBootstrapOptions): Required<HierarchicalBootstrapOptions> {
  const replicates = options.replicates ?? HYDE_BOOTSTRAP_REPLICATES;
  const seed = options.seed ?? HYDE_BOOTSTRAP_SEED;
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new Error(`Bootstrap replicate count must be a positive integer (got ${replicates})`);
  }
  if (!Number.isSafeInteger(seed)) throw new Error(`Bootstrap seed must be a safe integer (got ${seed})`);
  return { replicates, seed };
}

function assertExactStrata(strata: ReadonlySet<string>): void {
  const expected = new Set<string>(HYDE_EVAL_STRATA);
  const missing = HYDE_EVAL_STRATA.filter((stratum) => !strata.has(stratum));
  const extra = [...strata].filter((stratum) => !expected.has(stratum)).sort(compareAscii);
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Bootstrap observations must represent all five exact strata; missing=[${missing.join(',')}], extra=[${extra.join(',')}]`,
    );
  }
}

function validateObservationIdentity(
  observations: readonly { stratum: HydeEvalStratum; caseId: string; run: number }[],
): void {
  const keys = new Set<string>();
  const caseStrata = new Map<string, HydeEvalStratum>();
  const strata = new Set<string>();
  for (const observation of observations) {
    if (observation.caseId.length === 0) throw new Error('Bootstrap case IDs must be non-empty');
    if (!Number.isInteger(observation.run) || observation.run < 1) {
      throw new Error(`Bootstrap run must be a positive integer for case ${observation.caseId}`);
    }
    strata.add(observation.stratum);
    const priorStratum = caseStrata.get(observation.caseId);
    if (priorStratum !== undefined && priorStratum !== observation.stratum) {
      throw new Error(`Case ${observation.caseId} appears in multiple strata`);
    }
    caseStrata.set(observation.caseId, observation.stratum);
    const key = `${observation.stratum}\0${observation.caseId}\0${observation.run}`;
    if (keys.has(key)) {
      throw new Error(`Duplicate bootstrap observation for ${observation.caseId} run ${observation.run}`);
    }
    keys.add(key);
  }
  assertExactStrata(strata);
}

function orderedObservations<T extends { stratum: HydeEvalStratum; caseId: string; run: number }>(
  observations: readonly T[],
): T[] {
  const stratumIndex = new Map<HydeEvalStratum, number>(
    HYDE_EVAL_STRATA.map((stratum, index) => [stratum, index]),
  );
  return [...observations].sort((left, right) =>
    (stratumIndex.get(left.stratum)! - stratumIndex.get(right.stratum)!)
      || compareAscii(left.caseId, right.caseId)
      || left.run - right.run);
}

function groupByStratumAndCase<T extends { stratum: HydeEvalStratum; caseId: string; run: number }>(
  observations: readonly T[],
): Map<HydeEvalStratum, T[][]> {
  const ordered = orderedObservations(observations);
  const result = new Map<HydeEvalStratum, T[][]>();
  for (const stratum of HYDE_EVAL_STRATA) {
    const stratumRows = ordered.filter((observation) => observation.stratum === stratum);
    const cases = new Map<string, T[]>();
    for (const observation of stratumRows) {
      const rows = cases.get(observation.caseId) ?? [];
      rows.push(observation);
      cases.set(observation.caseId, rows);
    }
    result.set(stratum, [...cases.values()]);
  }
  return result;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot calculate the mean of no values');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleIndex(length: number, random: RandomSource): number {
  if (length < 1) throw new Error('Cannot sample from an empty collection');
  return Math.floor(random() * length);
}

function pairedEstimate(
  grouped: ReadonlyMap<HydeEvalStratum, PairedMetricObservation[][]>,
  random?: RandomSource,
): PairedBootstrapEstimate {
  const legacyStrata: number[] = [];
  const frameStrata: number[] = [];
  for (const stratum of HYDE_EVAL_STRATA) {
    const cases = grouped.get(stratum);
    if (!cases || cases.length === 0) throw new Error(`No observations for stratum ${stratum}`);
    const legacyCases: number[] = [];
    const frameCases: number[] = [];
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const selectedCase = random ? cases[sampleIndex(cases.length, random)] : cases[caseIndex];
      const legacyRuns: number[] = [];
      const frameRuns: number[] = [];
      for (let runIndex = 0; runIndex < selectedCase.length; runIndex += 1) {
        const observation = random
          ? selectedCase[sampleIndex(selectedCase.length, random)]
          : selectedCase[runIndex];
        legacyRuns.push(observation.legacy);
        frameRuns.push(observation.frameV1);
      }
      legacyCases.push(mean(legacyRuns));
      frameCases.push(mean(frameRuns));
    }
    legacyStrata.push(mean(legacyCases));
    frameStrata.push(mean(frameCases));
  }
  const legacy = mean(legacyStrata);
  const frameV1 = mean(frameStrata);
  return { legacy, frameV1, delta: frameV1 - legacy };
}

/** Equal-stratum, case-then-run hierarchical paired bootstrap. */
export function hierarchicalPairedBootstrap(
  observations: readonly PairedMetricObservation[],
  options: HierarchicalBootstrapOptions = {},
): PairedHierarchicalBootstrapResult {
  validateObservationIdentity(observations);
  for (const observation of observations) {
    if (!Number.isFinite(observation.legacy) || !Number.isFinite(observation.frameV1)) {
      throw new Error(`Both mode values must be finite for ${observation.caseId} run ${observation.run}`);
    }
  }
  const { replicates, seed } = resolvedOptions(options);
  const grouped = groupByStratumAndCase(observations);
  const pointEstimate = pairedEstimate(grouped);
  const random = createSeededPrng(seed);
  const legacyReplicates: number[] = [];
  const frameReplicates: number[] = [];
  const deltaReplicates: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const estimate = pairedEstimate(grouped, random);
    legacyReplicates.push(estimate.legacy);
    frameReplicates.push(estimate.frameV1);
    deltaReplicates.push(estimate.delta);
  }
  return {
    pointEstimate,
    confidenceIntervals: {
      legacy: percentile95(legacyReplicates),
      frameV1: percentile95(frameReplicates),
      delta: percentile95(deltaReplicates),
    },
    provenance: {
      seed,
      prng: HYDE_BOOTSTRAP_PRNG,
      replicateCount: replicates,
      quantileMethod: HYDE_BOOTSTRAP_QUANTILE_METHOD,
    },
  };
}

function scalarEstimate(
  grouped: ReadonlyMap<HydeEvalStratum, ScalarMetricObservation[][]>,
  random?: RandomSource,
): number {
  const strata: number[] = [];
  for (const stratum of HYDE_EVAL_STRATA) {
    const cases = grouped.get(stratum);
    if (!cases || cases.length === 0) throw new Error(`No observations for stratum ${stratum}`);
    const caseMeans: number[] = [];
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const selectedCase = random ? cases[sampleIndex(cases.length, random)] : cases[caseIndex];
      const runs: number[] = [];
      for (let runIndex = 0; runIndex < selectedCase.length; runIndex += 1) {
        const observation = random
          ? selectedCase[sampleIndex(selectedCase.length, random)]
          : selectedCase[runIndex];
        runs.push(observation.value);
      }
      caseMeans.push(mean(runs));
    }
    strata.push(mean(caseMeans));
  }
  return mean(strata);
}

/** Hierarchical scalar bootstrap for frame-only absolute metrics. */
export function hierarchicalScalarBootstrap(
  observations: readonly ScalarMetricObservation[],
  options: HierarchicalBootstrapOptions = {},
): ScalarHierarchicalBootstrapResult {
  validateObservationIdentity(observations);
  for (const observation of observations) {
    if (!Number.isFinite(observation.value)) {
      throw new Error(`Scalar value must be finite for ${observation.caseId} run ${observation.run}`);
    }
  }
  const { replicates, seed } = resolvedOptions(options);
  const grouped = groupByStratumAndCase(observations);
  const pointEstimate = scalarEstimate(grouped);
  const random = createSeededPrng(seed);
  const replicateValues = Array.from(
    { length: replicates },
    () => scalarEstimate(grouped, random),
  );
  return {
    pointEstimate,
    confidenceInterval: percentile95(replicateValues),
    provenance: {
      seed,
      prng: HYDE_BOOTSTRAP_PRNG,
      replicateCount: replicates,
      quantileMethod: HYDE_BOOTSTRAP_QUANTILE_METHOD,
    },
  };
}

export const bootstrapPairedMetric = hierarchicalPairedBootstrap;
export const bootstrapScalarMetric = hierarchicalScalarBootstrap;
