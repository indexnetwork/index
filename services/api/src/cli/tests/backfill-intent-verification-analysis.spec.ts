import { describe, expect, it, mock } from 'bun:test';
import path from 'path';

import { classifyCandidate, parseArgs, runBackfill, runCli, validateVerifierOutput, type BackfillDeps, type Candidate } from '../backfill-intent-verification-analysis';

const validOutput = {
  reasoning: 'A bounded request.',
  classification: 'DIRECTIVE' as const,
  felicity_scores: { clarity: 74, authority: 78, sincerity: 80 },
  semantic_entropy: 0.31,
  referential_anchor: 'Index Network',
  referential_breadth: 'moderate' as const,
  missing_selectional_constraints: [],
  specificity_warning: null,
  flags: [],
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'intent-1', userId: 'owner-1', payload: 'Find an Index Network collaborator in Istanbul.', proposalConfirmed: true,
    sourceId: 'proposal-1', sourceType: 'discovery_form', semanticEntropy: 1,
    referentialAnchor: null, intentMode: 'ATTRIBUTIVE', speechActType: null,
    felicityAuthority: null, felicitySincerity: null, felicityClarity: null,
    control: {
      userId: 'owner-1', payload: 'Find an Index Network collaborator in Istanbul.', summary: null,
      isIncognito: false, sourceId: 'proposal-1', sourceType: 'discovery_form', embedding: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      archivedAt: null, lastVisitedAt: null, firstDiscoverySucceededAt: null, status: 'ACTIVE',
    },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BackfillDeps> = {}) {
  const countCandidates = mock(async () => ({
    proposal_confirm_default_only: 1,
    proposal_confirm_partial_missing: 0,
    legacy_discovery_missing_analysis: 2,
    other_missing_analysis: 0,
  }));
  const countControls = mock(async () => ({ completeAnalysis: 17, partialAnalysis: 3 }));
  const listCandidates = mock(async () => [candidate()]);
  const getProfileContext = mock(async () => ({ displayName: 'Dev test identity' }));
  const verify = mock(async () => validOutput);
  const getAttemptStatus = mock(async () => null);
  const beginRun = mock(async () => undefined);
  const recordAttempt = mock(async () => undefined);
  const applyAnalysis = mock(async () => true);
  const finishRun = mock(async () => undefined);
  return {
    countCandidates, countControls, listCandidates, getProfileContext, verify, getAttemptStatus,
    beginRun, recordAttempt, applyAnalysis, finishRun, ...overrides,
  } satisfies BackfillDeps;
}

const dryRunOptions = {
  dryRun: true, limit: 25, confirmProduction: false, verifierModel: 'google/gemini-2.5-flash',
  inputCostPerMillion: 0.3, outputCostPerMillion: 2.5,
};

