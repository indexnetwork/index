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
 * Drops comments (and type-only imports) by running the file through Bun's own
 * TypeScript parser, so a commented-out read cannot pass for a live one.
 *
 * A hand-rolled stripper was tried first and was unsound: it tracked string
 * state character by character and desynced on the `'` inside the regex literal
 * at `opportunity.presentation.ts:160`, leaving hundreds of lines in four
 * closure files un-stripped. The dangerous direction there is *silent* — a
 * commented-out `process.env.SOME_FLAG` on an un-stripped line counts as a real
 * read and the derivation test stays green on fiction. Only a real parser gets
 * regex literals, nested quotes and template substitutions right.
 *
 * Falls back to the raw source if the transform throws, so an unparseable file
 * still contributes its reads and imports rather than vanishing from the scan.
 *
 * One quirk to know: the transpiler constant-folds `process.env.NODE_ENV`, so
 * that one key would never be seen as a read. It is not in the profile
 * allowlist, so nothing here depends on it — but do not add it.
 */
function parseAwayComments(transpiler: Bun.Transpiler, source: string): string {
  try {
    return transpiler.transformSync(source);
  } catch {
    return source;
  }
}

/**
 * Matches an actual read of `key` from the environment. Recognised forms are
 * exactly: `process.env.KEY`, `process.env?.KEY`, `process.env['KEY']`,
 * `process.env["KEY"]`, `` process.env[`KEY`] `` and their `process.env?.[...]`
 * variants. Nothing else counts — a plain substring match would treat a comment
 * or a log message as a read (the graph names several of these flags in both),
 * so deleting the last real read would leave the flag in `AB_FLAGS` as fiction
 * with every test still green.
 *
 * Deliberately *not* recognised, because they need real data-flow analysis:
 * destructuring (`const { KEY } = process.env`) and computed access through a
 * variable (`process.env[name]`). Both fail in the loud direction — the key
 * drops out of the derived set and the derivation test breaks — so a future
 * read written that way announces itself instead of passing silently.
 */
function envReadPattern(key: string): RegExp {
  const escaped = key.replace(/[^A-Za-z0-9_]/g, '\\$&');
  return new RegExp(
    `process\\.env(?:\\??\\.${escaped}\\b|(?:\\?\\.)?\\[\\s*(['"\`])${escaped}\\1\\s*\\])`,
  );
}

/**
 * Every candidate key actually read from `process.env` somewhere in the entry
 * file's transitive import closure.
 *
 * The closure is walked over transpiled output, and the only edges that erasure
 * removes are `import type`, `export type` and inline `import('...').T` — all
 * 154 elided edges in today's closure were of exactly that shape, and value
 * imports (including unused bindings and bare `import './x.js'`) survive
 * verbatim. That is precisely what the runtime erases too, so a module reached
 * only through a type-only import genuinely never loads and genuinely never
 * reads anything.
 *
 * So the failure direction is under-offering, never fiction: if a listed flag's
 * read becomes unreachable the derived set shrinks and the derivation test
 * fails loudly (verified by retyping the `discovery.env.js` import as
 * `import type` — two flags dropped, suite red).
 *
 * Two narrow holes remain, both with zero occurrences in the closure today:
 * Bun preserves legal comments — a `//!` or `/*!` banner survives and would
 * match the read pattern, though an `@license` block comment is stripped — and
 * a string or template literal spelling out `process.env.SOME_KEY` counts as a
 * read.
 */
export function reachableEnvKeys(entryFile: string, candidateKeys: readonly string[]): Set<string> {
  const patterns = candidateKeys.map((key) => [key, envReadPattern(key)] as const);
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [path.resolve(entryFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = parseAwayComments(transpiler, readFileSync(file, 'utf8'));
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
