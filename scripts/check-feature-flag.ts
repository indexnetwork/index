#!/usr/bin/env bun
/**
 * check-feature-flag — report a feature flag's state on every tracked env surface.
 *
 *   bun run check:flags FLAG_NAME [FLAG_NAME...]
 *
 * Covers the local surfaces documented in docs/guides/feature-flags.md: the zod/accessor
 * registration (`services/api/src/startup.env.ts` for api-side flags, a
 * `packages/protocol/src/**\/*.env.ts` accessor for protocol-side ones), the commented
 * `.env.example` entry, the `.env.development` mirror of Railway dev, and the
 * conditional `.env.test`.
 *
 * Railway's live value is not readable from here — pair this with
 * railway_list_variables({ service_id: "protocol", environment_id: "dev" }).
 *
 * Exits non-zero when a flag is missing a surface it is required to have, so this
 * can gate a feature PR.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

/** A flag name is a literal, never a pattern — `check:flags 'FOO_.*'` must not glob. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `.env.example` documents most flags as `# FLAG=off   # what it does`. The trailing
 * comment is prose, not part of the value.
 */
export function stripInlineComment(raw: string): string {
  return raw.replace(/\s+#.*$/, '');
}

/**
 * Feature-flag values are short enums (`on`, `off`, `shadow`, `2`). Anything else is
 * almost certainly not a flag — most importantly a `DATABASE_URL`-style connection
 * string carrying a live password. This output is read by agents and lands in
 * transcripts, PR bodies, and CI logs, so print only what is provably safe.
 */
export function maskValue(raw: string): string {
  const value = raw.trim();
  if (value === '') return '<empty>';
  if (/^[A-Za-z0-9_-]{1,24}$/.test(value)) return value;
  return `<redacted: ${value.length} chars — not a flag-shaped value>`;
}

/** Matches `FLAG=value`, with or without a leading comment marker. */
export function envEntry(text: string, flag: string): string | null {
  const name = escapeForRegExp(flag);
  const active = new RegExp(`^[ \\t]*${name}=(.*)$`, 'm').exec(text);
  if (active) return maskValue(stripInlineComment(active[1]));
  const commented = new RegExp(`^[ \\t]*#[ \\t]*${name}=(.*)$`, 'm').exec(text);
  if (commented) return `commented: ${maskValue(stripInlineComment(commented[1]))}`;
  return null;
}

/** The zod line in startup.env.ts, or null. Schemas are safe to print verbatim. */
export function zodRegistration(text: string, flag: string): string | null {
  const match = new RegExp(`^[ \\t]*${escapeForRegExp(flag)}:\\s*(.+?),?\\s*$`, 'm').exec(text);
  return match ? match[1].replace(/,$/, '') : null;
}

/** True when a protocol accessor module reads the flag off `process.env`. */
export function readsProcessEnv(text: string, flag: string): boolean {
  return new RegExp(`process\\.env(?:\\.${escapeForRegExp(flag)}\\b|\\[['"\`]${escapeForRegExp(flag)}['"\`]\\])`).test(text);
}

function protocolAccessorFiles(): string[] {
  try {
    return [...new Bun.Glob('packages/protocol/src/**/*.env.ts').scanSync(ROOT)].sort();
  } catch {
    return [];
  }
}

type Registration = { label: string; detail: string };

/**
 * A flag is registered either api-side (zod in startup.env.ts) or protocol-side (an
 * accessor module reading process.env). Requiring startup.env.ts unconditionally
 * reports every protocol-side flag as drift.
 */
function findRegistrations(flag: string): Registration[] {
  const found: Registration[] = [];

  const startup = join(ROOT, 'services/api/src/startup.env.ts');
  if (existsSync(startup)) {
    const schema = zodRegistration(readFileSync(startup, 'utf8'), flag);
    if (schema) found.push({ label: 'startup.env.ts', detail: schema });
  }

  for (const file of protocolAccessorFiles()) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    if (readsProcessEnv(readFileSync(path, 'utf8'), flag)) {
      found.push({ label: relative(ROOT, path), detail: 'reads process.env' });
    }
  }

  return found;
}

type EnvSurface = { label: string; path: string; required: boolean };

const ENV_SURFACES: EnvSurface[] = [
  { label: '.env.example', path: join(ROOT, '.env.example'), required: true },
  { label: '.env.development', path: join(ROOT, '.env.development'), required: false },
  { label: '.env.test', path: join(ROOT, '.env.test'), required: false },
];

function report(flag: string): boolean {
  console.log(`\n${flag}`);
  const problems: string[] = [];

  const registrations = findRegistrations(flag);
  if (registrations.length === 0) {
    console.log(`  ${'registration'.padEnd(18)} — absent`);
    problems.push(
      'not registered in startup.env.ts or any packages/protocol/src/**/*.env.ts accessor',
    );
  }
  for (const registration of registrations) {
    console.log(`  ${registration.label.padEnd(18)} ${registration.detail}`);
  }

  const found = new Map<string, string | null>();
  for (const surface of ENV_SURFACES) {
    if (!existsSync(surface.path)) {
      console.log(`  ${surface.label.padEnd(18)} — file absent (untracked, expected locally only)`);
      found.set(surface.label, null);
      continue;
    }
    const value = envEntry(readFileSync(surface.path, 'utf8'), flag);
    found.set(surface.label, value);
    console.log(`  ${surface.label.padEnd(18)} ${value ?? '— absent'}`);
    if (surface.required && !value) {
      problems.push(`missing from ${surface.label} (a feature PR must document it there)`);
    }
  }

  const example = found.get('.env.example');
  if (example && !example.startsWith('commented:')) {
    problems.push('.env.example carries an active value — it must ship commented out and default off');
  }

  const local = found.get('.env.development');
  if (local && !local.startsWith('commented:')) {
    console.log(
      `  ${'note'.padEnd(18)} Railway dev must carry the same value — verify with ` +
        `railway_list_variables({service_id:"protocol", environment_id:"dev"})`,
    );
  }

  for (const problem of problems) console.log(`  ${'DRIFT'.padEnd(18)} ${problem}`);
  return problems.length === 0;
}

export function main(argv = process.argv.slice(2)): void {
  const flags = argv.filter((arg) => !arg.startsWith('-'));
  if (flags.length === 0) {
    console.error('usage: bun run check:flags FLAG_NAME [FLAG_NAME...]');
    process.exit(2);
  }

  const allClean = flags.map(report).every(Boolean);
  console.log('');
  process.exit(allClean ? 0 : 1);
}

if (import.meta.main) main();
