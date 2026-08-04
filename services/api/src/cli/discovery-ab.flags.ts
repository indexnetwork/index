/**
 * The only environment flags this harness may offer: those the discovery graph
 * actually reads. The list is asserted against a fresh scan of the graph's
 * import closure (discovery-ab.flags.spec.ts) rather than trusted, because a
 * hand-maintained copy is exactly how sixteen editable flags came to move
 * nothing at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const AB_FLAGS: readonly string[] = [
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_CONTEXT_TO_INTENT',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS',
  'DISCOVERY_SOURCE_PREMISE_LIMIT',
  'NEGOTIATION_INCLUDE_OTHER_INTENTS',
  'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT',
  'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
];

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

/** Every candidate key mentioned anywhere in the entry file's transitive import closure. */
export function reachableEnvKeys(entryFile: string, candidateKeys: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [path.resolve(entryFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const key of candidateKeys) if (source.includes(key)) found.add(key);
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
