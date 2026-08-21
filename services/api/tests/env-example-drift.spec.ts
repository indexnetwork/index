/**
 * Guards against drift between the canonical root `.env.example` and the
 * runtime validation schema in `src/startup.env.ts`.
 *
 * Every schema var must be documented in the example (so nobody discovers a
 * knob only by reading source), and every documented var must be validated
 * (so typos and stale docs fail fast). Web-only VITE_ vars are exempt from
 * schema membership; platform-injected vars are exempt from documentation.
 *
 * Parses both files textually on purpose: importing `startup.env.ts` would
 * run its validation side effects, and text parsing keeps this test working
 * across refactors of either file without import-order coupling.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../../..');
const examplePath = path.join(repoRoot, '.env.example');
const schemaPath = path.resolve(import.meta.dir, '../src/startup.env.ts');

/** Vars validated in the schema but intentionally undocumented in .env.example. */
const PLATFORM_PROVIDED_OR_COMPAT = new Set([
  // Injected by the platform, never set by hand.
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  // Test / local-only compatibility flags accepted by the schema.
  'OPENAI_API_KEY',
  'DEBUG',
  'FORCE_COLOR',
]);

/** Example vars not validated by the API schema. */
const NON_API_PATTERNS: RegExp[] = [
  /^VITE_[A-Z0-9_]+$/, // apps/web build-time vars — not read by the API
];

function exampleVars(): Set<string> {
  const vars = new Set<string>();
  for (const line of readFileSync(examplePath, 'utf8').split('\n')) {
    // Matches both active ("VAR=...") and documented-but-commented ("# VAR=...") entries.
    const match = /^#?\s?([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) vars.add(match[1]);
  }
  return vars;
}

function schemaVars(): Set<string> {
  const vars = new Set<string>();
  for (const line of readFileSync(schemaPath, 'utf8').split('\n')) {
    // Schema entries are two-space-indented keys of the envSchema object.
    const match = /^ {2}([A-Z][A-Z0-9_]*):/.exec(line);
    if (match) vars.add(match[1]);
  }
  return vars;
}

describe('root .env.example ↔ startup.env.ts schema', () => {
  const example = exampleVars();
  const schema = schemaVars();
  const schemaSource = readFileSync(schemaPath, 'utf8');

  it('sanity: parsers found a plausible number of vars', () => {
    expect(example.size).toBeGreaterThan(50);
    expect(schema.size).toBeGreaterThan(50);
  });

  it('every schema var is documented in .env.example', () => {
    const undocumented = [...schema]
      .filter((name) => !example.has(name))
      .filter((name) => !PLATFORM_PROVIDED_OR_COMPAT.has(name))
      .sort();
    expect(
      undocumented,
      `Vars validated in src/startup.env.ts but missing from the root .env.example — document them (or add to PLATFORM_PROVIDED_OR_COMPAT if platform-injected): ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('every .env.example var is validated by the schema', () => {
    const unvalidated = [...example]
      .filter((name) => !schema.has(name))
      .filter((name) => !NON_API_PATTERNS.some((pattern) => pattern.test(name)))
      .sort();
    expect(
      unvalidated,
      `Vars documented in the root .env.example but missing from the envSchema in src/startup.env.ts — add them to the schema (or to NON_API_PATTERNS if not read by the API): ${unvalidated.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps OPPORTUNITY_OWNER_APPROVAL_SECRET optional', () => {
    expect(schemaSource).toContain('OPPORTUNITY_OWNER_APPROVAL_SECRET: z.string().optional()');
    expect(schemaSource).not.toContain('OPPORTUNITY_OWNER_APPROVAL_SECRET: requiredInProduction');
  });
});
