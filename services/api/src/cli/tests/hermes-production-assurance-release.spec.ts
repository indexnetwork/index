import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const apiRoot = path.resolve(import.meta.dir, '../../..');
const repositoryRoot = path.resolve(apiRoot, '../..');
const workflow = readFileSync(
  path.join(repositoryRoot, '.github/workflows/hermes-backend-production-assurance.yml'),
  'utf8',
);
const runner = readFileSync(path.join(apiRoot, 'scripts/test-hermes-production-assurance.sh'), 'utf8');
const preflightFixture = readFileSync(
  path.join(apiRoot, 'src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts'),
  'utf8',
);
const emergencyContract = readFileSync(path.join(apiRoot, 'src/cli/hermes-emergency-control.contract.ts'), 'utf8');
const runtimeService = readFileSync(path.join(apiRoot, 'src/services/agent-runtime.service.ts'), 'utf8');
const macRuntimeSaga = readFileSync(path.join(repositoryRoot, 'apps/mac/api/agent-runtime-saga.spec.mjs'), 'utf8');
const rolloutPath = path.join(repositoryRoot, 'docs/rollout/hermes-backend-production-assurance.md');
const rollbackPath = path.join(repositoryRoot, 'docs/runbooks/hermes-emergency-rollback.md');
const rollout = existsSync(rolloutPath) ? readFileSync(rolloutPath, 'utf8') : '';
const rollback = existsSync(rollbackPath) ? readFileSync(rollbackPath, 'utf8') : '';
const apiPackage = JSON.parse(readFileSync(path.join(apiRoot, 'package.json'), 'utf8')) as {
  version?: string;
  scripts?: Record<string, string>;
};
const lockfile = readFileSync(path.join(repositoryRoot, 'bun.lock'), 'utf8');

function position(source: string, value: string): number {
  const result = source.indexOf(value);
  expect(result, `missing ${value}`).toBeGreaterThan(-1);
  return result;
}

