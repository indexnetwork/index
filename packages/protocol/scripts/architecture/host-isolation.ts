#!/usr/bin/env bun
/** Ensures protocol source stays independent of concrete host implementations. */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const sourceRoot = resolve(packageRoot, "src");
const bannedPackages = /^(?:drizzle-orm(?:\/.*)?|bullmq|ioredis|pg|postgres|redis|express(?:\/.*)?|fastify(?:\/.*)?|hono(?:\/.*)?|next(?:\/.*)?|@trpc\/server(?:\/.*)?)$/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(directory, entry);
    const entryStat = await stat(fullPath);
    if (entryStat.isDirectory()) {
      if (entry !== "tests") files.push(...await sourceFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts") && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function isWithinSource(path: string): boolean {
  return path === sourceRoot || path.startsWith(sourceRoot + sep);
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
    if (
      ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveRelativeImporter(importer: string, specifier: string): string {
  const withoutJsExtension = specifier.replace(/\.js$/, "");
  return resolve(dirname(importer), withoutJsExtension);
}

const violations: string[] = [];
for (const filePath of await sourceFiles(sourceRoot)) {
  const sourceFile = ts.createSourceFile(filePath, await readFile(filePath, "utf8"), ts.ScriptTarget.Latest, true);
  for (const specifier of importSpecifiers(sourceFile)) {
    if (bannedPackages.test(specifier)) {
      violations.push(`${relative(packageRoot, filePath)} imports concrete host package ${specifier}`);
      continue;
    }
    if (!specifier.startsWith(".")) {
      if (specifier.startsWith("services/api/") || specifier.startsWith("apps/web/")) {
        violations.push(`${relative(packageRoot, filePath)} imports host implementation ${specifier}`);
      }
      continue;
    }
    if (!isWithinSource(resolveRelativeImporter(filePath, specifier))) {
      violations.push(`${relative(packageRoot, filePath)} escapes protocol source via ${specifier}`);
    }
  }
}

if (violations.length > 0) throw new Error(`Host-isolation violations:\n${violations.map((entry) => `- ${entry}`).join("\n")}`);
console.log("Host isolation OK (zero API/web/schema/queue/concrete-adapter imports)." );
