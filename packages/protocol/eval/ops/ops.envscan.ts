/**
 * Derives, from the code itself, which environment variables a given entry
 * point can actually read.
 *
 * This is the machinery behind `ops.envcatalog.ts`. It exists because a
 * hand-maintained list of "flags you may configure" is precisely how sixteen
 * editable flags came to move nothing at all: the list was believed, the code
 * was never asked. Everything offered to an operator is now answered by a scan
 * of the code that would have to read it.
 *
 * **Not importable by the browser app.** This module uses `node:fs` and
 * `Bun.Transpiler`, so the Vite bundle cannot have it. The generated catalogue
 * it produces (`ops.envcatalog.ts`) is dependency-free and is what the app
 * imports. Keep that split: it is the same constraint `ops.allowlist.ts`
 * documents for itself.
 *
 * Moved here from services/api/src/cli/discovery.flags.ts, which derived one
 * harness's flags this way. It lives in packages/protocol now because the
 * catalogue covers every harness, and because the dependency direction only
 * permits it here: services/api depends on packages/protocol, never the
 * reverse.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Resolves a relative TypeScript import specifier the way Bun does for these modules. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier).replace(/\.js$/, ".ts");
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) return candidate;
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
 * that one key would never be seen as a read. It is not offerable anyway
 * (`ops.allowlist.ts` explains why NODE_ENV must never be settable), so nothing
 * here depends on it — but do not add it.
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
 * or a log message as a read (the discovery graph names several of these flags
 * in both), so deleting the last real read would leave the flag in the
 * catalogue as fiction with every test still green.
 *
 * Deliberately *not* recognised, because they need real data-flow analysis:
 * destructuring (`const { KEY } = process.env`) and computed access through a
 * variable (`process.env[name]`). Both fail in the loud direction — the key
 * drops out of the derived set and the drift test breaks — so a future read
 * written that way announces itself instead of passing silently.
 */
function envReadPattern(key: string): RegExp {
  const escaped = key.replace(/[^A-Za-z0-9_]/g, "\\$&");
  return new RegExp(
    `process\\.env(?:\\??\\.${escaped}\\b|(?:\\?\\.)?\\[\\s*(['"\`])${escaped}\\1\\s*\\])`,
  );
}

/**
 * Every distinct environment key named anywhere under the given roots.
 *
 * The candidate universe for a scan, derived rather than hardcoded: a
 * hardcoded universe caps what the scan can find, which is the exact failure
 * this whole module exists to undo. The nine flags the site offered for
 * discovery were not what the graph reads — they were the intersection of what
 * the graph reads with a sixteen-key list somebody typed.
 *
 * This is a *superset* pass: it collects keys named in any position, comments
 * included, because a candidate that turns out not to be read is discarded by
 * `reachableEnvKeys` anyway. Over-collecting here is free; under-collecting is
 * the bug.
 */
export function referencedEnvKeys(roots: readonly string[]): Set<string> {
  const keys = new Set<string>();
  const stack = roots.map((root) => path.resolve(root));
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    if (statSync(current).isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        stack.push(path.join(current, entry));
      }
      continue;
    }
    if (!current.endsWith(".ts") && !current.endsWith(".tsx")) continue;
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(
      /process\.env(?:\??\.([A-Z][A-Z0-9_]*)\b|(?:\?\.)?\[\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\])/g,
    )) {
      const key = match[1] ?? match[2];
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/**
 * Every candidate key actually read from `process.env` somewhere in the entry
 * file's transitive import closure.
 *
 * The closure is walked over transpiled output, and the only edges that erasure
 * removes are `import type`, `export type` and inline `import('...').T` — all
 * 154 elided edges in the discovery closure were of exactly that shape, and
 * value imports (including unused bindings and bare `import './x.js'`) survive
 * verbatim. That is precisely what the runtime erases too, so a module reached
 * only through a type-only import genuinely never loads and genuinely never
 * reads anything.
 *
 * So the failure direction is under-offering, never fiction: if a listed flag's
 * read becomes unreachable the derived set shrinks and the drift test fails
 * loudly (verified by retyping the `discovery.env.js` import as `import type` —
 * two flags dropped, suite red).
 *
 * Two narrow holes remain, both with zero occurrences in today's closures:
 * Bun preserves legal comments — a `//!` or `/*!` banner survives and would
 * match the read pattern, though an `@license` block comment is stripped — and
 * a string or template literal spelling out `process.env.SOME_KEY` counts as a
 * read.
 */
export function reachableEnvKeys(entryFile: string, candidateKeys: readonly string[]): Set<string> {
  const patterns = candidateKeys.map((key) => [key, envReadPattern(key)] as const);
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [path.resolve(entryFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = parseAwayComments(transpiler, readFileSync(file, "utf8"));
    for (const [key, pattern] of patterns) if (pattern.test(source)) found.add(key);
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const resolved = resolveSpecifier(file, match[1]!);
      if (resolved !== null) stack.push(resolved);
    }
  }
  return found;
}
