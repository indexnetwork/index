#!/usr/bin/env bun
/**
 * Audit a Railway service's variables against the canonical env reference.
 *
 * Catches "forgot to add it in Railway" before a deploy does: compares the
 * variables configured on a Railway service with (a) the hard-required vars
 * from services/api/src/startup.env.ts and (b) the deployment-recommended
 * vars its collectEnvWarnings() checks.
 *
 * Usage:
 *   bun scripts/audit-railway-env.ts [--service <name>] [--environment <name>]
 *
 * Requires the Railway CLI, authenticated and linked to the project
 * (`railway login`, `railway link`). Pass --service for the API service —
 * the audit is calibrated for it.
 *
 * Exit codes: 0 = no missing required vars, 1 = missing required vars,
 * 2 = could not read Railway variables.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..');
const schemaSource = readFileSync(path.join(repoRoot, 'services/api/src/startup.env.ts'), 'utf8');

// --- Parse the schema -------------------------------------------------------

/** Schema entries: two-space-indented `VAR: <zod chain>,` lines. */
function parseSchemaEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of schemaSource.split('\n')) {
    const match = /^ {2}([A-Z][A-Z0-9_]*): (.+),$/.exec(line);
    if (match) entries.set(match[1], match[2]);
  }
  return entries;
}

/** Vars that make startup fail (or degrade to dev fallbacks) when unset in production. */
function requiredVars(entries: Map<string, string>): string[] {
  const required: string[] = [];
  for (const [name, chain] of entries) {
    if (chain.includes('requiredUnlessTest') || chain.includes('requiredInProduction')) {
      required.push(name);
      continue;
    }
    // Bare validators without .optional()/.default() are hard-required (e.g. DATABASE_URL).
    if (!/optional|default\(/.test(chain)) required.push(name);
  }
  return required.sort();
}

/** Vars collectEnvWarnings() nags about in deployments — recommended, not fatal. */
function recommendedVars(entries: Map<string, string>): string[] {
  const warningsBlock = schemaSource.slice(schemaSource.indexOf('function collectEnvWarnings'));
  const names = new Set<string>();
  for (const match of warningsBlock.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) {
    // Only current schema vars count — skips retired names that appear in
    // rename-warning tables (e.g. the QUESTIONER_ consolidation).
    if (entries.has(match[1])) names.add(match[1]);
  }
  return [...names].sort();
}

// --- Read Railway variables --------------------------------------------------

function railwayVariables(extraArgs: string[]): Record<string, string> {
  const proc = Bun.spawnSync(['railway', 'variables', '--json', ...extraArgs], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (proc.exitCode !== 0) {
    console.error('❌ Could not read Railway variables. Is the Railway CLI installed, logged in, and linked?');
    console.error('   Try: railway login && railway link');
    console.error(proc.stderr.toString().trim());
    process.exit(2);
  }
  return JSON.parse(proc.stdout.toString()) as Record<string, string>;
}

// --- Audit -------------------------------------------------------------------

const args = process.argv.slice(2);
const entries = parseSchemaEntries();
const required = requiredVars(entries);
const recommended = recommendedVars(entries).filter((name) => !required.includes(name));
const railwayVars = railwayVariables(args);

const has = (name: string): boolean => Boolean(railwayVars[name]?.trim());

const missingRequired = required.filter((name) => !has(name));
const missingRecommended = recommended.filter((name) => !has(name));
const unknown = Object.keys(railwayVars)
  .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name))
  .filter((name) => !entries.has(name))
  .filter((name) => !/^RAILWAY_/.test(name))
  .filter((name) => !/^MCP_TOOL_TIMEOUT_[A-Z0-9_]+_MS$/.test(name))
  .filter((name) => !/^MCP_TOOL_MAX_OUTPUT_[A-Z0-9_]+_BYTES$/.test(name))
  .sort();

console.log(`Audited ${Object.keys(railwayVars).length} Railway variables against startup.env.ts\n`);

if (missingRequired.length > 0) {
  console.log('❌ Missing REQUIRED vars (the service will fail to boot or fall back to dev secrets):');
  for (const name of missingRequired) console.log(`   ${name}`);
} else {
  console.log('✅ All required vars are set.');
}

if (missingRecommended.length > 0) {
  console.log('\n⚠️ Missing recommended vars (startup will warn; the related feature is degraded/disabled):');
  for (const name of missingRecommended) console.log(`   ${name}`);
}

if (unknown.length > 0) {
  console.log('\nℹ️ Set on Railway but unknown to the schema (typo? stale? web-only?):');
  for (const name of unknown) console.log(`   ${name}`);
}

process.exit(missingRequired.length > 0 ? 1 : 0);
