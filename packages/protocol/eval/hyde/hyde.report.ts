import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { getModelName } from '../../src/shared/agent/model.config.js';
import { HYDE_FRAME_GENERATION_VERSION } from '../../src/shared/hyde/hyde.env.js';

import { parseHydeAnalysisArtifact } from './hyde.artifacts.js';
import { HYDE_CANONICAL_PROVENANCE_PINS } from './hyde.policy.js';
import type { HydeAnalysisArtifact, HydePairedMetricAnalysis, HydeScalarMetricAnalysis } from './hyde.schemas.js';
import { HYDE_EVAL_STRATA } from './hyde.types.js';
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

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareAscii(left, right))
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
    policyPins: HYDE_CANONICAL_PROVENANCE_PINS,
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

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function pairedMetricRow(name: string, metric: HydePairedMetricAnalysis): string {
  if (!metric.available) return `| ${name} | unavailable | unavailable | unavailable | ${metric.reasons.join('; ')} |`;
  const point = metric.pointEstimate;
  const intervals = metric.confidenceIntervals;
  return `| ${name} | ${number(point.legacy)} [${number(intervals.legacy.lower)}, ${number(intervals.legacy.upper)}] | ${number(point.frameV1)} [${number(intervals.frameV1.lower)}, ${number(intervals.frameV1.upper)}] | ${number(point.delta)} [${number(intervals.delta.lower)}, ${number(intervals.delta.upper)}] | seed=${metric.provenance.seed}; n=${metric.provenance.replicateCount} |`;
}

function pointDiagnostic(value: { available: false; reasons: string[] } | { available: true; pointEstimate: number | { legacy: number; frameV1: number; delta: number } }): string {
  if (!value.available) return `unavailable (${value.reasons.join('; ')})`;
  return typeof value.pointEstimate === 'number'
    ? number(value.pointEstimate)
    : `legacy ${number(value.pointEstimate.legacy)}, frame ${number(value.pointEstimate.frameV1)}, delta ${number(value.pointEstimate.delta)}`;
}

function scalarMetricRow(name: string, metric: HydeScalarMetricAnalysis): string {
  if (!metric.available) return `| ${name} | unavailable | unavailable | ${metric.reasons.join('; ')} |`;
  return `| ${name} | ${number(metric.pointEstimate)} | [${number(metric.confidenceInterval.lower)}, ${number(metric.confidenceInterval.upper)}] | seed=${metric.provenance.seed}; n=${metric.provenance.replicateCount} |`;
}

/** Return a strictly parsed, detached JSON-safe analysis report object. */
export function buildHydeEvidenceReport(value: unknown): HydeAnalysisArtifact {
  const parsed = parseHydeAnalysisArtifact(value);
  return parseHydeAnalysisArtifact(JSON.parse(JSON.stringify(parsed)) as unknown);
}

