#!/usr/bin/env bun
/**
 * Enforces the capability seams introduced by IND-528.
 *
 * One rule: a capability may reach another capability only through that
 * capability's public module — `capabilities/<name>.ts` for migrated capabilities.
 * Direct implementation imports are prohibited.
 *
 * This replaces the capabilities/*.facade.ts layer, where the contract lived in
 * a separate directory of re-export files — 24 of them, several two lines long,
 * layered over a second per-capability `public/index.ts`. Three hops collapsed
 * to one, and the rule is now checkable by looking at the import path alone.
 *
 * interaction-composition is the one explicit all-capability point: the tool
 * composition root (shared/agent/tool.{registry,factory,helpers}) plus
 * maintenance. It is a composition root rather than a capability with a public
 * surface, so it has no barrel and reaching its implementation is permitted.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

import { ALLOWED_CAPABILITY_DIRECTIONS, barrelCapabilityForSourcePath, barrelPathForCapability, CAPABILITY_BARREL_DIRECTORIES, capabilityForSourcePath, DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES, implementationCapabilityForSourcePath } from "./capability-model.ts";

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
    const barrelTarget = barrelCapabilityForSourcePath(importedPathFromSource);
    const target = barrelTarget ?? directTarget;
    if (!target || target === from) continue;

    // interaction-composition is the composition root, not a capability with a
    // public surface: it has no barrel, so reaching its implementation is the
    // only way to reach it at all.
    const targetHasBarrel = CAPABILITY_BARREL_DIRECTORIES[target] !== undefined;

    if (isRootIndex) {
      if (!barrelTarget && targetHasBarrel) {
        violations.push(
          `${relative(packageRoot, filePath)} exports ${target} implementation directly via ${specifier}; root exports must use the capability barrel ${barrelPathForCapability(target)}`,
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
    if (!barrelTarget && targetHasBarrel && !DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES.has(from!)) {
      violations.push(
        `${relative(packageRoot, filePath)} imports ${target} implementation directly via ${specifier}; import it via ${barrelPathForCapability(target)}`,
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
