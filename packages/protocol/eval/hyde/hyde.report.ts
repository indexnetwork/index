import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { getModelName } from '../../src/shared/agent/model.config.js';
import { HYDE_FRAME_GENERATION_VERSION } from '../../src/shared/hyde/hyde.env.js';

import type { HydeEvalCase, HydeEvalExecutionOrdering, HydeEvalGitMetadata, HydeEvalModelMetadata, HydeEvalReport } from './hyde.types.js';

export const HYDE_EVAL_EXECUTION_ORDERING: HydeEvalExecutionOrdering = {
  cases: 'selected corpus declaration order',
  runs: 'ascending run number within each case; candidate embeddings generated once before paired modes',
  modes: ['legacy', 'frame-v1'],
  graphConcurrency: 'production graph ordering retained; frame extraction/lens inference and per-lens generation may run concurrently',
};

export type GitCommandRunner = (args: string[], cwd: string) => string;

function runGitCommand(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

/** Read revision/dirty state without invoking a shell or interpolating arguments. */
export function readGitMetadata(
  repoRoot: string,
  runGit: GitCommandRunner = runGitCommand,
): HydeEvalGitMetadata {
  try {
    const revision = runGit(['rev-parse', 'HEAD'], repoRoot).trim();
    if (!revision) throw new Error('git returned an empty revision');
    const dirty = runGit(
      ['status', '--porcelain=v1', '--untracked-files=normal'],
      repoRoot,
    ).trim().length > 0;
    return {
      revision,
      dirty,
      revisionWithDirtyMarker: `${revision}${dirty ? '-dirty' : ''}`,
    };
  } catch {
    return {
      revision: 'unknown',
      dirty: null,
      revisionWithDirtyMarker: 'unknown',
    };
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Stable SHA-256 helper used for corpus, case, and config fingerprints. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

/** Resolve configured primary model IDs through the production model-config helper. */
export function getHydeEvalModelMetadata(): HydeEvalModelMetadata {
  return {
    lensInferrer: getModelName('lensInferrer'),
    generator: getModelName('hydeGenerator'),
    validator: getModelName('hydeValidator'),
  };
}

export interface HydeEvalMetadataInput {
  allCases: HydeEvalCase[];
  selectedCases: HydeEvalCase[];
  embedding: HydeEvalReport['embedding'];
  minScore: number;
  lensBonusPerAdditionalMatch: number;
  recallK: number;
  runsPerCase: number;
  git: HydeEvalGitMetadata;
}

/** Build the deterministic report provenance/config block without provider calls. */
export function buildHydeEvalMetadata(input: HydeEvalMetadataInput) {
  const models = getHydeEvalModelMetadata();
  const selectedCaseIds = input.selectedCases.map((candidate) => candidate.id);
  const selectedCaseSnapshots = input.selectedCases.map((candidate) => ({
    id: candidate.id,
    sha256: fingerprint(candidate),
  }));
  const lensBonus = {
    perAdditionalMatch: input.lensBonusPerAdditionalMatch,
    formula: 'min(best qualifying cosine + perAdditionalMatch * (qualifying match count - 1), 1)',
    qualifyingMatchSemantics: 'each candidate-lens cosine at or above minScore is one match; candidates with no qualifying match are omitted',
  };
  const configSnapshot = {
    models,
    embedding: input.embedding,
    generationVersion: HYDE_FRAME_GENERATION_VERSION,
    minScore: input.minScore,
    lensBonus,
    executionOrdering: HYDE_EVAL_EXECUTION_ORDERING,
    recallK: input.recallK,
    runsPerCase: input.runsPerCase,
    maxLenses: 3,
    selectedCaseIds,
  };

  return {
    git: input.git,
    models,
    embedding: input.embedding,
    generationVersion: HYDE_FRAME_GENERATION_VERSION,
    corpusFingerprint: fingerprint(input.allCases),
    configFingerprint: fingerprint(configSnapshot),
    minScore: input.minScore,
    lensBonus,
    executionOrdering: HYDE_EVAL_EXECUTION_ORDERING,
    selectedCaseIds,
    selectedCaseSnapshots,
  };
}
