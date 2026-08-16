#!/usr/bin/env bun
/**
 * Generates `architecture/exports.snapshot.json` from `src/index.ts`.
 *
 * The inventory records every symbol the package exports, where it comes from,
 * and its stability tier. `scripts/build-protocol-atlas.ts` reads it as the
 * export inventory and fails closed when a selected root export is missing or
 * its source path does not exist — but it only validates the subset listed in
 * ROOT_EXPORT_COMPONENTS. The remaining entries were hand-maintained, which is
 * how 300 of them came to point at directories that had been renamed.
 *
 * Deriving it removes that class of drift: `name`, `kind`, and `source` come
 * from the entry point itself.
 *
 * Stability is the one field that is not mechanical. `src/index.ts` groups its
 * re-exports under banner comments, and a section carrying a standalone
 * `@experimental` line is experimental until the next banner. That matches
 * STABILITY.md and reproduces the committed inventory exactly.
 *
 * Usage:
 *   bun scripts/architecture/export-inventory.ts           # rewrite the snapshot
 *   bun scripts/architecture/export-inventory.ts --check    # report drift, exit 1
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const entryPointPath = resolve(packageRoot, "src/index.ts");
const snapshotPath = resolve(packageRoot, "architecture/exports.snapshot.json");

export interface ExportEntry {
  name: string;
  kind: "value" | "type";
  stability: "stable" | "experimental";
  source: string;
}

export interface ExportInventory {
  schemaVersion: number;
  entryPoint: string;
  exports: ExportEntry[];
}

/**
 * Character ranges of the entry point's experimental sections.
 *
 * Section-scoped tiering keeps the surface reviewable: moving a symbol between
 * tiers is a one-line move in the entry point rather than a per-symbol
 * annotation that can silently disagree with STABILITY.md.
 */
export function experimentalRanges(sourceText: string): Array<[number, number]> {
  // Sections are delimited by the banner comments the entry point already uses
  // ("// ─── Title ───"). A section is experimental when it carries a standalone
  // @experimental line; the next banner ends it.
  //
  // Two things this must not do: match the file header's prose explanation
  // ("Sections marked @experimental below"), which would tier the whole surface
  // experimental; and treat the marker as open-ended, which would wrongly catch
  // the stable sections that follow it.
  const banner = /^[ \t]*\/\/[ \t]*─{2,}/gm;
  const starts: number[] = [];
  for (let m = banner.exec(sourceText); m; m = banner.exec(sourceText)) starts.push(m.index);

  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = starts[i + 1] ?? sourceText.length;
    if (/^[ \t]*\/\/[ \t]*@experimental\b/m.test(sourceText.slice(start, end))) {
      ranges.push([start, end]);
    }
  }
  return ranges;
}

function stabilityAt(offset: number, ranges: Array<[number, number]>): ExportEntry["stability"] {
  return ranges.some(([start, end]) => offset >= start && offset < end) ? "experimental" : "stable";
}

/**
 * Reads every re-exported symbol from an entry point, in declaration order.
 *
 * @param sourceText - Contents of the entry point.
 * @param fileName - Path used for diagnostics only.
 * @returns Entries in the order the entry point declares them.
 */
export function collectExports(sourceText: string, fileName: string): ExportEntry[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const ranges = experimentalRanges(sourceText);
  const entries: ExportEntry[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const { moduleSpecifier, exportClause, isTypeOnly } = statement;
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;
    if (!exportClause || !ts.isNamedExports(exportClause)) continue;

    const stability = stabilityAt(statement.getStart(sourceFile), ranges);

    for (const element of exportClause.elements) {
      entries.push({
        name: element.name.text,
        kind: isTypeOnly || element.isTypeOnly ? "type" : "value",
        stability,
        source: moduleSpecifier.text,
      });
    }
  }

  return entries;
}

function buildInventory(): ExportInventory {
  return {
    schemaVersion: 1,
    entryPoint: "src/index.ts",
    exports: collectExports(readFileSync(entryPointPath, "utf8"), entryPointPath),
  };
}

function serialize(inventory: ExportInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const generated = serialize(buildInventory());
  const committed = readFileSync(snapshotPath, "utf8");

  if (generated === committed) {
    const count = buildInventory().exports.length;
    console.log(`exports.snapshot.json matches src/index.ts (${count} exports).`);
    return;
  }

  if (checkOnly) {
    const before = JSON.parse(committed) as ExportInventory;
    const after = JSON.parse(generated) as ExportInventory;
    const key = (entry: ExportEntry) => `${entry.name}|${entry.kind}|${entry.stability}|${entry.source}`;
    const beforeKeys = new Set(before.exports.map(key));
    const afterKeys = new Set(after.exports.map(key));
    for (const entry of after.exports) {
      if (!beforeKeys.has(key(entry))) console.log(`  + ${key(entry)}`);
    }
    for (const entry of before.exports) {
      if (!afterKeys.has(key(entry))) console.log(`  - ${key(entry)}`);
    }
    console.error(
      '\nexports.snapshot.json is stale. Run "bun run architecture:exports" and commit the result.',
    );
    process.exit(1);
  }

  writeFileSync(snapshotPath, generated);
  console.log(`Regenerated exports.snapshot.json (${buildInventory().exports.length} exports).`);
}

if (import.meta.main) main();
