import { describe, expect, it } from 'bun:test';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import { MATRIX_ROWS } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.policy.js';
import { buildEvalArtifact, buildScorecard, EVAL_RUN_REPORT_ARTIFACT_TYPE } from '../../../../../packages/protocol/eval/shared/index.js';

import { baseSeedPayload } from '../discovery-env-matrix.shared';
import { awaitMatrixChildProcess, buildMatrixArtifactEvidence, collectCandidates, collectEvaluatorTraces, finalizeMatrixChildArtifacts, invokeMatrixDiscoveryGraph, parseMatrixChildTimeoutMs, projectFinalCandidates, resolveFixtureTriggerIntent, resolveMatrixExecutionSelection, runBaselineUpdateAfterPassingAssertions, runWithChildCleanup, sanitizeMatrixError, type MatrixExecutionEvidence, type MatrixSlotResult } from '../discovery-env-matrix.main';
import { assertCompleteMatrix, buildCanaryPlan, buildMatrixPlan, parseChildManifest, withMatrixEnvironment } from '../discovery-env-matrix.runtime';

describe('discovery environment matrix runtime seams', () => {
  it('redacts provider, database, and API-key error content', () => {
    expect(sanitizeMatrixError(new Error('postgresql://user:secret@host/protocol_eval NEON_API_KEY=secret provider body'))).toBe('internal_error');
  });
  it('plans 75 slots and isolates each configuration/repetition child', () => {
    const slots = buildMatrixPlan(HISTORICAL_MATRIX_CASES, MATRIX_ROWS, 3);

    expect(slots).toHaveLength(75);
    expect(new Set(slots.map((slot) => slot.childKey)).size).toBe(15);
  });

  it('plans a non-baselineable one-case five-row r1 canary with exactly five children', () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    const selection = resolveMatrixExecutionSelection(HISTORICAL_MATRIX_CASES, MATRIX_ROWS, {
      caseId: matrixCase.id,
      canary: true,
      runsRequested: false,
      updateBaseline: false,
    });

    expect(selection.canary).toBe(true);
    expect(selection.plan).toEqual(buildCanaryPlan(matrixCase, MATRIX_ROWS));
    expect(selection.plan).toHaveLength(5);
    expect(selection.plan.every((slot) => slot.repetition === 0 && slot.childKey.endsWith('-r1'))).toBe(true);

    const children = selection.plan.map((slot, index) => ({
      childKey: slot.childKey,
      branch: `eval-discovery-env-matrix-canary-${index + 1}`,
      databaseUrl: `postgres://x@canary-${index + 1}.neon.tech/protocol_eval`,
      baseBranch: 'eval-discovery-base',
    }));
    expect(parseChildManifest(JSON.stringify({ children }), children.map((child) => child.childKey)).children).toHaveLength(5);
    children[1]!.databaseUrl = children[0]!.databaseUrl;
    expect(() => parseChildManifest(JSON.stringify({ children }), children.map((child) => child.childKey))).toThrow('different normalized DATABASE_URL target');
    expect(() => resolveMatrixExecutionSelection(HISTORICAL_MATRIX_CASES, MATRIX_ROWS, {
      caseId: matrixCase.id,
      canary: true,
      runsRequested: false,
      updateBaseline: true,
    })).toThrow('non-baselineable');
  });

  it('passes the seeded trigger intent to intent-only and both-row graph invocations', async () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    const payload = baseSeedPayload([matrixCase]);
    const fixtureCase = payload.cases[0]!;
    const network = payload.networks[0]!;
    const triggerIntentId = resolveFixtureTriggerIntent(payload, fixtureCase.sourceUserId, network.id);
    const calls: Array<Record<string, unknown>> = [];
    const signals: Array<AbortSignal | undefined> = [];
    const graph = {
      invoke: async (input: Record<string, unknown>, config?: { signal?: AbortSignal }) => {
        calls.push(input);
        signals.push(config?.signal);
        return { discoverySource: 'intent' };
      },
    };
    const controller = new AbortController();

    for (const row of [MATRIX_ROWS[0]!, MATRIX_ROWS[3]!]) {
      await invokeMatrixDiscoveryGraph(graph, {
        sourceUserId: fixtureCase.sourceUserId,
        networkId: network.id,
        triggerIntentId,
      }, row, controller.signal);
    }

    expect(calls).toEqual([
      expect.objectContaining({ userId: fixtureCase.sourceUserId, networkId: network.id, triggerIntentId, options: { minScore: 50 } }),
      expect.objectContaining({ userId: fixtureCase.sourceUserId, networkId: network.id, triggerIntentId, options: { minScore: 50 } }),
    ]);
    expect(signals).toEqual([controller.signal, controller.signal]);
    expect(() => resolveFixtureTriggerIntent(
      { ...payload, memberships: payload.memberships.filter((membership) => membership.userId !== fixtureCase.sourceUserId) },
      fixtureCase.sourceUserId,
      network.id,
    )).toThrow('has no membership');
  });

  it('restores both discovery env variables after a graph error', async () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    process.env.DISCOVERY_PROFILE_SOURCE = 'premise';

    await expect(withMatrixEnvironment(MATRIX_ROWS[2]!, async () => {
      throw new Error('graph failed');
    })).rejects.toThrow('graph failed');

    expect(process.env.DISCOVERY_ALLOWED_TYPES).toBe('intent');
    expect(process.env.DISCOVERY_PROFILE_SOURCE).toBe('premise');
  });

  it('never marks incomplete provider execution baselineable', () => {
    expect(() => assertCompleteMatrix({ requested: 75, completed: 74, failed: 1 })).toThrow('75 complete slots');
  });

  it('does not write a baseline or update summary when all 75 executions complete but an assertion fails', async () => {
    const slots = Array.from({ length: 75 }, (_, index) => ({
      caseId: `historical/case-${index}/intent-only/r1`,
      runs: 1,
      passes: index === 37 ? 0 : 1,
    } as MatrixSlotResult));
    let baselineWrites = 0;
    let summaryWrites = 0;

    await expect(runBaselineUpdateAfterPassingAssertions(slots, async () => {
      baselineWrites += 1;
      summaryWrites += 1;
    })).rejects.toThrow('all 75 matrix assertions to pass');

    expect(baselineWrites).toBe(0);
    expect(summaryWrites).toBe(0);
  });

  it('requires a distinct predeclared Neon child for every configuration/repetition', () => {
    const keys = [...new Set(buildMatrixPlan(HISTORICAL_MATRIX_CASES, MATRIX_ROWS, 3).map((slot) => slot.childKey))];
    const children = keys.map((childKey, index) => ({
      childKey,
      branch: `eval-discovery-env-matrix-${index + 1}`,
      databaseUrl: `postgres://x@ep-${index + 1}.neon.tech/protocol_eval`,
      baseBranch: 'eval-discovery-base',
    }));

    expect(parseChildManifest(JSON.stringify({ children }), keys).children).toHaveLength(15);

    const sameTargetDifferentBranches = children.map((child) => ({ ...child }));
    sameTargetDifferentBranches[1]!.databaseUrl = sameTargetDifferentBranches[0]!.databaseUrl;
    expect(() => parseChildManifest(JSON.stringify({ children: sameTargetDifferentBranches }), keys)).toThrow('different normalized DATABASE_URL target');

    const credentialVariants = children.map((child) => ({ ...child }));
    credentialVariants[1]!.databaseUrl = 'postgres://another-user:secret@ep-1.neon.tech/protocol_eval?sslmode=require#ignored';
    expect(() => parseChildManifest(JSON.stringify({ children: credentialVariants }), keys)).toThrow('different normalized DATABASE_URL target');

    children[1]!.branch = children[0]!.branch;
    expect(() => parseChildManifest(JSON.stringify({ children }), keys)).toThrow('different child branch');
  });

  it('builds a canary artifact accepted by the shared v2 schema with scored run IDs', () => {
    const slot: MatrixSlotResult = {
      caseId: 'h1/intent-only/r1',
      rule: 'intent-only',
      rowId: 'intent-only',
      repetition: 0,
      runs: 1,
      passes: 1,
      passRate: 1,
      flaky: false,
    };
    const execution: MatrixExecutionEvidence = {
      policy: 'strict',
      runs: [{
        runId: 'intent-only-r1::run:1',
        caseId: 'intent-only-r1',
        runIndex: 0,
        outcome: 'success',
        recovered: false,
        attempts: [{
          attemptId: 'intent-only-r1::run:1::attempt:1',
          runId: 'intent-only-r1::run:1',
          runIndex: 0,
          attemptNumber: 1,
          startedAt: '2026-07-28T00:00:00.000Z',
          completedAt: '2026-07-28T00:00:01.000Z',
          durationMs: 1000,
          outcome: 'success',
          retryable: false,
          backoffMs: 0,
        }],
      }],
    };
    const projected = buildMatrixArtifactEvidence([slot], execution);
    const scorecard = buildScorecard(projected.slots, { model: 'test-model', runs: 1 });
    const artifact = buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, scorecard, {
      harness: 'discovery-env-matrix',
      harnessVersion: '1',
      models: ['test-model'],
      runs: 1,
      selection: { fullCorpus: false, filters: { case: 'h1', canary: 'true' } },
      corpusFingerprint: 'a'.repeat(64),
      configFingerprint: 'b'.repeat(64),
      git: { revision: 'c'.repeat(40), dirty: false },
      startedAt: '2026-07-28T00:00:00.000Z',
      completedAt: '2026-07-28T00:00:01.000Z',
      execution: projected.execution,
    });

    expect(artifact.payload.cases[0]!.scoredRunIds).toEqual([`${encodeURIComponent(slot.caseId)}::run:1`]);
    expect(artifact.execution.runs[0]!.caseId).toBe(slot.caseId);
  });

  it('builds a shared-schema-valid failed canary artifact with zero scored runs', () => {
    const slot: MatrixSlotResult = {
      caseId: 'h1/profile-premise/r1',
      rule: 'profile-premise',
      rowId: 'profile-premise',
      repetition: 0,
      // Deliberately nonzero input proves artifact projection excludes failed output.
      runs: 1,
      passes: 1,
      passRate: 1,
      flaky: false,
    };
    const execution: MatrixExecutionEvidence = {
      policy: 'strict',
      runs: [{
        runId: 'profile-premise-r1::run:1',
        caseId: 'profile-premise-r1',
        runIndex: 0,
        outcome: 'failed',
        recovered: false,
        attempts: [{
          attemptId: 'profile-premise-r1::run:1::attempt:1',
          runId: 'profile-premise-r1::run:1',
          runIndex: 0,
          attemptNumber: 1,
          startedAt: '2026-07-28T00:00:00.000Z',
          completedAt: '2026-07-28T00:00:01.000Z',
          durationMs: 1000,
          outcome: 'failure',
          error: { class: 'Error', message: 'graph failed' },
          retryable: false,
          backoffMs: 0,
        }],
      }],
    };
    const projected = buildMatrixArtifactEvidence([slot], execution);
    const scorecard = buildScorecard(projected.slots, { model: 'test-model', runs: 1 });
    const artifact = buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, scorecard, {
      harness: 'discovery-env-matrix',
      harnessVersion: '1',
      models: ['test-model'],
      runs: 1,
      selection: { fullCorpus: false, filters: { case: 'h1', canary: 'true' } },
      corpusFingerprint: 'a'.repeat(64),
      configFingerprint: 'b'.repeat(64),
      git: { revision: 'c'.repeat(40), dirty: false },
      startedAt: '2026-07-28T00:00:00.000Z',
      completedAt: '2026-07-28T00:00:01.000Z',
      execution: projected.execution,
    });

    expect(artifact.payload.cases[0]).toMatchObject({ runs: 0, passes: 0, passRate: 0, scoredRunIds: [] });
  });

  it('validates a positive child timeout with a strict 20-minute default', () => {
    expect(parseMatrixChildTimeoutMs({})).toBe(20 * 60_000);
    expect(parseMatrixChildTimeoutMs({ DISCOVERY_ENV_MATRIX_CHILD_TIMEOUT_MS: '1234' })).toBe(1234);
    for (const value of ['0', '-1', '1.5', 'NaN', ' 1', '1e3']) {
      expect(() => parseMatrixChildTimeoutMs({ DISCOVERY_ENV_MATRIX_CHILD_TIMEOUT_MS: value })).toThrow('positive integer');
    }
  });

  it('cleans child database and cache resources after success without changing output', async () => {
    const calls: string[] = [];
    await expect(runWithChildCleanup(
      async () => { calls.push('run'); return 'artifact'; },
      async () => { calls.push('cleanup'); },
    )).resolves.toBe('artifact');
    expect(calls).toEqual(['run', 'cleanup']);
  });

  it('does not mask a child failure when resource cleanup also fails', async () => {
    await expect(runWithChildCleanup(
      async () => { throw new Error('primary graph failure'); },
      async () => { throw new Error('cleanup failure'); },
      { error: () => undefined },
    )).rejects.toThrow('primary graph failure');
  });

  it('escalates a timed-out child without leaking its database URL and retains the artifact', async () => {
    const signals: string[] = [];
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
    const child = { childKey: 'intent-only-r1', branch: 'eval-discovery-env-matrix-test', databaseUrl: 'postgres://secret@child.neon.tech/protocol_eval', baseBranch: 'eval-discovery-base' };
    const error = await awaitMatrixChildProcess({
      child,
      outputPath: '/tmp/retained-child-artifact.json',
      timeoutMs: 1,
      process: { exited, kill: (signal: string) => { signals.push(signal); if (signal === 'SIGKILL') resolveExit(137); } },
      artifactExists: async () => true,
      sleep: async () => undefined,
      logger: { info: () => undefined, warn: () => undefined },
    }).then(() => undefined, (reason: unknown) => reason as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('intent-only-r1');
    expect(error!.message).toContain('retained-child-artifact.json');
    expect(error!.message).not.toContain('secret');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('retains temporary child artifacts after abnormal completion and removes them only after success', async () => {
    const removed: string[] = [];
    const remove = async (target: string) => { removed.push(target); };
    await finalizeMatrixChildArtifacts('/tmp/retained-child', false, remove, { warn: () => undefined });
    expect(removed).toEqual([]);
    await finalizeMatrixChildArtifacts('/tmp/complete-child', true, remove, { warn: () => undefined });
    expect(removed).toEqual(['/tmp/complete-child']);
  });

  it('requires a successful child artifact before parent cleanup can remove temporary files', async () => {
    const child = { childKey: 'intent-only-r1', branch: 'eval-discovery-env-matrix-test', databaseUrl: 'postgres://secret@child.neon.tech/protocol_eval', baseBranch: 'eval-discovery-base' };
    await expect(awaitMatrixChildProcess({
      child,
      outputPath: '/tmp/missing-child-artifact.json',
      timeoutMs: 1,
      process: { exited: Promise.resolve(0), kill: () => undefined },
      artifactExists: async () => false,
      sleep: async () => undefined,
      logger: { info: () => undefined, warn: () => undefined },
    })).rejects.toThrow('missing-artifact');
  });

  it('projects only evaluator-approved final outcomes while retaining raw retrieval diagnostics', () => {
    const rawCandidates = collectCandidates({
      candidates: [{
        candidateUserId: 'h1-b',
        candidateIntentId: 'intent-target',
        evidence: [{ kind: 'query_intent' }],
      }, {
        candidateUserId: 'h1-c',
        candidateIntentId: 'intent-excluded',
        evidence: [{ kind: 'query_intent' }],
      }],
      evaluatedOpportunities: [{
        score: 91,
        actors: [{ userId: 'h1-a' }, { userId: 'h1-b' }],
      }],
    }, new Set(['h1-a', 'h1-b', 'h1-c']));

    const finalCandidates = projectFinalCandidates({
      evaluatedOpportunities: [{
        score: 91,
        actors: [{ userId: 'h1-a' }, { userId: 'h1-b' }],
      }],
    }, rawCandidates, 'h1-a', 50);

    expect(rawCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'h1-c', retrievalRank: 2 }),
    ]));
    expect(finalCandidates).toEqual([expect.objectContaining({
      id: 'h1-b',
      finalRank: 1,
      evidenceTypes: ['intent'],
    })]);
  });

  it('keeps final rank in the graph evaluator order rather than retrieval rank or score re-sorting', () => {
    const rawCandidates = collectCandidates({
      candidates: [
        { candidateUserId: 'h1-c', evidence: [{ kind: 'query_intent' }] },
        { candidateUserId: 'h1-b', evidence: [{ kind: 'query_intent' }] },
      ],
    }, new Set(['h1-a', 'h1-b', 'h1-c']));
    const finalCandidates = projectFinalCandidates({
      evaluatedOpportunities: [
        { score: 61, actors: [{ userId: 'h1-a' }, { userId: 'h1-b' }] },
        { score: 99, actors: [{ userId: 'h1-a' }, { userId: 'h1-c' }] },
      ],
    }, rawCandidates, 'h1-a', 50);

    expect(finalCandidates.map(({ id, finalRank }) => ({ id, finalRank }))).toEqual([
      { id: 'h1-b', finalRank: 1 },
      { id: 'h1-c', finalRank: 2 },
    ]);
  });

  it('fails closed when an evaluator outcome cannot be matched to raw retrieval evidence', () => {
    expect(() => projectFinalCandidates({
      evaluatedOpportunities: [{ score: 91, actors: [{ userId: 'h1-a' }, { userId: 'unretrieved' }] }],
    }, [], 'h1-a', 50)).toThrow('cannot be projected');
  });

  it('retains sanitized evaluator diagnostics for a raw target rejected below threshold', () => {
    const rawCandidates = collectCandidates({
      candidates: [{ candidateUserId: 'h1-target', evidence: [{ kind: 'query_intent' }] }],
      trace: [{ node: 'candidate', data: { userId: 'h1-target', score: 42, reasoning: 'provider reasoning must not persist' } }],
    }, new Set(['h1-target']));
    const traces = collectEvaluatorTraces({
      trace: [{ node: 'candidate', data: { userId: 'h1-target', score: 42, reasoning: 'provider reasoning must not persist' } }],
    }, rawCandidates, []);

    expect(traces).toEqual([{
      id: 'h1-target',
      retrievalRank: 1,
      evaluatorReturned: true,
      evaluatorScore: 42,
      finalIncluded: false,
      finalRank: null,
    }]);
    expect(JSON.stringify(traces)).not.toContain('provider reasoning');
  });

  it('retains evaluator acceptance and final rank without exposing provider errors', () => {
    const rawCandidates = collectCandidates({
      candidates: [{ candidateUserId: 'h1-target', evidence: [{ kind: 'query_intent' }] }],
    }, new Set(['h1-target']));
    const traces = collectEvaluatorTraces({
      trace: [{ node: 'candidate', data: { userId: 'h1-target', score: 83 } }, {
        node: 'evaluation_errors',
        data: { errors: [{ candidateUserId: 'other-user', error: 'sk-provider-secret' }] },
      }],
    }, rawCandidates, [{ id: 'h1-target', finalRank: 1, evidenceTypes: ['intent'], evidenceIds: {} }]);

    expect(traces).toEqual([{
      id: 'h1-target',
      retrievalRank: 1,
      evaluatorReturned: true,
      evaluatorScore: 83,
      finalIncluded: true,
      finalRank: 1,
    }]);
    expect(JSON.stringify(traces)).not.toContain('sk-provider-secret');
  });

  it('classifies evaluator failures without retaining provider error content', () => {
    const rawCandidates = collectCandidates({
      candidates: [{ candidateUserId: 'h1-target', evidence: [{ kind: 'query_intent' }] }],
    }, new Set(['h1-target']));
    const traces = collectEvaluatorTraces({
      trace: [{
        node: 'evaluation_errors',
        data: { errors: [{ candidateUserId: 'h1-target', error: 'provider secret / prompt text' }] },
      }],
    }, rawCandidates, []);

    expect(traces[0]!.evaluatorError).toEqual({
      classification: 'candidate_evaluation_failed',
      message: 'Evaluator failed for this candidate.',
    });
    expect(JSON.stringify(traces)).not.toContain('provider secret');
  });

  it('preserves concrete graph evidence IDs alongside evidence types in raw retrieval candidates', () => {
    const candidates = collectCandidates({
      candidates: [{
        candidateUserId: 'fixture-user',
        candidateIntentId: 'intent-1',
        candidatePremiseId: 'premise-1',
        candidateContextId: 'context-1',
        evidence: [{ kind: 'query_intent' }, { kind: 'query_premise' }, { kind: 'query_context' }],
      }, {
        userId: 'fixture-user-fallback',
        evidence: [{ kind: 'query_intent' }],
      }],
    }, new Set(['fixture-user']));

    expect(candidates).toEqual([{
      id: 'fixture-user',
      retrievalRank: 1,
      evidenceTypes: ['intent', 'premise', 'user_context'],
      evidenceIds: {
        candidateIntentId: 'intent-1',
        candidatePremiseId: 'premise-1',
        candidateContextId: 'context-1',
      },
    }, {
      id: 'fixture-user-fallback',
      retrievalRank: 2,
      evidenceTypes: ['intent'],
      evidenceIds: {},
    }]);
  });
});
