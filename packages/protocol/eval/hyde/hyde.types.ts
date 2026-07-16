import type { HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';
import type { HydeTargetCorpus } from '../../src/shared/hyde/lens.inferrer.js';
import type { HydeValidationVerdict } from '../../src/shared/hyde/hyde.validator.js';

import { HYDE_BACKGROUND_SOURCES } from './hyde.policy.js';

export const HYDE_EVAL_STRATA = [
  'profile-context-contamination',
  'entity-location-substitution',
  'time-numeric-scale',
  'credential-organization-exclusivity',
  'role-polarity-controls',
] as const;

export type HydeEvalStratum = typeof HYDE_EVAL_STRATA[number];
export type HydeBackgroundSource = typeof HYDE_BACKGROUND_SOURCES[number];
export type HydeEvalGraphSourceType = 'query' | 'context';
export type RelevanceGrade = 0 | 1 | 2 | 3;
export type CandidateRole = 'positive' | 'hard-negative' | 'distractor';

export interface HydeHardNegativeLink {
  positiveCandidateId: string;
  axis: string;
  rationale: string;
}

/**
 * One candidate in the frozen authored corpus.
 *
 * `relevanceGrade` and `role` are construction labels used to validate and
 * fingerprint the corpus. Canonical evidence must use independently resolved
 * human grades rather than treating these author labels as adjudication.
 */
export interface HydeEvalCandidate {
  id: string;
  role: CandidateRole;
  relevanceGrade: RelevanceGrade;
  corpus: 'intents' | 'premises';
  text: string;
  hardNegativeOf?: HydeHardNegativeLink;
}

/** A drift-focused source paired with a graded, multi-positive candidate pool. */
export interface HydeEvalCase {
  id: string;
  stratum: HydeEvalStratum;
  /** Product-level asynchronous source represented by this case. */
  backgroundSource: HydeBackgroundSource;
  description: string;
  sourceText: string;
  profileContext?: string;
  candidates: HydeEvalCandidate[];
}

export interface EmbeddedCandidate extends HydeEvalCandidate {
  embedding: number[];
}

export interface LensQueryEmbedding {
  /** Lens label carried with the vector, matching EmbedderAdapter's matchedVia value. */
  lensId: string;
  corpus: HydeTargetCorpus;
  embedding: number[];
}

export interface CandidateScore {
  candidateId: string;
  role: CandidateRole;
  /** Frozen construction grade; canonical metrics use independently resolved grades. */
  relevanceGrade: RelevanceGrade;
  corpus: 'intents' | 'premises';
  hardNegativeOf?: HydeHardNegativeLink;
  /** Production-approximate score after the qualifying-match bonus; zero when omitted. */
  score: number;
  /** Raw per-lens cosines retained so score derivation can be independently revalidated. */
  lensMatches: Array<{ lensId: string; cosine: number }>;
  /** Raw best cosine across every returned lens embedding. */
  maxCosine: number;
  qualifyingMatchCount: number;
  matchedLensIds: string[];
  qualified: boolean;
}

export interface RankedCandidate extends CandidateScore {
  qualified: true;
}

export interface HydeRunRetrievalMetrics {
  precisionAt5: number;
  ndcgAt5: number;
  hardNegativeFprAt5: number | null;
  margin: number | null;
}

export type ResolvedRelevanceGrades =
  | Readonly<Record<string, RelevanceGrade>>
  | ReadonlyMap<string, RelevanceGrade>;

export type DiagnosticValidationStatus =
  | 'not_applicable'
  | 'not_submitted'
  | 'valid'
  | 'invalid'
  | 'failed_open';
export type DiagnosticMapStatus = 'submitted' | 'overwritten';
export type FailedOpenReason =
  | 'validator_error'
  | 'missing_verdict'
  | 'duplicate_verdict'
  | 'malformed_verdict'
  | 'contradictory_verdict';

/** Text and key-resolved validator outcome retained to diagnose a live run. */
export interface GeneratedDocumentDiagnostic {
  lens: string;
  corpus: HydeTargetCorpus;
  text: string;
  mapStatus: DiagnosticMapStatus;
  validationStatus: DiagnosticValidationStatus;
  validatorKey?: string;
  failedOpenReason?: FailedOpenReason;
  returned: boolean;
  verdict?: HydeValidationVerdict;
}

export interface HydeResourceCallDiagnostic {
  durationMs: number;
  inputCount: number;
  outcome: 'completed' | 'threw';
}

export interface HydeRunResourceDiagnostics {
  lensInferenceCalls: HydeResourceCallDiagnostic[];
  generatorCalls: HydeResourceCallDiagnostic[];
  validatorCalls: HydeResourceCallDiagnostic[];
  documentEmbeddingCalls: HydeResourceCallDiagnostic[];
}

export interface HydeEvalRunResult {
  caseId: string;
  mode: HydeGenerationMode;
  run: number;
  /** Every authored candidate, including candidates omitted by qualification. */
  allCandidateScores: CandidateScore[];
  ranking: RankedCandidate[];
  lensCount: number;
  returnedDocumentCount: number;
  generatedDocumentCount: number;
  /** Generated calls lost when the graph's lens-keyed map overwrites duplicate labels. */
  overwrittenDocumentCount: number;
  validatorSubmittedDocumentCount: number;
  /** Legacy has no validator, so rejection is not applicable rather than zero. */
  rejectedCount: number | null;
  failedOpenCount: number;
  documents: GeneratedDocumentDiagnostic[];
  resources: HydeRunResourceDiagnostics;
}

export interface HydeModeSummary {
  mode: HydeGenerationMode;
  runCount: number;
  recallAtK: number;
  mrr: number;
  generatedDocumentCount: number;
  overwrittenDocumentCount: number;
  rejectedCount: number | null;
  failedOpenCount: number;
}

export interface HydeEvalGitMetadata {
  revision: string;
  dirty: boolean | null;
  revisionWithDirtyMarker: string;
}

export interface HydeEvalModelMetadata {
  lensInferrer: string;
  generator: string;
  validator: string;
}

export interface HydeEvalCaseSnapshot {
  id: string;
  sha256: string;
}

export interface HydeEvalExecutionOrdering {
  cases: string;
  runs: string;
  modes: HydeGenerationMode[];
  graphConcurrency: string;
}

export interface HydeEvalReport {
  eval: 'hyde-retrieval';
  matchingEval: 'separate-secondary-check';
  generatedAt: string;
  git: HydeEvalGitMetadata;
  models: HydeEvalModelMetadata;
  embedding: {
    baseUrl: string;
    model: string;
    dimensions: number;
    encodingFormat: 'float';
  };
  generationVersion: string;
  corpusFingerprint: string;
  configFingerprint: string;
  minScore: number;
  lensBonus: {
    perAdditionalMatch: number;
    formula: string;
    qualifyingMatchSemantics: string;
  };
  executionOrdering: HydeEvalExecutionOrdering;
  recallK: number;
  runsPerCase: number;
  selectedCaseIds: string[];
  selectedCaseSnapshots: HydeEvalCaseSnapshot[];
  summaries: HydeModeSummary[];
  runs: HydeEvalRunResult[];
}
