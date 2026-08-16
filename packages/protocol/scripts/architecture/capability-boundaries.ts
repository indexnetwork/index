#!/usr/bin/env bun
/**
 * Enforces the in-place capability seams introduced by IND-528.
 *
 * A capability may depend on another capability only via a narrowly named
 * facade in src/capabilities; direct implementation imports are prohibited.
 * interaction-composition is the one explicit place where all capabilities
 * meet: the tool composition root (shared/agent/tool.{registry,factory,helpers})
 * plus maintenance.
 *
 * The IND-543 outer shells (runtime/foreground, runtime/background, platform,
 * public) were declaration-only placeholders that nothing imported. They have
 * been removed along with their capability classifications; the composition
 * root now lives at the path its 25 importers already used.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

import { ALLOWED_CAPABILITY_DIRECTIONS, capabilityForSourcePath, DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES, facadeCapabilityForSourcePath, implementationCapabilityForSourcePath } from "./capability-model.ts";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const sourceRoot = resolve(packageRoot, "src");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry);
    const entryStat = await stat(path);
    if (entryStat.isDirectory()) {
      if (entry !== "tests") files.push(...await sourceFiles(path));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts") && !entry.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

function importSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveImport(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(importer), specifier.replace(/\.js$/, ""));
  const candidates = [`${base}.ts`, resolve(base, "index.ts")];
  return candidates.find((candidate) => Bun.file(candidate).size > 0);
}

const violations: string[] = [];
for (const filePath of await sourceFiles(sourceRoot)) {
  const pathFromSource = relative(sourceRoot, filePath);
  const from = capabilityForSourcePath(pathFromSource);
  const isRootIndex = pathFromSource.replace(/\\/g, "/") === "index.ts";
  if (!from && !isRootIndex) continue;

  const sourceFile = ts.createSourceFile(
    filePath,
    await readFile(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  for (const specifier of importSpecifiers(sourceFile)) {
    const importedPath = resolveImport(filePath, specifier);
    if (!importedPath) continue;
    const importedPathFromSource = relative(sourceRoot, importedPath);
    const directTarget = implementationCapabilityForSourcePath(importedPathFromSource);
    const facadeTarget = facadeCapabilityForSourcePath(importedPathFromSource);
    const target = facadeTarget ?? directTarget;
    if (!target || target === from) continue;

    if (isRootIndex) {
      if (!facadeTarget) {
        violations.push(
          `${relative(packageRoot, filePath)} exports ${target} implementation directly via ${specifier}; root exports must use a capability facade`,
        );
      }
      continue;
    }

    if (!ALLOWED_CAPABILITY_DIRECTIONS[from!].includes(target)) {
      violations.push(
        `${relative(packageRoot, filePath)} uses forbidden ${from} → ${target} direction via ${specifier}`,
      );
      continue;
    }
    if (!facadeTarget && !DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES.has(from!)) {
      violations.push(
        `${relative(packageRoot, filePath)} imports ${target} implementation directly via ${specifier}; use its capabilities/*.facade.ts contract`,
      );
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Capability boundary violations:\n${violations.map((entry) => `- ${entry}`).join("\n")}`,
  );
}

const directions = Object.entries(ALLOWED_CAPABILITY_DIRECTIONS).flatMap(([from, targets]) =>
  targets.map((to) => `${from} → ${to}`),
);
console.log(
  `Capability boundaries OK (${directions.length} named directions: ${directions.join("; ")}).`,
);
