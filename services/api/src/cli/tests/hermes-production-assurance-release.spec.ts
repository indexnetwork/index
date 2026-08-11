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
    expect(runner).toContain('--max-lock-ms "$HERMES_PREFLIGHT_MAX_LOCK_MS"');
    expect(runner).toContain('--max-total-ms "$HERMES_PREFLIGHT_MAX_TOTAL_MS"');
    expect(runner).not.toContain('--max-lock-ms 5000 --max-total-ms 30000');
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
    expect(workflow).toContain('maintenance:hermes-emergency-control -- --audience hermes-agent');
    expect(workflow).not.toContain('maintenance:hermes-emergency-control -- --confirm');
    expect(workflow).not.toMatch(/OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);

    const protectedJob = workflow.slice(position(workflow, 'previous-api-protected-compatibility:'));
    expect(protectedJob).toContain('if: github.event_name == \'workflow_dispatch\'');
    expect(protectedJob).toContain('environment: production');
    expect(protectedJob).toContain('PREVIOUS_API_IMAGE: ${{ inputs.PREVIOUS_API_IMAGE }}');
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
  });

  it('bumps only the API package metadata to 0.80.0', () => {
    expect(apiPackage.version).toBe('0.80.0');
    expect(apiPackage.scripts?.typecheck).toBe('tsc --noEmit');
    expect(lockfile).toContain('"name": "@indexnetwork/api"');
    expect(lockfile).toContain('"version": "0.80.0"');
  });
});
