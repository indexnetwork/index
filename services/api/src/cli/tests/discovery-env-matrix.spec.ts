import { describe, expect, it } from 'bun:test';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import { MATRIX_ROWS } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.policy.js';
import { buildEvalArtifact, buildScorecard, EVAL_RUN_REPORT_ARTIFACT_TYPE } from '../../../../../packages/protocol/eval/shared/index.js';

import { buildMatrixArtifactEvidence, collectCandidates, resolveMatrixExecutionSelection, type MatrixExecutionEvidence, type MatrixSlotResult } from '../discovery-env-matrix';
import { assertCompleteMatrix, buildCanaryPlan, buildMatrixPlan, parseChildManifest, withMatrixEnvironment } from '../discovery-env-matrix.runtime';

describe('discovery environment matrix runtime seams', () => {
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

  it('preserves concrete graph evidence IDs alongside evidence types in run candidates', () => {
    const candidates = collectCandidates({
      candidates: [{
        candidateUserId: 'fixture-user',
        candidateIntentId: 'intent-1',
        candidatePremiseId: 'premise-1',
        candidateContextId: 'context-1',
        evidence: [{ kind: 'query_intent' }, { kind: 'query_premise' }, { kind: 'query_context' }],
      }],
    }, new Set(['fixture-user']));

    expect(candidates).toEqual([{
      id: 'fixture-user',
      evidenceTypes: ['intent', 'premise', 'user_context'],
      evidenceIds: {
        candidateIntentId: 'intent-1',
        candidatePremiseId: 'premise-1',
        candidateContextId: 'context-1',
      },
    }]);
  });
});
