#!/usr/bin/env bun
/**
 * check-feature-flag — report a feature flag's state on every tracked env surface.
 *
 *   bun run check:flags FLAG_NAME [FLAG_NAME...]
 *
 * Covers the four local surfaces documented in docs/guides/feature-flags.md:
 * startup.env.ts (zod registration), .env.example (commented default-off entry),
 * .env.development (local mirror of Railway dev), and the conditional .env.test.
 *
 * Railway's live value is not readable from here — pair this with
 * railway_list_variables({ service_id: "protocol", environment_id: "dev" }).
 *
 * Exits non-zero when a flag is missing a surface it is required to have, so this
 * can gate a feature PR.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

type Surface = {
  label: string;
  path: string;
  /** A feature PR must ship the flag on this surface. */
  required: boolean;
  find: (text: string, flag: string) => string | null;
};

/** A flag name is a literal, never a pattern — `check:flags 'FOO_.*'` must not glob. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (active) return maskValue(active[1]);
  const commented = new RegExp(`^[ \\t]*#[ \\t]*${name}=(.*)$`, 'm').exec(text);
  if (commented) return `commented: ${maskValue(commented[1])}`;
  return null;
}

const SURFACES: Surface[] = [
  {
    label: 'startup.env.ts',
    path: join(ROOT, 'services/api/src/startup.env.ts'),
    required: true,
    find: (text, flag) => {
      // A zod schema, not a value — safe to print verbatim.
      const match = new RegExp(`^[ \\t]*${escapeForRegExp(flag)}:\\s*(.+?),?\\s*$`, 'm').exec(text);
      return match ? match[1].replace(/,$/, '') : null;
    },
  },
  { label: '.env.example', path: join(ROOT, '.env.example'), required: true, find: envEntry },
  { label: '.env.development', path: join(ROOT, '.env.development'), required: false, find: envEntry },
  { label: '.env.test', path: join(ROOT, '.env.test'), required: false, find: envEntry },
];

function report(flag: string): boolean {
  console.log(`\n${flag}`);
  const found = new Map<string, string | null>();

  for (const surface of SURFACES) {
    if (!existsSync(surface.path)) {
      console.log(`  ${surface.label.padEnd(18)} — file absent (untracked, expected locally only)`);
      found.set(surface.label, null);
      continue;
    }
    const value = surface.find(readFileSync(surface.path, 'utf8'), flag);
    found.set(surface.label, value);
    console.log(`  ${surface.label.padEnd(18)} ${value ?? '— absent'}`);
  }

  const problems: string[] = [];
  for (const surface of SURFACES) {
    if (surface.required && !found.get(surface.label)) {
      problems.push(`missing from ${surface.label} (a feature PR must register it there)`);
    }
  }

  const example = found.get('.env.example');
  if (example && !example.startsWith('commented:')) {
    problems.push('.env.example carries an active value — it must ship commented out and default off');
  }

  const local = found.get('.env.development');
  if (local && !local.startsWith('commented:')) {
    console.log(
      `  note                Railway dev must carry the same value — verify with ` +
        `railway_list_variables({service_id:"protocol", environment_id:"dev"})`,
    );
  }

  for (const problem of problems) console.log(`  DRIFT              ${problem}`);
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
