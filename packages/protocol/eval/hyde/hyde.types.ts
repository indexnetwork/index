import type { HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';
import type { HydeTargetCorpus } from '../../src/shared/hyde/lens.inferrer.js';
import type { HydeValidationVerdict } from '../../src/shared/hyde/hyde.validator.js';

export type CandidateRole = 'target' | 'trap' | 'distractor';

/** One hand-authored candidate in the retrieval-only in-memory corpus. */
export interface HydeEvalCandidate {
  id: string;
  role: CandidateRole;
  corpus: 'intents' | 'premises';
  text: string;
}

/** A drift-focused source paired with one target and plausible same-domain negatives. */
export interface HydeEvalCase {
  id: string;
  description: string;
  sourceText: string;
  profileContext?: string;
  expectedTargetId: string;
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

export interface RankedCandidate {
  candidateId: string;
  role: CandidateRole;
  /** Production-approximate score after the qualifying-match bonus. */
  score: number;
  /** Raw best cosine, retained only as a diagnostic rather than the headline rank. */
  maxCosine: number;
  qualifyingMatchCount: number;
  matchedLensIds: string[];
}

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

export interface HydeEvalRunResult {
  caseId: string;
  mode: HydeGenerationMode;
  run: number;
  expectedTargetRank: number | null;
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