/** Deterministically render the canonical analysis artifact as reviewable Markdown. */
export function renderHydeEvidenceMarkdown(value: unknown): string {
  const analysis = buildHydeEvidenceReport(value);
  const headline = analysis.gates.overall.toUpperCase();
  const lines: string[] = [
    `# ${headline} — HyDE Evidence Analysis`,
    '',
    `Study: ${analysis.studyId}`,
    `Generated: ${analysis.generatedAt}`,
    `Policy: ${analysis.policyVersion}`,
    '',
    '## Canonicality reasons',
    ...(analysis.canonicality.reasons.length === 0
      ? ['- None. Evidence is complete and canonical.']
      : analysis.canonicality.reasons.map((reason) => `- ${reason}`)),
    '',
    '## Exact gates',
    '| Gate | Bound | Comparator | Threshold | Status | Reason |',
    '|---|---:|:---:|---:|:---:|---|',
    ...analysis.gates.records.map((gate) =>
      `| ${gate.id} | ${gate.boundValue === null ? 'unavailable' : number(gate.boundValue)} | ${gate.comparator} | ${number(gate.threshold)} | ${gate.status.toUpperCase()} | ${gate.reason} |`),
    '',
    '## Paired canonical metrics (point and 95% CI)',
    '| Metric | Legacy | Frame v1 | Delta | Bootstrap |',
    '|---|---|---|---|---|',
    pairedMetricRow('Precision@5', analysis.metrics.precisionAt5),
    pairedMetricRow('nDCG@5', analysis.metrics.ndcgAt5),
    pairedMetricRow('Hard-negative FPR@5', analysis.metrics.hardNegativeFprAt5),
    pairedMetricRow('Positive-nearest-hard-negative margin', analysis.metrics.margin),
    pairedMetricRow('Unsupported-addition rate', analysis.metrics.unsupportedAdditionRate),
    pairedMetricRow('Grounding error / exposure rate', analysis.metrics.groundingErrorRate),
    '',
    '## Frame-only canonical operational metrics',
    '| Metric | Point | 95% CI | Bootstrap |',
    '|---|---:|---|---|',
    scalarMetricRow('All-rejected rate', analysis.metrics.frameAllRejectedRate),
    scalarMetricRow('Failed-open rate', analysis.metrics.frameFailedOpenRate),
    '',
    '## Per-stratum diagnostics',
  ];
  for (const stratum of HYDE_EVAL_STRATA) {
    lines.push(`### ${stratum}`);
    for (const [name, metric] of Object.entries(analysis.metrics)) {
      if (!metric.available) {
        lines.push(`- ${name}: unavailable`);
        continue;
      }
      if ('perStratum' in metric) {
        const entry = metric.perStratum.find((candidate) => candidate.stratum === stratum);
        if (!entry) continue;
        lines.push('delta' in entry
          ? `- ${name}: legacy ${number(entry.legacy)}, frame ${number(entry.frameV1)}, delta ${number(entry.delta)}`
          : `- ${name}: ${number(entry.value)}`);
      }
    }
    lines.push('');
  }
  lines.push(
    '## Background-source diagnostics (non-gating point estimates)',
    ...analysis.perBackgroundSource.flatMap((source) => [
      `### ${source.backgroundSource}`,
      `- Coverage: cases ${source.coverage.caseCount}/${source.coverage.expectedCaseCount}; pairs observed ${source.coverage.observedPairCount}/${source.coverage.expectedPairCount}; completed ${source.coverage.completedPairCount}.`,
      ...Object.entries(source.metrics).map(([name, metric]) => `- ${name}: ${pointDiagnostic(metric)}`),
      '',
    ]),
    'These cohort diagnostics do not add or modify release gates.',
    '',
    '## Adjudication',
    `- Status: ${analysis.adjudication.status}`,
    `- Canonical: ${analysis.adjudication.canonical}`,
    `- Complete independently attested human adjudicators: ${analysis.adjudication.coverage.completeAttestedHumanAdjudicatorCount}`,
    `- Resolved / unresolved / missing: ${analysis.adjudication.counts.resolved} / ${analysis.adjudication.counts.unresolved} / ${analysis.adjudication.counts.missingEvidence}`,
    '',
    '## Incomplete pairs',
    `- Expected: ${analysis.completeness.expectedPairCount}`,
    `- Completed: ${analysis.completeness.completedPairCount}`,
    `- Failed: ${analysis.completeness.failedPairCount}`,
    `- Missing: ${analysis.completeness.missingPairCount}`,
    `- Incomplete-pair rate: ${number(analysis.completeness.incompletePairRate)}`,
    '',
    '## Resources and generation diagnostics',
    `- Candidate embedding setups: ${analysis.resources.candidateEmbeddings.completedCount} completed, ${analysis.resources.candidateEmbeddings.failedCount} failed; ${analysis.resources.candidateEmbeddings.inputCount} inputs.`,
    ...analysis.resources.modeRuns.map((mode) =>
      `- ${mode.mode}: ${mode.completedRunCount}/${mode.attemptedRunCount} completed; generated=${mode.generatedDocumentCount}; empty-generation=${mode.emptyGenerationRunCount}; returned=${mode.returnedDocumentCount}; overwritten=${mode.overwrittenDocumentCount}; rejected=${mode.rejectedDocumentCount}; failed-open=${mode.failedOpenDocumentCount}; all-rejected=${mode.allRejectedRunCount}; duration p50/p95/mean=${mode.durationMs.p50 ?? 'unavailable'}/${mode.durationMs.p95 ?? 'unavailable'}/${mode.durationMs.mean ?? 'unavailable'} ms.`),
    ...Object.entries(analysis.resources.productionWrapperCalls).map(([name, calls]) =>
      `- ${name}: calls=${calls.callCount}; inputs=${calls.inputCount}; completed=${calls.outcomes.completed}; threw=${calls.outcomes.threw}; duration p50/p95/mean=${calls.durationMs.p50 ?? 'unavailable'}/${calls.durationMs.p95 ?? 'unavailable'}/${calls.durationMs.mean ?? 'unavailable'} ms.`),
    `- Per-call provider/model identity: unavailable — ${analysis.resources.configuredProviderIdentity.reason}`,
    `- Separate frame-extraction calls: unavailable — ${analysis.resources.frameExtractionCalls.reason}`,
    `- Tokens: unavailable — ${analysis.resources.tokens.reason}`,
    `- Cost: unavailable — ${analysis.resources.cost.reason}`,
    '',
    '## Limitations',
    ...analysis.limitations.map((limitation) => `- ${limitation}`),
    '',
    '## NONCANONICAL production-validator appendix',
    '**This appendix follows canonical human labels, is noncanonical, and is not read by release gates.**',
    `- Human-unsupported generated / returned: ${analysis.noncanonicalValidatorDiagnostics.humanUnsupported.generatedDocumentCount} / ${analysis.noncanonicalValidatorDiagnostics.humanUnsupported.returnedDocumentCount}`,
    `- Production accepted / rejected / failed-open / unclassifiable: ${analysis.noncanonicalValidatorDiagnostics.humanUnsupported.production.accepted} / ${analysis.noncanonicalValidatorDiagnostics.humanUnsupported.production.rejected} / ${analysis.noncanonicalValidatorDiagnostics.humanUnsupported.production.failedOpen} / ${analysis.noncanonicalValidatorDiagnostics.humanUnsupported.production.unclassifiable}`,
    `- Classifiable / agreement / false-accept / false-reject: ${analysis.noncanonicalValidatorDiagnostics.comparison.classifiableCount} / ${analysis.noncanonicalValidatorDiagnostics.comparison.agreementCount} / ${analysis.noncanonicalValidatorDiagnostics.comparison.falseAcceptCount} / ${analysis.noncanonicalValidatorDiagnostics.comparison.falseRejectCount}`,
  );
  return `${lines.join('\n')}\n`;
}
