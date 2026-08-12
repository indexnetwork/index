import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { HISTORICAL_QUALITY_CASES } from '../../../../../packages/protocol/eval/matching/matching.historical.js';
import { buildHistoricalParticipantMetrics } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.js';
import { buildHistoricalQualityPilotPlan } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.js';
import { HISTORICAL_SHARED_POOL_APPROVAL_RECORD, HISTORICAL_SHARED_POOL_FIXTURE, HISTORICAL_SHARED_POOL_PLAN, HISTORICAL_SHARED_POOL_SEED_PROJECTION } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js';
import { admitHistoricalSharedPool, historicalRetrievalDocumentFingerprint, historicalSharedPoolPlanFingerprint, historicalSharedPoolSeedFingerprint } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.js';
import { HistoricalQualityExecutionRunSchema, HistoricalQualityTransportRowSchema, type HistoricalQualityExecutionRun, type HistoricalQualityTransportRow } from '../../../../../packages/protocol/eval/shared/index.js';
import { buildEnrichmentDiscoveryTrigger, buildIntentDiscoveryTrigger } from '../../queues/opportunity/discovery-trigger.builders';
import { HISTORICAL_QUALITY_BASE_REFRESH_CONFIRMATION } from '../discovery-quality-base';

const ROOT = path.resolve(import.meta.dir, '../../../../../');
const REVIEWED_REVISION = 'cee496de7f79ac0ab696cf581f6c4da585f88bd8';
const MERGED_PR_A_REVISION = 'a03bea49334150419f2ee8a499964ce7c79d6f4d';
const FIXTURE_PATH = 'packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.ts';
const QUALITY_RUNBOOK_PATH = 'docs/guides/ind-638-historical-quality-pilot.md';

const resolvedConfig = {
  models: { lensInferrer: 'audit-lens', opportunityEvaluator: 'audit-evaluator' },
  env: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' },
  fixed: {
    judgeModelId: 'audit-judge',
    embeddingModelId: 'audit-embedding',
    providerAccountFingerprint: 'audit-provider-account',
    corpusVersion: HISTORICAL_SHARED_POOL_PLAN.corpusVersion,
    scoringPolicyFingerprint: 'audit-scoring-policy',
  },
};

