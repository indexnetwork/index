/**
 * Shared module-reference extraction for the architecture checks.
 *
 * Two different questions get asked of the same import statements, and they
 * need different answers:
 *
 * - **Direction** (capability boundaries, host isolation): a `import type`
 *   still declares that one module is designed against another, so type edges
 *   count. Those checks keep using their own all-edges collection.
 * - **Cycles**: a cycle is only a hazard if it survives to runtime (module
 *   initialization order, TDZ, bundler ordering). TypeScript erases type-only
 *   imports entirely, so a loop that closes through one cannot exist in the
 *   emitted graph. Counting them reports cycles that no runtime can observe —
 *   and it penalizes exactly the capability-facade pattern this package is
 *   built on, where a module depends on a port *type* instead of an
 *   implementation.
 *
 * `runtimeModuleSpecifiers` answers the second question.
 */
import ts from "typescript";

/**
 * True when a module reference is erased by the TypeScript emit and therefore
 * cannot participate in a runtime cycle.
 *
 * Covers all three erased forms:
 * - `import type { T } from "./m.js"` / `export type { T } from "./m.js"`
 * - `import { type A, type B } from "./m.js"` (every binding type-only)
 * - `export { type A } from "./m.js"` (every binding type-only)
 *
 * A bare `import "./m.js"` is a side-effect import and is never type-only. A
 * mixed `import { type A, b }` keeps a runtime edge because `b` survives emit.
 */
export function isErasedModuleReference(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false; // side-effect import: `import "./m.js"`
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    if (clause.name || !bindings || !ts.isNamedImports(bindings)) return false;
    return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
  }

  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

/**
 * Module specifiers that survive the TypeScript emit — the edges of the runtime
 * module graph. Type-only imports/exports and `import("./m.js").T` type nodes
 * are excluded because they leave no trace in the emitted JavaScript.
 */
export function runtimeModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && !isErasedModuleReference(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    // `import("./m.js").T` is a type position only; it never emits a require.
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/** Parse helper so callers and tests build source files the same way. */
export function parseSourceFile(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}
