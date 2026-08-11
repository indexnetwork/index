import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { assertPreflightPass, formatPreflightReport, parseLegacyMetadata, type HermesPreflightReport } from '../hermes-migration-preflight.contract';
import { parseHermesPreflightArguments, runHermesPreflightMain } from '../hermes-migration-preflight.main';

const cleanReport: HermesPreflightReport = {
  invalidLegacyMetadata: 0,
  duplicateSelections: 0,
  invalidDedicatedCredentials: 0,
  expiryMismatches: 0,
  missingIndexes: 0,
  lockDurationMs: 12,
  checkedAt: '2026-08-09T12:00:00.000Z',
};

describe('Hermes migration preflight contract', () => {
  it('classifies legacy text before exposing parsed metadata', () => {
    expect(parseLegacyMetadata('{"audience":"hermes-negotiator"}')).toEqual({ valid: true });
    expect(parseLegacyMetadata('{broken')).toEqual({ valid: false });
    expect(parseLegacyMetadata('[]')).toEqual({ valid: false });
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
  });

  it('requires JSON output and explicit non-negative duration thresholds', () => {
    expect(parseHermesPreflightArguments([
      '--json', '--max-lock-ms', '5000', '--max-total-ms', '30000',
    ])).toEqual({ json: true, maxLockMs: 5000, maxTotalMs: 30000 });
    expect(() => parseHermesPreflightArguments(['--json'])).toThrow('--max-lock-ms is required');
    expect(() => parseHermesPreflightArguments([
      '--json', '--max-lock-ms', '5000', '--max-total-ms', '-1',
    ])).toThrow('--max-total-ms must be a non-negative finite number');
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
    expect(classification).toContain("WHEN pg_input_is_valid(metadata, 'jsonb')");
    expect(classification).toContain("THEN jsonb_typeof(metadata::jsonb) <> 'object'");
    expect(classification.indexOf('pg_input_is_valid')).toBeLessThan(
      classification.indexOf('metadata::jsonb'),
    );
    expect(classification.match(/metadata::jsonb/g)).toHaveLength(1);
  });

  it('emits the count-only JSON report before failing a dirty preflight', async () => {
    const outputs: string[] = [];
    await expect(runHermesPreflightMain({
      args: ['--json', '--max-lock-ms', '5000', '--max-total-ms', '30000'],
      run: async () => ({ ...cleanReport, invalidLegacyMetadata: 1 }),
      now: (() => {
        const values = [10, 20];
        return () => values.shift()!;
      })(),
      write: (output) => outputs.push(output),
    })).rejects.toThrow('invalid legacy API-key metadata');
    expect(outputs).toEqual([formatPreflightReport({ ...cleanReport, invalidLegacyMetadata: 1 })]);
  });

  it('never includes credential/provider environment names in the provider-free contract', () => {
    const source = `${parseLegacyMetadata}\n${formatPreflightReport}\n${parseHermesPreflightArguments}`;
    expect(source).not.toMatch(/OPENROUTER|API_KEY|DATABASE_URL|idxh_/);
  });
});