async function runFixture(name: string, databaseUrl = 'postgres://127.0.0.1:1/ind590_dry_run') {
  const fixture = path.resolve(import.meta.dir, 'fixtures', name);
  const child = Bun.spawn({
    cmd: ['/usr/bin/env', '-i', `PATH=${process.env.PATH ?? ''}`, ...(databaseUrl ? [`DATABASE_URL=${databaseUrl}`] : []), process.execPath, '--no-env-file', fixture],
    cwd: path.resolve(import.meta.dir, '../../../../..'),
    // Deliberately clear, rather than merely override, inherited credentials.
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runMaintainedCommand(harness?: 'productionAssemblyDryRun' | 'candidateDiagnostic') {
  const child = Bun.spawn({
    cmd: [
      '/usr/bin/env', '-i', `PATH=${process.env.PATH ?? ''}`, 'NODE_ENV=test',
      ...(harness ? [`IND590_CLI_TEST_HARNESS=${harness}`] : []),
      process.execPath, '--no-env-file', '--silent', 'run', '--cwd', 'services/api',
      'maintenance:backfill-intent-verification-analysis', '--', '--limit', '25',
    ],
    cwd: path.resolve(import.meta.dir, '../../../../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('intent verification analysis maintenance workflow', () => {
  it('partitions proposal-confirm defaults separately from partial and legacy paths', () => {
    expect(classifyCandidate(candidate())).toBe('proposal_confirm_default_only');
    expect(classifyCandidate(candidate({ semanticEntropy: 0.6 }))).toBe('proposal_confirm_partial_missing');
    expect(classifyCandidate(candidate({ proposalConfirmed: false }))).toBe('legacy_discovery_missing_analysis');
    expect(classifyCandidate(candidate({ proposalConfirmed: false, sourceType: 'api', sourceId: null }))).toBe('other_missing_analysis');
  });

  it('defaults to a bounded dry run and reports target/cost/validation evidence without writes', async () => {
    const deps = makeDeps();
    const report = await runBackfill(dryRunOptions, deps);

    expect(report.mode).toBe('dry-run');
    expect(report.targetCounts.proposal_confirm_default_only).toBe(1);
    expect(report.candidateCount).toBe(1);
    expect(report.candidateCounts.proposal_confirm_default_only).toBe(1);
    expect(report.estimatedVerifierCalls).toBe(1);
    expect(report.controls.completeAnalysis).toBe(17);
    expect(report.controls.partialAnalysis).toBe(3);
    expect(report).toMatchObject({ verifierCalls: 0, attempted: 0, updated: 0, skipped: 0, failed: 0, unchangedControl: 0 });
    expect(report.validationOutcomes.proposal_confirm_default_only).toEqual({ ready_for_verification: 1 });
    expect(JSON.stringify(report)).not.toContain('intent-1');
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.beginRun).not.toHaveBeenCalled();
    expect(deps.recordAttempt).not.toHaveBeenCalled();
    expect(deps.applyAnalysis).not.toHaveBeenCalled();
  });

  it('writes only validated canonical analysis and records an unchanged-control guard outcome', async () => {
    const deps = makeDeps({ applyAnalysis: mock(async () => false) });
    const report = await runBackfill({ ...dryRunOptions, dryRun: false, runId: 'run-1' }, deps);

    expect(report).toMatchObject({ verifierCalls: 1, attempted: 1, updated: 0, unchangedControl: 1, failed: 0 });
    expect(deps.beginRun).toHaveBeenCalledWith('run-1', 'google/gemini-2.5-flash');
    expect(deps.applyAnalysis).toHaveBeenCalledWith(expect.anything(), {
      semanticEntropy: 0.31, referentialAnchor: 'Index Network', intentMode: 'REFERENTIAL',
      speechActType: 'DIRECTIVE', felicityAuthority: 78, felicitySincerity: 80, felicityClarity: 74,
    }, expect.objectContaining({ runId: 'run-1', partition: 'proposal_confirm_default_only' }));
    expect(deps.recordAttempt).not.toHaveBeenCalled();
    expect(deps.finishRun).toHaveBeenCalledWith('run-1', 'completed');
  });

  it('skips invalid/non-actionable outputs rather than fabricating analysis', async () => {
    expect(validateVerifierOutput({ ...validOutput, classification: 'ASSERTIVE' })).toEqual({ kind: 'skip', code: 'non_actionable' });
    expect(validateVerifierOutput({ ...validOutput, semantic_entropy: 1.2 })).toEqual({ kind: 'skip', code: 'invalid_output' });
    const deps = makeDeps({ verify: mock(async () => ({ ...validOutput, referential_breadth: 'broad' as const })) });
    const report = await runBackfill({ ...dryRunOptions, dryRun: false, runId: 'run-2' }, deps);
    expect(report).toMatchObject({ attempted: 1, updated: 0, skipped: 1, failed: 0 });
    expect(deps.applyAnalysis).not.toHaveBeenCalled();
    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', errorCode: 'non_actionable' }));
  });

  it('resumes successful attempts without a repeat verifier call and retries prior failures', async () => {
    const alreadyDone = makeDeps({ getAttemptStatus: mock(async () => 'updated') });
    const resumed = await runBackfill({ ...dryRunOptions, dryRun: false, runId: 'run-3' }, alreadyDone);
    expect(resumed).toMatchObject({ attempted: 0, skipped: 1 });
    expect(alreadyDone.verify).not.toHaveBeenCalled();

    const retryFailed = makeDeps({ getAttemptStatus: mock(async () => 'failed') });
    await runBackfill({ ...dryRunOptions, dryRun: false, runId: 'run-3' }, retryFailed);
    expect(retryFailed.verify).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit stable run id for write mode and leaves dry run as the parser default', async () => {
    expect(() => parseArgs(['--write'])).not.toThrow();
    expect(parseArgs([]).dryRun).toBe(true);
    await expect(runBackfill({ ...dryRunOptions, dryRun: false }, makeDeps())).rejects.toThrow('--write requires a stable --run-id');
  });

  it('emits exactly one sanitized JSON object at the real CLI boundary for default dry run', async () => {
    const deps = makeDeps();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const createDeps = mock(async () => deps);

    const exitCode = await runCli([], { createDeps, stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) });

    expect(exitCode).toBe(0);
    expect(createDeps).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(stdout).toHaveLength(1);
    expect(stderr).toEqual([]);
    const report = JSON.parse(stdout[0]);
    expect(report).toMatchObject({ reportVersion: 1, mode: 'dry-run', verifierCalls: 0, candidateCount: 1 });
    expect(stdout[0]).not.toContain('intent-1');
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.beginRun).not.toHaveBeenCalled();
    expect(deps.recordAttempt).not.toHaveBeenCalled();
    expect(deps.applyAnalysis).not.toHaveBeenCalled();
  });

  it('reproduces the retired eager-provider startup failure without database or credentials', async () => {
    const result = await runFixture('backfill-intent-verification-analysis.legacy-eager-startup.fixture.ts');

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('createModel(intentVerifier): OPENROUTER_API_KEY is required');
  });

  it('assembles production dry-run dependencies with dummy local DB configuration and no provider', async () => {
    const result = await runFixture('backfill-intent-verification-analysis.runtime-assembly.fixture.ts');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"assembled":true}\n');
  });

  it('does not validate or import a database client while only assembling dry-run dependencies', async () => {
    const result = await runFixture('backfill-intent-verification-analysis.runtime-assembly.fixture.ts', '');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"assembled":true}\n');
  });

  it('runs the documented package command through production runtime assembly with one aggregate-only JSON stdout report', async () => {
    const result = await runMaintainedCommand('productionAssemblyDryRun');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toEndWith('\n');
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      reportVersion: 1, mode: 'dry-run', candidateCount: 0, verifierCalls: 0,
      attempted: 0, updated: 0, skipped: 0, failed: 0, unchangedControl: 0,
    });
  });

  it('keeps the package-command report parseable when a candidate diagnostic exits nonzero', async () => {
    const result = await runMaintainedCommand('candidateDiagnostic');

    expect(result.exitCode).toBe(1);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ mode: 'dry-run', failed: 1, verifierCalls: 0 });
    expect(result.stderr).toContain('completed with 1 failed candidate(s)');
    expect(result.stderr).not.toContain('fixture-intent');
  });

  it('fails nonzero before a report when the real package command has no database configuration', async () => {
    const result = await runMaintainedCommand();

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('backfill-intent-verification-analysis failed:');
  });

  it('keeps a valid sanitized report on stdout when candidate diagnostics make the exit nonzero', async () => {
    const deps = makeDeps({ getProfileContext: mock(async () => { throw new Error('local candidate diagnostic'); }) });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli([], { createDeps: async () => deps, stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) });

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toMatchObject({ mode: 'dry-run', failed: 1, verifierCalls: 0 });
    expect(stdout[0]).not.toContain('intent-1');
    expect(stderr.join('')).toContain('completed with 1 failed candidate(s)');
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.recordAttempt).not.toHaveBeenCalled();
    expect(deps.applyAnalysis).not.toHaveBeenCalled();
  });

  it('fails closed when report serialization is malformed', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli([], {
      createDeps: async () => makeDeps(),
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      serializeReport: () => 'not-json',
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('JSON Parse error');
  });

  it('fails closed when report serialization contains an unsafe field', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli([], {
      createDeps: async () => makeDeps(),
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      serializeReport: () => '{"id":"must-not-leak"}',
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('report contains forbidden field: id');
  });

  it('fails closed when a serializer attempts mixed or duplicate stdout reports', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli([], {
      createDeps: async () => makeDeps(),
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      serializeReport: () => '{"reportVersion":1}\n{"reportVersion":1}',
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('JSON Parse error');
  });

  it('fails nonzero instead of silently succeeding when no report can be produced', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli([], {
      createDeps: async () => { throw new Error('local fixture setup failed'); },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('local fixture setup failed');
  });
});
