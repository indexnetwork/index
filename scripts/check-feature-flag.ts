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

/** Matches `FLAG=value`, with or without a leading comment marker. */
function envEntry(text: string, flag: string): string | null {
  const active = new RegExp(`^\\s*${flag}=(.*)$`, 'm').exec(text);
  if (active) return `${active[1].trim() || '<empty>'}`;
  const commented = new RegExp(`^\\s*#\\s*${flag}=(.*)$`, 'm').exec(text);
  if (commented) return `commented: ${commented[1].trim() || '<empty>'}`;
  return null;
}

const SURFACES: Surface[] = [
  {
    label: 'startup.env.ts',
    path: join(ROOT, 'services/api/src/startup.env.ts'),
    required: true,
    find: (text, flag) => {
      const match = new RegExp(`^\\s*${flag}:\\s*(.+?),?\\s*$`, 'm').exec(text);
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

const flags = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (flags.length === 0) {
  console.error('usage: bun run check:flags FLAG_NAME [FLAG_NAME...]');
  process.exit(2);
}

const allClean = flags.map(report).every(Boolean);
console.log('');
process.exit(allClean ? 0 : 1);
