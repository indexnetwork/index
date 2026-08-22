#!/usr/bin/env bun
/** Enforces the protocol-kernel directory dependency rules. */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const sourceRoot = resolve(packageRoot, "src");
const boundaryDirectories = new Set(["protocol", "platform", "capabilities", "internal"]);
const legacyCapabilityDirectories: Readonly<Record<string, string>> = {
  intents: "intents",
  networks: "networks",
  agents: "agents",
  discovery: "discovery",
  contexts: "contexts",
  contacts: "contacts",
  opportunities: "opportunities",
  negotiations: "negotiations",
};
const capabilityImplementationAreas: Readonly<Record<string, readonly string[]>> = {
  agents: ["agents", "chat"],
  contexts: ["contexts", "enrichment", "premises"],
};
const capabilityCompositionRoots = new Set([
  "internal/shared/agent/tool.factory.ts",
  "internal/shared/agent/tool.registry.ts",
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry);
    const entryStat = await stat(path);
    if (entryStat.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts") && !entry.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function importSpecifiers(source: string, path: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function isExportOnlyModule(source: string, path: string): boolean {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return file.statements.length > 0 && file.statements.every((statement) =>
    ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement),
  );
}

function targetPath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return relative(sourceRoot, resolve(dirname(importer), specifier.replace(/\.js$/, "")));
}

const violations: string[] = [];
for (const directory of boundaryDirectories) {
  for (const file of await sourceFiles(resolve(sourceRoot, directory))) {
    if (isExportOnlyModule(await readFile(file, "utf8"), file)) {
      violations.push(`${relative(packageRoot, file)} is an export-only module; keep package exports in src/index.ts or give the file executable/contracts behavior.`);
    }
    const from = relative(sourceRoot, file).split("/")[0];
    for (const specifier of importSpecifiers(await readFile(file, "utf8"), file)) {
      if (!specifier.startsWith(".")) {
        if (from === "protocol" && specifier !== "zod") violations.push(`${relative(packageRoot, file)} imports ${specifier}; protocol may only depend on zod.`);
        continue;
      }
      const targetPathname = targetPath(file, specifier);
      if (!targetPathname) continue;
      const target = targetPathname.split("/")[0];
      if (from === "protocol" && target !== "protocol") violations.push(`${relative(packageRoot, file)} imports ${specifier}; protocol cannot import package code.`);
      if (from === "platform" && target !== "platform" && target !== "protocol") violations.push(`${relative(packageRoot, file)} imports ${specifier}; platform may import protocol types only.`);
      if (from === "internal" && target === "capabilities" && !capabilityCompositionRoots.has(relative(sourceRoot, file))) {
        violations.push(`${relative(packageRoot, file)} imports ${specifier}; internal cannot depend on capabilities.`);
      }
      if (from === "capabilities") {
        const facade = relative(sourceRoot, file).split("/")[1]?.replace(/\.ts$/, "");
        if (target === "capabilities" || target === "protocol" || target === "platform") continue;
        const internalArea = targetPathname.split("/")[1];
        if (target === "internal" && (
          internalArea === "shared"
          || internalArea === legacyCapabilityDirectories[facade ?? ""]
          || capabilityImplementationAreas[facade ?? ""]?.includes(internalArea)
        )) continue;
        violations.push(`${relative(packageRoot, file)} imports ${specifier}; a capability may only reach its own private implementation or shared internal support.`);
      }
    }
  }
}

if (violations.length > 0) throw new Error(`Protocol-kernel boundary violations:\n${violations.map((entry) => `- ${entry}`).join("\n")}`);
console.log("Protocol-kernel boundaries OK (protocol, platform, capabilities, and internal)." );
