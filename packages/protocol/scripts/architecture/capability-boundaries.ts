#!/usr/bin/env bun
/**
 * Enforces the in-place capability seams introduced by IND-528.
 *
 * The implementation directories intentionally remain where they are until
 * Phase 3. A capability may therefore depend on another capability only via a
 * narrowly named facade in src/capabilities; direct implementation imports are
 * prohibited. The interaction-composition facade is the one explicit place
 * where all capabilities meet.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

type Capability =
  | "signals"
  | "participant-context"
  | "communities"
  | "opportunities"
  | "negotiation"
  | "questions"
  | "participant-agents"
  | "contacts"
  | "integrations"
  | "interaction-composition";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const sourceRoot = resolve(packageRoot, "src");

const capabilityDirectories: Readonly<Record<string, Capability>> = {
  intent: "signals",
  enrichment: "participant-context",
  premise: "participant-context",
  context: "participant-context",
  network: "communities",
  opportunity: "opportunities",
  negotiation: "negotiation",
  questioner: "questions",
  chat: "participant-agents",
  agent: "participant-agents",
  contact: "contacts",
  integration: "integrations",
  maintenance: "interaction-composition",
};

/** Every permitted direction is deliberately named and reviewed here. */
const allowedDirections: Readonly<Record<Capability, readonly Capability[]>> = {
  signals: ["participant-agents", "questions"],
  "participant-context": ["participant-agents", "questions"],
  communities: ["participant-agents", "signals"],
  opportunities: ["participant-agents", "signals", "negotiation", "questions"],
  negotiation: ["opportunities", "questions"],
  questions: ["negotiation"],
  "participant-agents": ["negotiation"],
  contacts: ["opportunities"],
  integrations: [],
  "interaction-composition": [
    "signals",
    "participant-context",
    "communities",
    "opportunities",
    "negotiation",
    "questions",
    "participant-agents",
    "contacts",
    "integrations",
  ],
};

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

function sourceCapability(path: string): Capability | undefined {
  const pathFromSource = relative(sourceRoot, path).replace(/\\/g, "/");
  const topLevel = pathFromSource.split("/")[0];
  if (topLevel === "capabilities") return facadeCapability(path);
  if (topLevel === "shared" && /^shared\/agent\/tool\.(?:factory|registry|helpers)\.ts$/.test(pathFromSource)) {
    return "interaction-composition";
  }
  return capabilityDirectories[topLevel];
}

function implementationCapability(path: string): Capability | undefined {
  const topLevel = relative(sourceRoot, path).replace(/\\/g, "/").split("/")[0];
  return capabilityDirectories[topLevel];
}

function facadeCapability(path: string): Capability | undefined {
  const pathFromSource = relative(sourceRoot, path).replace(/\\/g, "/");
  const match = /^capabilities\/([a-z-]+)(?:\.[a-z-]+)?\.facade\.ts$/.exec(pathFromSource);
  return match?.[1] as Capability | undefined;
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

function resolveImport(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(importer), specifier.replace(/\.js$/, ""));
  const candidates = [`${base}.ts`, resolve(base, "index.ts")];
  return candidates.find((candidate) => Bun.file(candidate).size > 0);
}

const violations: string[] = [];
for (const filePath of await sourceFiles(sourceRoot)) {
  const from = sourceCapability(filePath);
  const isRootIndex = relative(sourceRoot, filePath).replace(/\\/g, "/") === "index.ts";
  if (!from && !isRootIndex) continue;
  const sourceFile = ts.createSourceFile(filePath, await readFile(filePath, "utf8"), ts.ScriptTarget.Latest, true);
  for (const specifier of importSpecifiers(sourceFile)) {
    const importedPath = resolveImport(filePath, specifier);
    if (!importedPath) continue;
    const directTarget = implementationCapability(importedPath);
    const facadeTarget = facadeCapability(importedPath);
    const target = facadeTarget ?? directTarget;
    if (!target || target === from) continue;

    if (isRootIndex) {
      if (!facadeTarget) {
        violations.push(`${relative(packageRoot, filePath)} exports ${target} implementation directly via ${specifier}; root exports must use a capability facade`);
      }
      continue;
    }

    if (!allowedDirections[from!].includes(target)) {
      violations.push(`${relative(packageRoot, filePath)} uses forbidden ${from} → ${target} direction via ${specifier}`);
      continue;
    }
    if (!facadeTarget && from !== "interaction-composition") {
      violations.push(`${relative(packageRoot, filePath)} imports ${target} implementation directly via ${specifier}; use its capabilities/*.facade.ts contract`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Capability boundary violations:\n${violations.map((entry) => `- ${entry}`).join("\n")}`);
}

const directions = Object.entries(allowedDirections)
  .flatMap(([from, targets]) => targets.map((to) => `${from} → ${to}`));
console.log(`Capability boundaries OK (${directions.length} named directions: ${directions.join("; ")}).`);