describe('Hermes final production assurance release contract', () => {
  it('runs every guarded database suite with operator-supplied preflight thresholds', () => {
    for (const target of [
      'src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts',
      'src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts',
      'src/lib/drizzle/tests/hermes-runtime-telemetry.database.isolated.ts',
      'tests/hermes-runtime-lifecycle.database.isolated.ts',
      'tests/negotiation-runtime-authority.database.isolated.ts',
    ]) {
      expect(runner).toContain(target);
    }
    expect(runner).toContain(': "${HERMES_PREFLIGHT_MAX_LOCK_MS:?');
    expect(runner).toContain(': "${HERMES_PREFLIGHT_MAX_TOTAL_MS:?');
    expect(runner).toContain('export HERMES_PREFLIGHT_MAX_LOCK_MS HERMES_PREFLIGHT_MAX_TOTAL_MS');
    expect(runner).toContain('--max-lock-ms "$HERMES_PREFLIGHT_MAX_LOCK_MS"');
    expect(runner).toContain('--max-total-ms "$HERMES_PREFLIGHT_MAX_TOTAL_MS"');
    expect(runner).not.toContain('--max-lock-ms 5000 --max-total-ms 30000');

    expect(preflightFixture).toContain('requireHermesPreflightThresholds(process.env)');
    expect(preflightFixture).toContain('thresholds: THRESHOLDS');
    expect(preflightFixture).toContain("SET LOCAL lock_timeout = '${THRESHOLDS.maxLockMs}ms'");
    expect(preflightFixture).toContain('THRESHOLDS.maxTotalMs');
    expect(preflightFixture).not.toMatch(/THRESHOLDS\s*=\s*\{\s*maxLockMs:\s*5_?000/);

    const workflowThresholds = position(workflow, 'HERMES_PREFLIGHT_MAX_LOCK_MS: ${{ steps.preflight_thresholds.outputs.max_lock_ms }}');
    const workflowFreshSuite = position(workflow, 'bun run --cwd services/api test:hermes-production-assurance');
    expect(workflowThresholds).toBeLessThan(workflowFreshSuite);
  });

  it('keeps the release workflow provider-free, explicit, dry-run-only, and no-skip', () => {
    expect(workflow).toContain('HERMES_PREFLIGHT_MAX_LOCK_MS:');
    expect(workflow).toContain('HERMES_PREFLIGHT_MAX_TOTAL_MS:');
    expect(workflow).toContain('required: true');
    expect(workflow).toContain('bun run --cwd services/api db:migrate:test');
    expect(workflow).toContain('bun run --cwd services/api build');
    expect(workflow).toContain('bun run --cwd services/api typecheck');
    expect(workflow).toContain('bun run --cwd services/api typecheck:cli-specs');
    expect(workflow).toContain('bun run --cwd services/api lint');
    expect(workflow).toContain('src/lib/testing/tests/isolated-test-suite.spec.ts');
    expect(workflow).toContain('Run stale and expired Index coverage smoke');
    expect(workflow).toContain('src/lib/agent/tests/hermes-runtime-telemetry.spec.ts');
    expect(workflow).toContain('src/lib/testing/tests/hermes-assurance-output.spec.ts');
    expect(workflow).toContain('API_TEST_ISOLATED_TARGET=src/lib/agent/tests/hermes-runtime-telemetry-sentry.isolated.ts');
    expect(workflow).toContain('bun test services/api/src/lib/testing/isolated-test-import-harness.spec.ts');
    expect(workflow).toContain('maintenance:hermes-emergency-control -- --audience hermes-agent');
    expect(workflow).not.toContain('maintenance:hermes-emergency-control -- --confirm');
    expect(workflow).not.toMatch(/OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);

    const protectedJob = workflow.slice(position(workflow, 'previous-api-protected-compatibility:'));
    expect(protectedJob).toContain('if: github.event_name == \'workflow_dispatch\'');
    expect(protectedJob).toContain('environment: production');
    expect(protectedJob).toContain('PREVIOUS_API_IMAGE: ${{ inputs.PREVIOUS_API_IMAGE }}');
  });

  it('pins the workflow token, actions, and multi-arch PostgreSQL supply chain', () => {
    const checkoutSha = '11d5960a326750d5838078e36cf38b85af677262';
    const setupBunSha = '0c5077e51419868618aeaa5fe8019c62421857d6';
    const uploadSha = 'ea165f8d65b6e75b540449e92b4886f43607fa02';
    const postgresDigest = 'sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b';
    const postgresReference = `postgres:16@${postgresDigest}`;

    expect(workflow).toMatch(/permissions:\n\s+contents: read/);
    const actionUses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(actionUses).toHaveLength(11);
    for (const actionUse of actionUses) expect(actionUse).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    expect(workflow).not.toMatch(/uses:\s*[^@\s]+@v\d/);
    expect(workflow.match(new RegExp(`actions/checkout@${checkoutSha} # v4\\.4\\.0`, 'g'))).toHaveLength(3);
    expect(workflow.match(new RegExp(`oven-sh/setup-bun@${setupBunSha} # v2\\.2\\.0`, 'g'))).toHaveLength(3);
    expect(workflow.match(new RegExp(`actions/upload-artifact@${uploadSha} # v4\\.6\\.2`, 'g'))).toHaveLength(5);
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(3);
    expect(workflow).toContain('[[ "$remote_url" =~ ^https://github\\.com/[^/]+/[^/]+(\\.git)?$ ]]');
    expect(workflow).toContain('git fetch --no-tags origin');
    expect(workflow.match(new RegExp(`image: ${postgresReference}`, 'g'))).toHaveLength(3);
    expect(workflow.match(new RegExp(`test "\\$image_ref" = "${postgresReference}"`, 'g'))).toHaveLength(3);
    expect(workflow.match(new RegExp(`test "\\$\\{image_ref##\\*@\\}" = "${postgresDigest}"`, 'g'))).toHaveLength(3);
    expect(workflow).not.toMatch(/image:\s+postgres:16\s*$/m);
  });

  it('validates the exact emergency dry-run plan schema and reason', () => {
    expect(emergencyContract).toContain("reason: 'dry-run';");
    expect(emergencyContract).toContain("reason: 'dry-run',");
    expect(workflow).toContain('value.reason !== "dry-run"');
    expect(workflow).toContain('Object.keys(value).sort().join(",") !== expectedKeys.sort().join(",")');
    expect(rollback).toContain('.reason == "dry-run"');
    expect(rollback).not.toContain('.reason == "planned"');
  });

  it('uploads only the aggregate evidence and established sanitized JSON reports', () => {
    expect(workflow).toContain('hermes-backend-assurance.json');
    expect(workflow).toContain('hermes-migration-preflight-report.json');
    expect(workflow).toContain('previous-api-compatibility-diagnostic.json');
    expect(workflow).toContain('previous-api-compatibility-protected.json');
    expect(workflow).not.toMatch(/path:.*(?:\.log|stdout|stderr|DATABASE_URL)/);
    expect(workflow).not.toContain('path: services/api/*.json');
    const aggregateStep = workflow.slice(
      position(workflow, '- name: Create aggregate credential-free assurance evidence'),
      position(workflow, '  previous-api-protected-compatibility:'),
    );
    expect(aggregateStep).not.toMatch(/ownerId|agentId|installationId|negotiationId|credentialId|secretHash|planId|receiptId|DATABASE_URL/);
  });

  it('documents the exact rollout smoke and evidence boundary', () => {
    for (const phrase of [
      'server before client',
      'prepare → select → pickup → respond → consult → Index → reselect → disconnect',
      'POST /api/hermes-authorizations',
      'activated connector tuple',
      'health:"never-seen"',
      'indexCovering:true',
      'health:"active"',
      'indexCovering:false',
      'indexCovering: true',
      'credentials_near_expiry',
      'credentials_expired',
      'pending_outbox',
      'advisory_lock_wait_ms',
      'release-approved',
      'operator-supplied immutable digest',
      'does not authorize production execution',
      'credential-free',
    ]) {
      expect(rollout).toContain(phrase);
    }
    expect(rollout).toContain('never call the legacy `/api/agent-runtime/hermes/prepare` route');
    expect(rollout).not.toContain('call `POST /api/agent-runtime/hermes/prepare`');
    expect(macRuntimeSaga).toContain("legacy prepare must not run");
    expect(macRuntimeSaga).toContain('selects only the exact active connector authority without preparing or carrying plaintext');
    expect(runtimeService).toContain("lastPickup === null\n      ? 'never-seen'");
    expect(runtimeService).toContain("indexCovering: selectedRuntime === 'index' || health !== 'active'");
    expect(position(rollout, 'health:"never-seen"')).toBeLessThan(position(rollout, 'health:"active"'));
    expect(position(rollout, 'indexCovering:true')).toBeLessThan(position(rollout, 'indexCovering:false'));
  });

  it('documents forward-fix-first rollback and the exact emergency order', () => {
    const pause = position(rollback, '1. Pause');
    const revoke = position(rollback, '2. Bulk revoke');
    const verify = position(rollback, '3. Verify zero active dedicated credentials and zero selected Hermes');
    const restore = position(rollback, '4. Restore older binary');
    expect([pause, revoke, verify, restore]).toEqual([...[pause, revoke, verify, restore]].sort((a, b) => a - b));
    expect(rollback).toContain('forward-fix-first');
    expect(rollback).toContain('--audience hermes-agent');
    expect(rollback).toContain('--confirm');
    expect(rollback).toContain('--plan-id "$plan_id"');
    expect(rollback).toContain('--expected-installations "$expected_installations"');
    expect(rollback).toContain('canonical non-negative decimal');
    expect(rollback).toContain('hermes_assurance');
    expect(rollback).toContain('does not authorize production execution');
    expect(rollback).toContain('Never upload the plan ID');
    expect(rollback).toContain('omit the `body` option entirely');
    expect(rollback).not.toContain('body: {}');
  });

  it('runs for every contracted Task 7 source, runbook, plan, and report path', () => {
    for (const sourcePath of [
      'docs/rollout/hermes-backend-production-assurance.md',
      'docs/runbooks/hermes-emergency-rollback.md',
      'docs/guides/development-reference.md',
      'docs/superpowers/plans/2026-08-09-hermes-backend-production-assurance.md',
      '.superpowers/sdd/2026-08-09-hermes-backend-production-assurance/task-7-report.md',
    ]) {
      expect(workflow).toContain(`- "${sourcePath}"`);
    }
  });

  it('bumps only the API package metadata to 0.80.0', () => {
    expect(apiPackage.version).toBe('0.80.0');
    expect(apiPackage.scripts?.typecheck).toBe('tsc --noEmit');
    expect(lockfile).toContain('"name": "@indexnetwork/api"');
    expect(lockfile).toContain('"version": "0.80.0"');
  });
});
