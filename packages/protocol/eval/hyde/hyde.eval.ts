#!/usr/bin/env bun
/**
 * Paired IND-426 HyDE retrieval eval. This is intentionally separate from the
 * matching eval: it exercises generation/validation/embedding, not opportunity scoring.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { HYDE_CASES } from './hyde.cases.js';
import { HYDE_EVAL_EMBEDDING_BASE_URL, HYDE_EVAL_EMBEDDING_DIMENSIONS, HYDE_EVAL_EMBEDDING_MODEL, createHydeEvalEmbedder, embedCandidates, runHydeCase } from './hyde.runner.js';
import { buildHydeEvalMetadata, readGitMetadata } from './hyde.report.js';
import { aggregateMode, HYDE_EVAL_DEFAULT_MIN_SCORE, HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH } from './hyde.scorer.js';
import type { HydeEvalReport, HydeEvalRunResult } from './hyde.types.js';

const DEFAULT_RUNS = 3;
const DEFAULT_RECALL_K = 2;

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const candidate = index >= 0 ? process.argv[index + 1] : undefined;
  return candidate && !candidate.startsWith('--') ? candidate : undefined;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function positiveInteger(flag: string, fallback: number): number {
  const raw = value(flag);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer (got ${raw ?? ''})`);
  }
  return parsed;
}

function cosineThreshold(flag: string, fallback: number): number {
  const raw = value(flag);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be a finite number between 0 and 1 (got ${raw ?? ''})`);
  }
  return parsed;
}

function usage(): string {
  return `Paired HyDE retrieval eval (IND-426)\n\n` +
    `This is the HyDE retrieval eval. eval:matching is a separate, secondary\n` +
    `OpportunityEvaluator regression check and is not retrieval evidence.\n\n` +
    `Usage (from packages/protocol):\n` +
    `  bun run eval:hyde\n` +
    `  bun run eval:hyde -- --runs 5\n` +
    `  bun run eval:hyde -- --case profile-boundary/\n` +
    `  bun run eval:hyde -- --k 1\n` +
    `  bun run eval:hyde -- --min-score 0.45\n` +
    `  bun run eval:hyde -- --report\n` +
    `  bun run eval:hyde -- --report ./eval/hyde/runs/manual.json\n` +
    `  bun run eval:hyde -- --list-cases\n\n` +
    `Options:\n` +
    `  --runs <n>       Paired repetitions per case (default: ${DEFAULT_RUNS})\n` +
    `  --case <prefix>  Select one case id or prefix\n` +
    `  --k <n>          K for Recall@K (default: ${DEFAULT_RECALL_K})\n` +
    `  --min-score <n>  Per-lens cosine cutoff (default: ${HYDE_EVAL_DEFAULT_MIN_SCORE})\n` +
    `  --report [path]  Write full JSON including generated docs/verdicts\n` +
    `  --list-cases     Print selected case ids without provider calls\n` +
    `  --help, -h       Show this help\n\n` +
    `There is no committed HyDE baseline or baseline-update command. Preserve full,\n` +
    `multi-run reports as release evidence; never treat a filtered/single run as canonical.\n`;
}

function printRun(result: HydeEvalRunResult): void {
  const rank = result.expectedTargetRank ?? 'miss';
  const rejected = result.rejectedCount ?? 'n/a';
  console.log(
    `  ${result.mode} run ${result.run}: target rank=${rank}; lenses=${result.lensCount}; ` +
    `generated=${result.generatedDocumentCount}; overwritten=${result.overwrittenDocumentCount}; ` +
    `submitted=${result.validatorSubmittedDocumentCount}; returned=${result.returnedDocumentCount}; ` +
    `rejected=${rejected}; failed-open=${result.failedOpenCount}`,
  );
  for (const document of result.documents) {
    const verdict = document.verdict
      ? `; verdict=${document.verdict.valid ? 'valid' : 'invalid'} (${document.verdict.reasoning})`
      : '';
    const mapping = document.mapStatus === 'overwritten' ? '; map=overwritten' : '';
    const failedOpen = document.failedOpenReason ? `; reason=${document.failedOpenReason}` : '';
    console.log(
      `    [${document.validationStatus}] ${document.lens} -> ${document.corpus}` +
      `${mapping}${failedOpen}${verdict}`,
    );
    console.log(`      ${document.text}`);
  }
}

async function main(): Promise<void> {
  if (has('--help') || has('-h')) {
    console.log(usage());
    return;
  }
  if (has('--update-baseline')) {
    throw new Error('HyDE eval has no baseline-update path; filtered or single runs must not become canonical baselines');
  }

  const runsPerCase = positiveInteger('--runs', DEFAULT_RUNS);
  const recallK = positiveInteger('--k', DEFAULT_RECALL_K);
  const minScore = cosineThreshold('--min-score', HYDE_EVAL_DEFAULT_MIN_SCORE);
  const caseFilter = value('--case');
  const selectedCases = caseFilter
    ? HYDE_CASES.filter((candidate) => candidate.id === caseFilter || candidate.id.startsWith(caseFilter))
    : HYDE_CASES;
  if (selectedCases.length === 0) throw new Error(`No HyDE eval case matches ${caseFilter}`);

  if (has('--list-cases')) {
    for (const c of selectedCases) console.log(`${c.id}\t${c.description}`);
    return;
  }

  const embedder = createHydeEvalEmbedder();
  const results: HydeEvalRunResult[] = [];
  console.log(
    `HyDE retrieval eval: ${selectedCases.length} drift case(s) × ${runsPerCase} paired run(s); ` +
    `embedding=${HYDE_EVAL_EMBEDDING_MODEL}/${HYDE_EVAL_EMBEDDING_DIMENSIONS}; ` +
    `minScore=${minScore}; additional-match bonus=${HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH}; ` +
    `Recall@${recallK}`,
  );
  console.log('Matching eval: separate secondary OpportunityEvaluator regression check (not HyDE retrieval evidence).');

  for (const c of selectedCases) {
    console.log(`\n${c.id}: ${c.description}`);
    const candidates = await embedCandidates(c, embedder);
    for (let run = 1; run <= runsPerCase; run += 1) {
      for (const mode of ['legacy', 'frame-v1'] as const) {
        const result = await runHydeCase(c, mode, run, embedder, candidates, {
          minScore,
          lensBonusPerAdditionalMatch: HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH,
        });
        results.push(result);
        printRun(result);
      }
    }
  }

  const metadata = buildHydeEvalMetadata({
    allCases: HYDE_CASES,
    selectedCases,
    embedding: {
      baseUrl: HYDE_EVAL_EMBEDDING_BASE_URL,
      model: HYDE_EVAL_EMBEDDING_MODEL,
      dimensions: HYDE_EVAL_EMBEDDING_DIMENSIONS,
      encodingFormat: 'float',
    },
    minScore,
    lensBonusPerAdditionalMatch: HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH,
    recallK,
    runsPerCase,
    git: readGitMetadata(path.resolve(import.meta.dir, '../../../..')),
  });
  const report: HydeEvalReport = {
    eval: 'hyde-retrieval',
    matchingEval: 'separate-secondary-check',
    generatedAt: new Date().toISOString(),
    ...metadata,
    recallK,
    runsPerCase,
    summaries: (['legacy', 'frame-v1'] as const).map((mode) =>
      aggregateMode(mode, results.filter((result) => result.mode === mode), recallK)),
    runs: results,
  };

  console.log('\nPer-mode retrieval summary (counts are totals):');
  for (const summary of report.summaries) {
    console.log(
      `  ${summary.mode}: Recall@${recallK}=${summary.recallAtK.toFixed(3)}; ` +
      `MRR=${summary.mrr.toFixed(3)}; generated=${summary.generatedDocumentCount}; ` +
      `overwritten=${summary.overwrittenDocumentCount}; ` +
      `rejected=${summary.rejectedCount ?? 'n/a'}; failed-open=${summary.failedOpenCount}`,
    );
  }

  if (has('--report')) {
    const explicitPath = value('--report');
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const reportPath = path.resolve(explicitPath ?? path.join(import.meta.dir, 'runs', `${stamp}.json`));
    await mkdir(path.dirname(reportPath), { recursive: true });
    await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nFull diagnostic report written to ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
