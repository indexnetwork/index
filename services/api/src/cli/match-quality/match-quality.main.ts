#!/usr/bin/env bun
/**
 * Historical match-quality evaluator. See README.md in this folder.
 *
 *   audit          Check the roster's rules.
 *   seed           Replace the evaluator's rows in local index_test and admit every signal.
 *   run [runs]     Score `runs` live discovery wakes per case (default 3, at most 5).
 */
// First: loads .env.test and refuses any non-local target before a connection opens.
import { OUTPUT_ROOT, TARGET } from './match-quality.target';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ModelClient } from '@indexnetwork/agent';

import { closeDb } from '../../lib/drizzle/drizzle';

import { auditRoster } from './match-quality.audit';
import { CASES, FROZEN_FINGERPRINT, fixtureFingerprint } from './match-quality.cases';
import { renderReport, type Evaluation } from './match-quality.report';
import { seedRoster } from './match-quality.seed';
import { captureDiscoveryWake, loadSeededCase, scoreRun, type RunScore, type WakeCapture } from './match-quality.wake';

const DEFAULT_RUNS = 3;
const MAX_RUNS = 5;

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** @returns Whether every rule passed, after printing the failures. */
function auditPasses(): boolean {
  const failures = auditRoster(CASES).filter((finding) => !finding.pass);
  for (const finding of failures) console.error(`audit ${finding.caseId} ${finding.rule}: ${finding.detail}`);
  console.log(`audit: ${CASES.length} cases, ${failures.length} failures`);
  return failures.length === 0;
}

async function seed(): Promise<boolean> {
  if (!auditPasses()) return false;
  console.log(`seeding ${TARGET}`);
  const records = await seedRoster(CASES);
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const log = path.join(OUTPUT_ROOT, `admission-${stamp()}.json`);
  await writeFile(log, JSON.stringify({ fingerprint: fixtureFingerprint(), records }, null, 2));

  for (const record of records) {
    console.log(`${record.admitted ? 'admitted' : 'REJECTED'} ${record.caseId}/${record.memberKey}${record.detail ? `: ${record.detail}` : ''}`);
  }
  const rejected = records.filter((record) => !record.admitted).length;
  const fingerprint = fixtureFingerprint();
  console.log(`${records.length - rejected} of ${records.length} admitted. Log: ${log}`);
  console.log(`fixture fingerprint ${fingerprint} ${fingerprint === FROZEN_FINGERPRINT ? '(frozen)' : '(not frozen)'}`);
  return rejected === 0;
}

async function run(runs: number): Promise<boolean> {
  if (!auditPasses()) return false;
  const fingerprint = fixtureFingerprint();
  if (fingerprint !== FROZEN_FINGERPRINT) {
    console.error(`Fixtures ${fingerprint} do not match the frozen roster ${FROZEN_FINGERPRINT || '(none)'}. Admit and freeze them first.`);
    return false;
  }
  console.log(`running ${runs} wake(s) per case against ${TARGET}`);
  const seeded = await Promise.all(CASES.map(loadSeededCase));
  const model = new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY });

  const captures: WakeCapture[] = [];
  const scores: RunScore[] = [];
  for (let repetition = 1; repetition <= runs; repetition++) {
    for (const entry of seeded) {
      const capture = await captureDiscoveryWake(entry, repetition, model);
      const score = scoreRun(entry, capture);
      captures.push(capture);
      scores.push(score);
      console.log(`${entry.matchCase.id} run ${repetition}: ${score.outcome}, ${score.queries.length} queries, hard above positive: ${score.hardAbovePositive.join(', ') || 'none'}${score.error ? ` (${score.error})` : ''}`);
    }
  }

  const evaluation: Evaluation = {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    commit: (await Bun.$`git rev-parse --short HEAD`.quiet().text()).trim(),
    fingerprint,
    runsPerCase: runs,
    audit: auditRoster(CASES),
    seeded,
    captures,
    scores,
  };
  const folder = path.join(OUTPUT_ROOT, `run-${stamp()}`);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'results.json'), JSON.stringify(evaluation, null, 2));
  await writeFile(path.join(folder, 'report.md'), renderReport(evaluation));
  console.log(`report: ${path.join(folder, 'report.md')}`);
  return scores.some((score) => score.outcome === 'scored');
}

async function main(): Promise<boolean> {
  const [command, argument] = process.argv.slice(2);
  if (command === 'audit') return auditPasses();
  if (command === 'seed') return seed();
  if (command === 'run') {
    const runs = argument === undefined ? DEFAULT_RUNS : Number(argument);
    if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
      console.error(`runs must be an integer from 1 to ${MAX_RUNS}`);
      return false;
    }
    return run(runs);
  }
  console.error('usage: match-quality.main.ts audit | seed | run [runs]');
  return false;
}

const succeeded = await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  return false;
});
await closeDb();
process.exit(succeeded ? 0 : 1);
