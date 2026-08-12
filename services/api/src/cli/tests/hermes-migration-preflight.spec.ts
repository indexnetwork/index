import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';

import { HERMES_CANONICAL_ACTIONS } from '../../lib/agent/hermes-capabilities';
import * as schema from '../../schemas/database.schema';
import { assertPreflightPass, formatPreflightReport, parseLegacyMetadata, type HermesPreflightReport } from '../hermes-migration-preflight.contract';
import { parseHermesPreflightArguments, runHermesPreflightMain } from '../hermes-migration-preflight.main';

const cleanReport: HermesPreflightReport = {
  invalidLegacyMetadata: 0,
  duplicateSelections: 0,
  invalidDedicatedCredentials: 0,
  expiryMismatches: 0,
  missingIndexes: 0,
  lockDurationMs: 12,
  totalDurationMs: 20,
  checkedAt: '2026-08-09T12:00:00.000Z',
};

describe('Hermes migration preflight contract', () => {
  it('classifies legacy text before exposing parsed metadata', () => {
    expect(parseLegacyMetadata('{"audience":"hermes-negotiator"}')).toEqual({ valid: true });
    expect(parseLegacyMetadata('{broken')).toEqual({ valid: false });
    expect(parseLegacyMetadata('[]')).toEqual({ valid: true });
    expect(parseLegacyMetadata('42')).toEqual({ valid: true });
    expect(parseLegacyMetadata('null')).toEqual({ valid: true });
    expect(parseLegacyMetadata('"scalar"')).toEqual({ valid: true });
    expect(parseLegacyMetadata(null)).toEqual({ valid: true });
  });

  it('formats only the typed count and duration report', () => {
    const output = formatPreflightReport({
      ...cleanReport,
      invalidLegacyMetadata: 1,
      credential: 'idxh_must_not_escape',
      provider: 'must_not_escape',
    } as HermesPreflightReport);
    expect(output).not.toContain('idxh_');
    expect(output).not.toContain('must_not_escape');
    expect(output).not.toContain('owner');
    expect(output).not.toContain('agent');
    expect(output).not.toContain('metadata');
    expect(JSON.parse(output)).toEqual({ ...cleanReport, invalidLegacyMetadata: 1 });
  });

  it.each([
    ['invalidLegacyMetadata', 'invalid legacy API-key metadata'],
    ['duplicateSelections', 'duplicate selected executors'],
    ['invalidDedicatedCredentials', 'invalid dedicated credentials'],
    ['expiryMismatches', 'credential expiry mismatches'],
    ['missingIndexes', 'missing or invalid indexes/constraints'],
  ] as const)('fails closed for %s', (field, message) => {
    expect(() => assertPreflightPass({ ...cleanReport, [field]: 1 })).toThrow(message);
  });

  it('accepts a clean report and rejects malformed numeric report fields', () => {
    expect(() => assertPreflightPass(cleanReport)).not.toThrow();
    expect(() => assertPreflightPass({ ...cleanReport, lockDurationMs: Number.NaN })).toThrow(
      'invalid preflight report',
    );
    expect(() => assertPreflightPass({ ...cleanReport, totalDurationMs: Number.NaN })).toThrow(
      'invalid preflight report',
    );
  });

  it('requires JSON output and explicit positive duration thresholds', () => {
    expect(parseHermesPreflightArguments([
      '--json', '--max-lock-ms', '5000', '--max-total-ms', '30000',
    ])).toEqual({ json: true, maxLockMs: 5000, maxTotalMs: 30000 });
    expect(() => parseHermesPreflightArguments(['--json'])).toThrow('--max-lock-ms is required');
    expect(() => parseHermesPreflightArguments([
      '--json', '--max-lock-ms', '5000', '--max-total-ms', '-1',
    ])).toThrow('--max-total-ms must be a positive finite number');
    expect(() => parseHermesPreflightArguments([
      '--json', '--max-lock-ms', '0', '--max-total-ms', '30000',
    ])).toThrow('--max-lock-ms must be a positive finite number');
    expect(() => parseHermesPreflightArguments([
      '--max-lock-ms', '5000', '--max-total-ms', '30000',
    ])).toThrow('--json is required');
  });

  it('matches the actual legacy text schema and guards every SQL cast behind safe classification', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../..');
    const schema = readFileSync(path.join(apiRoot, 'src/schemas/database.schema.ts'), 'utf8');
    const apikeySchema = schema.slice(
      schema.indexOf("export const apikeys = pgTable('apikey'"),
      schema.indexOf('export const userNotificationSettings'),
    );
    const implementation = readFileSync(
      path.join(apiRoot, 'src/cli/hermes-migration-preflight.ts'),
      'utf8',
    );
    const classification = implementation.slice(
      implementation.indexOf('SELECT count(*)::int AS count\n      FROM apikey'),
      implementation.indexOf('const duplicateSelections'),
    );

    expect(apikeySchema).toContain("metadata: text('metadata')");
    expect(classification).toContain("NOT pg_input_is_valid(metadata, 'jsonb')");
    expect(classification).not.toContain('metadata::jsonb');
  });

  it('establishes bounded repeatable-read before queries and validates exact catalog definitions', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../..');
    const implementation = readFileSync(
      path.join(apiRoot, 'src/cli/hermes-migration-preflight.ts'),
      'utf8',
    );
    const transaction = implementation.slice(
      implementation.indexOf('return input.database.transaction'),
      implementation.indexOf('const invalidLegacyMetadata'),
    );

    expect(transaction).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    expect(transaction.indexOf('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')).toBeLessThan(
      transaction.indexOf('SET LOCAL lock_timeout'),
    );
    expect(transaction).toContain('SET LOCAL lock_timeout');
    expect(transaction).toContain('SET LOCAL statement_timeout');
    expect(implementation).toContain('pg_get_indexdef(index_catalog.indexrelid)');
    expect(implementation).toContain("extract(epoch FROM (expires_at - issued_at)) <> 2592000");
  });

  it('passes explicit CLI thresholds into the bounded database runner', async () => {
    let received: unknown;
    await runHermesPreflightMain({
      args: ['--json', '--max-lock-ms', '5000', '--max-total-ms', '30000'],
      run: async (thresholds) => {
        received = thresholds;
        const { totalDurationMs: _totalDurationMs, ...checks } = cleanReport;
        return checks;
      },
      now: () => 10,
      write: () => undefined,
    });
    expect(received).toEqual({ maxLockMs: 5000, maxTotalMs: 30000 });
  });

  it('measures, validates, and serializes total duration in the exact report schema', async () => {
    const outputs: string[] = [];
    const values = [100, 123];
    const { totalDurationMs: _totalDurationMs, ...checks } = cleanReport;
    const report = await runHermesPreflightMain({
      args: ['--json', '--max-lock-ms', '5000', '--max-total-ms', '30000'],
      run: async () => checks,
      now: () => values.shift()!,
      write: (output) => outputs.push(output),
    });

    expect(report.totalDurationMs).toBe(23);
    expect(Object.keys(JSON.parse(outputs[0]!)).sort()).toEqual([
      'checkedAt', 'duplicateSelections', 'expiryMismatches', 'invalidDedicatedCredentials',
      'invalidLegacyMetadata', 'lockDurationMs', 'missingIndexes', 'totalDurationMs',
    ]);
    expect(JSON.parse(outputs[0]!).totalDurationMs).toBe(23);
  });

  it('renders full and sliced fixture actions as one PostgreSQL text-array parameter', () => {
    const database = drizzle.mock({ schema });
    const render = (actions: string[]) => database.insert(schema.hermesAgentCredentials).values({
      id: 'synthetic-id',
      secretHash: 'synthetic-hash',
      ownerId: 'synthetic-owner',
      agentId: 'synthetic-agent',
      installationId: 'synthetic-installation',
      setupAttemptId: 'synthetic-setup',
      audience: 'hermes-agent',
      actions,
      activationState: 'revoked',
      issuedAt: new Date('2026-08-09T00:00:00.000Z'),
      expiresAt: new Date('2026-09-08T00:00:00.000Z'),
      revokedAt: new Date('2026-08-09T00:00:00.000Z'),
    }).toSQL();

    const full = render([...HERMES_CANONICAL_ACTIONS]);
    const sliced = render(HERMES_CANONICAL_ACTIONS.slice(0, -1));
    expect(full.sql).toContain('values ($1, $2, $3, $4, $5, $6, $7, $8, $9');
    expect(full.params[7]).toBe('{"manage:identity","manage:premises","manage:intents","manage:networks","manage:opportunities","manage:negotiations"}');
    expect(sliced.params[7]).toBe('{"manage:identity","manage:premises","manage:intents","manage:networks","manage:opportunities"}');
    expect(full.params).toHaveLength(12);
    expect(sliced.params).toHaveLength(12);
  });

  it('uses the rendered-safe typed insert at every credential fixture site', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../..');
    const fixture = readFileSync(
      path.join(apiRoot, 'src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts'),
      'utf8',
    );

    expect(fixture.match(/\.insert\(schema\.hermesAgentCredentials\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(fixture).not.toContain('${HERMES_CANONICAL_ACTIONS}');
    expect(fixture).not.toContain('${HERMES_CANONICAL_ACTIONS.slice(0, -1)}');
    expect(fixture).toContain('actions: [...HERMES_CANONICAL_ACTIONS]');
    expect(fixture).toContain('actions: HERMES_CANONICAL_ACTIONS.slice(0, -1)');
  });

  it('emits the count-only JSON report before failing a dirty preflight', async () => {
    const outputs: string[] = [];
    await expect(runHermesPreflightMain({
      args: ['--json', '--max-lock-ms', '5000', '--max-total-ms', '30000'],
      run: async () => {
        const { totalDurationMs: _totalDurationMs, ...checks } = cleanReport;
        return { ...checks, invalidLegacyMetadata: 1 };
      },
      now: (() => {
        const values = [10, 20];
        return () => values.shift()!;
      })(),
      write: (output) => outputs.push(output),
    })).rejects.toThrow('invalid legacy API-key metadata');
    expect(outputs).toEqual([formatPreflightReport({
      ...cleanReport,
      invalidLegacyMetadata: 1,
      totalDurationMs: 10,
    })]);
  });

  it('never includes credential/provider environment names in the provider-free contract', () => {
    const source = `${parseLegacyMetadata}\n${formatPreflightReport}\n${parseHermesPreflightArguments}`;
    expect(source).not.toMatch(/OPENROUTER|API_KEY|DATABASE_URL|idxh_/);
  });
});
