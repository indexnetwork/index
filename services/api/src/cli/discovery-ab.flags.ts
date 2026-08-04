/**
 * The only environment flags this harness may offer: those the discovery graph
 * actually reads. The list is asserted against a fresh scan of the graph's
 * import closure (discovery-ab.flags.spec.ts) rather than trusted, because a
 * hand-maintained copy is exactly how sixteen editable flags came to move
 * nothing at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const AB_FLAGS: readonly string[] = Object.freeze([
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_CONTEXT_TO_INTENT',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS',
  'DISCOVERY_SOURCE_PREMISE_LIMIT',
  'NEGOTIATION_INCLUDE_OTHER_INTENTS',
  'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT',
  'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
]);

export type AbEnvConfig = Readonly<Record<string, string>>;

/** Resolves a relative TypeScript import specifier the way Bun does for these modules. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier).replace(/\.js$/, '.ts');
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Removes comments so a commented-out read cannot pass for a live one. Quotes
 * and template literals are honoured; regular-expression literals are not
 * parsed, which at worst hides a real read behind a `//` inside a regex and so
 * fails the derivation test loudly rather than passing it silently.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
    if (ch !== '"' && ch !== "'" && ch !== '`') continue;
    while (i < source.length) {
      const inner = source[i]!;
      out += inner;
      i += 1;
      if (inner === '\\' && i < source.length) {
        out += source[i];
        i += 1;
        continue;
      }
      if (inner === ch) break;
    }
  }
  return out;
}

/**
 * Matches an actual read of `key` from the environment — `process.env.KEY`,
 * `process.env['KEY']` or `process.env["KEY"]` — and nothing else. A plain
 * substring match would count a comment or a log message as a read (the graph
 * names several of these flags in both), so deleting the last real read would
 * leave the flag in `AB_FLAGS` as fiction with every test still green.
 */
function envReadPattern(key: string): RegExp {
  const escaped = key.replace(/[^A-Za-z0-9_]/g, '\\$&');
  return new RegExp(`process\\.env(?:\\.${escaped}\\b|\\[\\s*(['"\`])${escaped}\\1\\s*\\])`);
}

/** Every candidate key actually read from `process.env` somewhere in the entry file's transitive import closure. */
export function reachableEnvKeys(entryFile: string, candidateKeys: readonly string[]): Set<string> {
  const patterns = candidateKeys.map((key) => [key, envReadPattern(key)] as const);
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [path.resolve(entryFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const [key, pattern] of patterns) if (pattern.test(source)) found.add(key);
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const resolved = resolveSpecifier(file, match[1]!);
      if (resolved !== null) stack.push(resolved);
    }
  }
  return found;
}

/** Throws when a config names a flag this harness cannot honestly exercise. */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!AB_FLAGS.includes(key)) {
      throw new Error(`${key} is not readable by the discovery graph; this harness cannot test it`);
    }
    if (value.trim() === '') {
      throw new Error(`${key} has an empty value; unset it instead of blanking it`);
    }
  }
}