describe('historical quality operator runbook confirmations', () => {
  it('keeps the eval CLI ancestry audit on a full-history checkout', () => {
    const workflow = readFileSync(path.join(ROOT, '.github/workflows/lint.yml'), 'utf8');
    const evalCliJob = workflow.match(/^ {2}eval-cli-tests:\n([\s\S]*?)(?=^ {2}[a-z][a-z-]*:\n)/m)?.[1];

    expect(evalCliJob).toBeDefined();
    expect(evalCliJob).toMatch(/- uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262(?: # v4\.4\.0)?\n\s+with:\n\s+fetch-depth: 0/);
  });

  it('keeps every exact confirmation and its one operation in the same fail-closed shell block', () => {
    const runbook = readFileSync(path.join(ROOT, QUALITY_RUNBOOK_PATH), 'utf8');
    const shellBlocks = [...runbook.matchAll(/^[ \t]*```bash\n([\s\S]*?)\n[ \t]*```/gm)].map((match) => match[1]!);
    const confirmations = [
      ['provision IND-638 base read replica', 'eval:discovery-quality-read-replica:provision', 'DISCOVERY_QUALITY_READ_REPLICA_CONFIRM'],
      ['validate IND-638 secret migration', 'v2 legacy child projection verified', 'IND_638_CONFIRM'],
      [HISTORICAL_QUALITY_BASE_REFRESH_CONFIRMATION, 'eval:discovery-quality-base', 'IND_638_CONFIRM'],
      ['verify IND-638 historical quality read replica', 'eval:discovery-quality-base:verify', 'IND_638_CONFIRM'],
      ['run IND-638 legacy A/B smoke', '--a DISCOVERY_ALLOWED_TYPES=intent', 'IND_638_CONFIRM'],
      ['run IND-638 intent quality smoke', '--trigger intent --runs 1', 'IND_638_CONFIRM'],
      ['run IND-638 enrichment quality smoke', '--trigger enrichment --runs 1', 'IND_638_CONFIRM'],
      ['run IND-638 ten-slot quality pilot', '--historical-quality --env DISCOVERY_ALLOWED_TYPES=intent,profile --runs 1', 'IND_638_CONFIRM'],
    ] as const;

    for (const [phrase, operation, gate] of confirmations) {
      const block = shellBlocks.find((candidate) => candidate.includes(`Type "${phrase}"`) && candidate.includes(operation));
      expect(block, phrase).toBeDefined();
      expect(block).toContain('set -euo pipefail');
      expect(block).toContain(`test "$${gate}" = '${phrase}'`);
      expect(block).toContain(`export ${gate}`);
      expect(block).toContain(`trap 'unset ${gate}`);
      expect(block!.indexOf(`test "$${gate}" = '${phrase}'`)).toBeLessThan(block!.indexOf(operation));
      expect(block!.indexOf(`export ${gate}`)).toBeLessThan(block!.indexOf(operation));
    }
    expect((runbook.match(/read -r -p 'Type "/g) ?? [])).toHaveLength(confirmations.length);
    const refreshBlock = shellBlocks.find((candidate) => candidate.includes(`Type "${HISTORICAL_QUALITY_BASE_REFRESH_CONFIRMATION}"`));
    expect(refreshBlock).toContain('export TEST_DATABASE_SAFE=1');
    expect(runbook).toContain('Production code repeats both checks before constructing the control plane');
  });
});

function git(...args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({ cmd: ['git', ...args], cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
}

function gitText(...args: string[]): string {
  const result = git(...args);
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

function failedParticipantMetrics() {
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    participantId: `participant-${String(index + 1).padStart(2, '0')}`,
    role: index === 0 ? 'target' as const : index < 4 ? 'semantic-negative' as const : 'background' as const,
  }));
  return buildHistoricalParticipantMetrics({
    completed: false,
    candidates,
    retrievalEvidence: [],
    evaluatorTraces: candidates.map(({ participantId }) => ({
      participantId,
      eligible: false,
      submitted: false,
      returned: false,
      score: null,
    })),
    evaluatedOpportunities: [],
  });
}

describe('merged PR A historical quality authority audit', () => {
  it('keeps current protocol and API releases synchronized with the root lock without changing Eval Ops', () => {
    const protocolPackage = JSON.parse(readFileSync(path.join(ROOT, 'packages/protocol/package.json'), 'utf8'));
    const apiPackage = JSON.parse(readFileSync(path.join(ROOT, 'services/api/package.json'), 'utf8'));
    const evalOpsPackage = JSON.parse(readFileSync(path.join(ROOT, 'apps/eval-ops/package.json'), 'utf8'));
    const lock = readFileSync(path.join(ROOT, 'bun.lock'), 'utf8');

    expect(protocolPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(apiPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(evalOpsPackage.version).toBe('0.6.0');
    expect(lock).toContain(`"packages/protocol": {\n      "name": "@indexnetwork/protocol",\n      "version": "${protocolPackage.version}"`);
    expect(lock).toContain(`"services/api": {\n      "name": "@indexnetwork/api",\n      "version": "${apiPackage.version}"`);
    expect(lock).toContain('"apps/eval-ops": {\n      "name": "@indexnetwork/eval-ops",\n      "version": "0.6.0"');
  });

  it('uses only the admitted single-configuration pilot planner for ten one-attempt slots', () => {
    const plan = buildHistoricalQualityPilotPlan({
      caseIds: HISTORICAL_SHARED_POOL_PLAN.cases.map((row) => row.caseId),
      triggers: ['intent', 'enrichment'],
      repetitions: 1,
      configuration: { id: 'a', config: resolvedConfig },
    });

    expect(plan.slots).toHaveLength(10);
    expect(plan.graphInvocations).toBe(10);
    expect(plan.evaluatorCalls).toBe(10);
    expect(plan.maxAttempts).toBe(1);
    expect(plan.slots.every((slot) => slot.selectedSide === 'a' && slot.maxAttempts === 1)).toBe(true);
    expect(admitHistoricalSharedPool({
      cases: HISTORICAL_QUALITY_CASES,
      fixture: HISTORICAL_SHARED_POOL_FIXTURE,
      current: {
        authorId: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.authorId,
        contentRevision: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision,
      },
    })).toEqual(HISTORICAL_SHARED_POOL_PLAN);
  });

  it('recomputes all approved fingerprints and keeps their domains pairwise distinct', () => {
    const recomputed = {
      planFingerprint: historicalSharedPoolPlanFingerprint(HISTORICAL_SHARED_POOL_PLAN),
      seedProjectionFingerprint: historicalSharedPoolSeedFingerprint(HISTORICAL_SHARED_POOL_SEED_PROJECTION),
      retrievalDocumentFingerprint: historicalRetrievalDocumentFingerprint(HISTORICAL_SHARED_POOL_SEED_PROJECTION.documents),
    };

    expect(recomputed.planFingerprint).toBe(HISTORICAL_SHARED_POOL_APPROVAL_RECORD.planFingerprint);
    expect(recomputed.seedProjectionFingerprint).toBe(HISTORICAL_SHARED_POOL_APPROVAL_RECORD.seedProjectionFingerprint);
    expect(recomputed.retrievalDocumentFingerprint).toBe(HISTORICAL_SHARED_POOL_APPROVAL_RECORD.retrievalDocumentFingerprint);
    expect(new Set(Object.values(recomputed)).size).toBe(3);
    expect(HISTORICAL_SHARED_POOL_PLAN.seedProjection).toBe(HISTORICAL_SHARED_POOL_SEED_PROJECTION);
  });

  it('keeps the independently reviewed fixture content in the merged PR A ancestry', () => {
    expect(git('merge-base', '--is-ancestor', MERGED_PR_A_REVISION, 'HEAD').exitCode).toBe(0);
    expect(git('merge-base', '--is-ancestor', HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision, REVIEWED_REVISION).exitCode).toBe(0);
    expect(gitText('show', `${REVIEWED_REVISION}:${FIXTURE_PATH}`)).toBe(gitText('show', `HEAD:${FIXTURE_PATH}`));
  });

  it('locks the pure trigger projections and historical metric authority', () => {
    const participant = HISTORICAL_SHARED_POOL_PLAN.participants[0]!;
    const networkId = HISTORICAL_SHARED_POOL_PLAN.network.id;
    expect(buildIntentDiscoveryTrigger({
      userId: participant.userId,
      searchQuery: 'audit query',
      networkIds: [networkId],
      triggerIntentId: participant.intentId,
    })).toEqual({
      userId: participant.userId,
      searchQuery: 'audit query',
      operationMode: 'create',
      networkId,
      triggerIntentId: participant.intentId,
      options: { initialStatus: 'latent' },
    });
    expect(buildEnrichmentDiscoveryTrigger({ userId: participant.userId, networkId })).toEqual({
      userId: participant.userId,
      operationMode: 'create',
      networkId,
      options: { initialStatus: 'latent' },
    });
    expect(failedParticipantMetrics()).toHaveLength(24);
    expect(failedParticipantMetrics().every((metric) => metric.failureStage === 'execution')).toBe(true);
  });

  it('parses canonical transport and single-attempt execution rows through PR A exports', () => {
    const validTransportRow = {
      kind: 'historical-quality-pilot',
      logicalCaseId: HISTORICAL_SHARED_POOL_PLAN.cases[0]!.caseId,
      trigger: 'intent',
      repetition: 0,
      configurationFingerprint: 'a'.repeat(64),
      completed: false,
      participantMetrics: failedParticipantMetrics(),
      stageFunnel: null,
    } satisfies HistoricalQualityTransportRow;
    const caseId = 'historical-quality-audit/intent/r1';
    const runId = `${encodeURIComponent(caseId)}::run:1`;
    const validExecutionRun = {
      runId,
      caseId,
      runIndex: 0,
      outcome: 'success',
      recovered: false,
      attempts: [{
        attemptId: `${runId}::attempt:1`,
        runId,
        runIndex: 0,
        attemptNumber: 1,
        startedAt: '2026-08-10T00:00:00.000Z',
        completedAt: '2026-08-10T00:00:00.010Z',
        durationMs: 10,
        outcome: 'success',
        retryable: false,
        backoffMs: 0,
      }],
    } satisfies HistoricalQualityExecutionRun;

    expect(HistoricalQualityTransportRowSchema.parse(validTransportRow)).toEqual(validTransportRow);
    expect(HistoricalQualityExecutionRunSchema.parse(validExecutionRun)).toEqual(validExecutionRun);
  });

  it('keeps comparison planning out of every quality runtime source boundary', () => {
    const pilotPath = path.join(ROOT, 'packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.ts');
    const comparisonPath = path.join(ROOT, 'packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts');
    const qualityRuntimePaths = [
      path.join(ROOT, 'services/api/src/cli/discovery.ts'),
      path.join(ROOT, 'services/api/src/cli/discovery-quality.contract.ts'),
      path.join(ROOT, 'services/api/src/cli/discovery-quality.runtime.ts'),
      path.join(ROOT, 'services/api/src/cli/discovery-quality.main.ts'),
    ];
    const pilotSource = readFileSync(pilotPath, 'utf8');
    const comparisonSource = readFileSync(comparisonPath, 'utf8');
    const runtimeSource = qualityRuntimePaths.filter(existsSync).map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(pilotSource).toContain('export function buildHistoricalQualityPilotPlan');
    expect(comparisonSource).toContain('export function buildHistoricalExperimentPlan');
    expect(runtimeSource).not.toMatch(/import[^;]*buildHistoricalExperimentPlan/);
    expect(runtimeSource).not.toMatch(/buildHistoricalExperimentPlan\s*\(/);
  });
});
