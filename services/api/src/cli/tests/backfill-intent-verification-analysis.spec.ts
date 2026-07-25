import { describe, expect, it, mock } from 'bun:test';

import { classifyCandidate, parseArgs, runBackfill, validateVerifierOutput, type BackfillDeps, type Candidate } from '../backfill-intent-verification-analysis';

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
    expect(report.estimatedVerifierCalls).toBe(1);
    expect(report.controls.completeAnalysis).toBe(17);
    expect(report.controls.partialAnalysis).toBe(3);
    expect(report.attempted).toBe(0);
    expect(report.candidates).toEqual([{ id: 'intent-1', partition: 'proposal_confirm_default_only', validation: 'ready_for_verification' }]);
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.beginRun).not.toHaveBeenCalled();
    expect(deps.recordAttempt).not.toHaveBeenCalled();
    expect(deps.applyAnalysis).not.toHaveBeenCalled();
  });

  it('writes only validated canonical analysis and records an unchanged-control guard outcome', async () => {
    const deps = makeDeps({ applyAnalysis: mock(async () => false) });
    const report = await runBackfill({ ...dryRunOptions, dryRun: false, runId: 'run-1' }, deps);

    expect(report).toMatchObject({ attempted: 1, updated: 0, unchangedControl: 1, failed: 0 });
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
});
