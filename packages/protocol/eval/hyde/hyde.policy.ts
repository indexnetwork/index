/** Versioned identifiers committed with each canonical HyDE evidence artifact. */
export const HYDE_ARTIFACT_SCHEMA_VERSION = 'hyde-evidence-artifact-v4';
export const HYDE_CORPUS_VERSION = 'hyde-frozen-corpus-v3';
export const HYDE_RUBRIC_VERSION = 'hyde-relevance-rubric-v3';
export const HYDE_GATE_POLICY_VERSION = 'hyde-gate-policy-v3';

// Eval-prefixed aliases keep artifact readers explicit without duplicating values.
export const HYDE_EVAL_ARTIFACT_SCHEMA_VERSION = HYDE_ARTIFACT_SCHEMA_VERSION;
export const HYDE_EVAL_CORPUS_VERSION = HYDE_CORPUS_VERSION;
export const HYDE_EVAL_RUBRIC_VERSION = HYDE_RUBRIC_VERSION;
export const HYDE_EVAL_GATE_POLICY_VERSION = HYDE_GATE_POLICY_VERSION;

/** Background-only source cohorts represented by the canonical study. */
export const HYDE_BACKGROUND_SOURCES = ['saved-intent', 'user-context'] as const;
export const HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING = Object.freeze({
  'saved-intent': 'query',
  'user-context': 'context',
} as const);
export const HYDE_EXPECTED_CASE_COUNT = 90;
export const HYDE_EXPECTED_CANDIDATES_PER_CASE = 10;
export const HYDE_EXPECTED_CANDIDATE_COUNT = 900;
export const HYDE_EXPECTED_SOURCE_CASE_COUNTS = Object.freeze({
  'saved-intent': 75,
  'user-context': 15,
} as const);
export const HYDE_MIN_CASES_PER_STRATUM = 15;

/** Canonical execution policy. Four paired runs keep mode allocation even. */
export const HYDE_CANONICAL_RUNS = 4;
export const HYDE_EXPECTED_PAIR_COUNT = HYDE_EXPECTED_CASE_COUNT * HYDE_CANONICAL_RUNS;
export const HYDE_EXPECTED_MODE_SLOT_COUNT = HYDE_EXPECTED_PAIR_COUNT * 2;
export const HYDE_EXPECTED_SOURCE_PAIR_COUNTS = Object.freeze({
  'saved-intent': HYDE_EXPECTED_SOURCE_CASE_COUNTS['saved-intent'] * HYDE_CANONICAL_RUNS,
  'user-context': HYDE_EXPECTED_SOURCE_CASE_COUNTS['user-context'] * HYDE_CANONICAL_RUNS,
} as const);
export const HYDE_BOOTSTRAP_REPLICATES = 10_000;
export const HYDE_EXECUTION_SEED = 426_202_601;
export const HYDE_BOOTSTRAP_SEED = 426_202_602;
export const HYDE_MIN_SCORE = 0.30;
export const HYDE_LENS_BONUS = 0.1;
export const HYDE_MAX_LENSES = 3;
export const HYDE_METRIC_K = 5;

/** Committed configured PRIMARY model/embedding pins required for canonical evidence. */
export const HYDE_CANONICAL_MODEL_PINS = Object.freeze({
  lensInferrer: 'google/gemini-2.5-flash',
  generator: 'google/gemini-2.5-flash',
  validator: 'google/gemini-2.5-flash',
} as const);
export const HYDE_CANONICAL_EMBEDDING_PIN = Object.freeze({
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/text-embedding-3-large',
  dimensions: 2000,
  encodingFormat: 'float' as const,
});
export const HYDE_CANONICAL_FRAME_GENERATION_VERSION = 'frame-v1' as const;
export const HYDE_CANONICAL_PROVENANCE_PINS = Object.freeze({
  models: HYDE_CANONICAL_MODEL_PINS,
  embedding: HYDE_CANONICAL_EMBEDDING_PIN,
  frameGenerationVersion: HYDE_CANONICAL_FRAME_GENERATION_VERSION,
});

export const HYDE_EVAL_CANONICAL_RUNS = HYDE_CANONICAL_RUNS;
export const HYDE_EVAL_BOOTSTRAP_REPLICATES = HYDE_BOOTSTRAP_REPLICATES;
export const HYDE_EVAL_EXECUTION_SEED = HYDE_EXECUTION_SEED;
export const HYDE_EVAL_BOOTSTRAP_SEED = HYDE_BOOTSTRAP_SEED;
export const HYDE_EVAL_DEFAULT_MIN_SCORE = HYDE_MIN_SCORE;
export const HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH = HYDE_LENS_BONUS;
export const HYDE_EVAL_MAX_LENSES = HYDE_MAX_LENSES;
export const HYDE_EVAL_K = HYDE_METRIC_K;

/** Exact release gates; lower/upper names encode the required CI bound. */
export const HYDE_GATE_THRESHOLDS = Object.freeze({
  groundingDeltaCiUpperExclusive: 0,
  frameGroundingCiUpperInclusive: 0.05,
  precisionAt5DeltaCiLowerInclusive: -0.05,
  ndcgAt5DeltaCiLowerInclusive: -0.05,
  marginDeltaCiLowerInclusive: -0.03,
  hardNegativeFprDeltaCiUpperInclusive: 0.02,
  frameAllRejectedCiUpperInclusive: 0.05,
  frameFailedOpenCiUpperInclusive: 0.02,
} as const);

export const HYDE_EVAL_POLICY = Object.freeze({
  versions: {
    artifactSchema: HYDE_ARTIFACT_SCHEMA_VERSION,
    corpus: HYDE_CORPUS_VERSION,
    rubric: HYDE_RUBRIC_VERSION,
    gatePolicy: HYDE_GATE_POLICY_VERSION,
  },
  canonicalRuns: HYDE_CANONICAL_RUNS,
  expectedCounts: {
    cases: HYDE_EXPECTED_CASE_COUNT,
    candidates: HYDE_EXPECTED_CANDIDATE_COUNT,
    pairs: HYDE_EXPECTED_PAIR_COUNT,
    modeSlots: HYDE_EXPECTED_MODE_SLOT_COUNT,
    sourceCases: HYDE_EXPECTED_SOURCE_CASE_COUNTS,
    sourcePairs: HYDE_EXPECTED_SOURCE_PAIR_COUNTS,
  },
  backgroundSourceGraphMapping: HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING,
  bootstrapReplicates: HYDE_BOOTSTRAP_REPLICATES,
  executionSeed: HYDE_EXECUTION_SEED,
  bootstrapSeed: HYDE_BOOTSTRAP_SEED,
  minScore: HYDE_MIN_SCORE,
  lensBonus: HYDE_LENS_BONUS,
  maxLenses: HYDE_MAX_LENSES,
  k: HYDE_METRIC_K,
  provenancePins: HYDE_CANONICAL_PROVENANCE_PINS,
  gates: HYDE_GATE_THRESHOLDS,
} as const);
