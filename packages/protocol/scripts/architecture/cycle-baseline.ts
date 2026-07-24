#!/usr/bin/env bun
/**
 * Records the audit's cycle baseline and prevents a new cyclic component.
 * Existing components may shrink as Phase 3 removes edges, but a component may
 * never extend outside an audited component or add a third component.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

type CycleBaseline = {
  schemaVersion: 1;
  auditedReportedCircularPaths: 18;
  auditedCyclicStronglyConnectedComponents: 2;
  source: "docs/design/protocol-package-audit.html";
  components: string[][];
};

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const sourceRoot = resolve(packageRoot, "src");
const baselinePath = resolve(packageRoot, "architecture/cycles.baseline.json");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry);
    const entryStat = await stat(path);
    if (entryStat.isDirectory()) {
      // Capability facades are contract edges, not implementation vertices. The
      // resolver below expands them back to their owned implementation modules
      // so Phase 1 seams cannot make the audited SCCs appear to grow or vanish.
      if (entry !== "tests" && entry !== "capabilities") files.push(...await sourceFiles(path));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts") && !entry.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

function toModuleId(path: string): string {
  return relative(sourceRoot, path).replace(/\\/g, "/");
}

function resolveImportPath(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  const candidates = [`${base}.ts`, resolve(base, "index.ts")];
  return candidates.find((path) => Bun.file(path).size > 0);
}

function importSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function cyclicComponents(graph: Map<string, Set<string>>): string[][] {
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  const visit = (node: string) => {
    indexes.set(node, index);
    lowLinks.set(node, index++);
    stack.push(node);
    active.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(next)!));
      } else if (active.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indexes.get(next)!));
      }
    }
    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    let next: string;
    do {
      next = stack.pop()!;
      active.delete(next);
      component.push(next);
    } while (next !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) components.push(component.sort());
  };

  for (const node of [...graph.keys()].sort()) if (!indexes.has(node)) visit(node);
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

const files = await sourceFiles(sourceRoot);
const modules = new Set(files.map(toModuleId));
const graph = new Map<string, Set<string>>();
const facadeTargets = new Map<string, Promise<string[]>>();

async function resolveImport(from: string, specifier: string): Promise<string[]> {
  const candidate = resolveImportPath(from, specifier);
  if (!candidate) return [];
  const moduleId = toModuleId(candidate);
  if (modules.has(moduleId)) return [moduleId];
  if (!moduleId.startsWith("capabilities/")) return [];

  let targets = facadeTargets.get(candidate);
  if (!targets) {
    targets = (async () => {
      const facade = ts.createSourceFile(candidate, await readFile(candidate, "utf8"), ts.ScriptTarget.Latest, true);
      const imports = await Promise.all(importSpecifiers(facade).map((nested) => resolveImport(candidate, nested)));
      return imports.flat();
    })();
    facadeTargets.set(candidate, targets);
  }
  return targets;
}

for (const filePath of files) {
  const sourceFile = ts.createSourceFile(filePath, await readFile(filePath, "utf8"), ts.ScriptTarget.Latest, true);
  const imports = await Promise.all(importSpecifiers(sourceFile).map((specifier) => resolveImport(filePath, specifier)));
  graph.set(toModuleId(filePath), new Set(imports.flat()));
}
const components = cyclicComponents(graph);
const expected: CycleBaseline = {
  schemaVersion: 1,
  auditedReportedCircularPaths: 18,
  auditedCyclicStronglyConnectedComponents: 2,
  source: "docs/design/protocol-package-audit.html",
  components,
};

if (process.argv.includes("--write")) {
  await Bun.write(baselinePath, JSON.stringify(expected, null, 2) + "\n");
  console.log(`Updated cycle baseline (${components.length} cyclic SCCs).`);
  process.exit(0);
}

const baseline = await Bun.file(baselinePath).json() as CycleBaseline;
if (baseline.auditedReportedCircularPaths !== 18 || baseline.auditedCyclicStronglyConnectedComponents !== 2) {
  throw new Error("Cycle baseline must retain the audited 18-path / 2-SCC record until Phase 3.");
}
if (components.length > baseline.auditedCyclicStronglyConnectedComponents) {
  throw new Error(`Cycle regression: found ${components.length} cyclic SCCs; audit permits at most ${baseline.auditedCyclicStronglyConnectedComponents}.`);
}
for (const component of components) {
  if (!baseline.components.some((audited) => component.every((member) => audited.includes(member)))) {
    throw new Error(`Cycle regression: new cyclic component: ${component.join(", ")}`);
  }
}
console.log(`Cycle baseline OK (${baseline.auditedReportedCircularPaths} audited paths; ${components.length}/${baseline.auditedCyclicStronglyConnectedComponents} cyclic SCCs).`);
