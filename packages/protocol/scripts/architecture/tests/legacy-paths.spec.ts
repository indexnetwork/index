import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import * as ts from "typescript";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../../..");

const LEGACY_PATHS = [
  "packages/protocol/src/intent/intent.clarifier.ts",
  "packages/protocol/src/intent/intent.graph.ts",
  "packages/protocol/src/intent/intent.indexer.ts",
  "packages/protocol/src/intent/intent.inferrer.ts",
  "packages/protocol/src/intent/intent.reconciler.ts",
  "packages/protocol/src/intent/intent.specificity.ts",
  "packages/protocol/src/intent/intent.state.ts",
  "packages/protocol/src/intent/intent.tools.ts",
  "packages/protocol/src/intent/intent.verifier.ts",
  "packages/protocol/src/network/indexer/indexer.graph.ts",
  "packages/protocol/src/network/indexer/indexer.state.ts",
  "packages/protocol/src/network/membership/membership.graph.ts",
  "packages/protocol/src/network/membership/membership.state.ts",
  "packages/protocol/src/network/network.graph.ts",
  "packages/protocol/src/network/network.recommender.ts",
  "packages/protocol/src/network/network.state.ts",
  "packages/protocol/src/network/network.tools.ts",
  "packages/protocol/src/questioner/questioner.agent.ts",
  "packages/protocol/src/questioner/questioner.ask.tool.ts",
  "packages/protocol/src/questioner/questioner.discovery.prompt.ts",
  "packages/protocol/src/questioner/questioner.env.ts",
  "packages/protocol/src/questioner/questioner.presets.ts",
  "packages/protocol/src/questioner/questioner.qud.ts",
  "packages/protocol/src/questioner/questioner.tools.ts",
  "packages/protocol/src/questioner/questioner.types.ts",
  "packages/protocol/src/agent/agent.tools.ts",
  "packages/protocol/src/contact/contact.inviter.ts",
  "packages/protocol/src/contact/contact.tools.ts",
  "packages/protocol/src/integration/integration.tools.ts",
  "packages/protocol/src/opportunity/delivery-card.cache.ts",
  "packages/protocol/src/opportunity/discovery-question.helper.ts",
  "packages/protocol/src/opportunity/negotiation-context.loader.ts",
  "packages/protocol/src/opportunity/negotiation-summary.builder.ts",
  "packages/protocol/src/opportunity/opportunity.actor.ts",
  "packages/protocol/src/opportunity/opportunity.card-presentation.ts",
  "packages/protocol/src/opportunity/opportunity.claim-safety.ts",
  "packages/protocol/src/opportunity/opportunity.discovery-negotiation-summary.ts",
  "packages/protocol/src/opportunity/opportunity.enricher.ts",
  "packages/protocol/src/opportunity/opportunity.evaluator.ts",
  "packages/protocol/src/opportunity/opportunity.evidence.ts",
  "packages/protocol/src/opportunity/opportunity.existing-negotiation.ts",
  "packages/protocol/src/opportunity/opportunity.feed-selection.ts",
  "packages/protocol/src/opportunity/opportunity.graph.ts",
  "packages/protocol/src/opportunity/opportunity.introducer.ts",
  "packages/protocol/src/opportunity/opportunity.labels.ts",
  "packages/protocol/src/opportunity/opportunity.lifecycle.ts",
  "packages/protocol/src/opportunity/opportunity.newborn-stamping.ts",
  "packages/protocol/src/opportunity/opportunity.owner-approval.ts",
  "packages/protocol/src/opportunity/opportunity.pending-questions.ts",
  "packages/protocol/src/opportunity/opportunity.persist.ts",
  "packages/protocol/src/opportunity/opportunity.persistence-admission.ts",
  "packages/protocol/src/opportunity/opportunity.presentation-cache.ts",
  "packages/protocol/src/opportunity/opportunity.presentation.ts",
  "packages/protocol/src/opportunity/opportunity.presenter.ts",
  "packages/protocol/src/opportunity/opportunity.safe-presentation.ts",
  "packages/protocol/src/opportunity/opportunity.state.ts",
  "packages/protocol/src/opportunity/opportunity.tools.ts",
  "packages/protocol/src/opportunity/opportunity.update-admission.ts",
  "packages/protocol/src/opportunity/opportunity.utils.ts",
  "packages/protocol/src/negotiation/insight.generator.ts",
  "packages/protocol/src/negotiation/negotiation.agent.ts",
  "packages/protocol/src/negotiation/negotiation.consultation-policy.ts",
  "packages/protocol/src/negotiation/negotiation.deadlock.contracts.ts",
  "packages/protocol/src/negotiation/negotiation.deadlock.ts",
  "packages/protocol/src/negotiation/negotiation.detail-reader.ts",
  "packages/protocol/src/negotiation/negotiation.graph.ts",
  "packages/protocol/src/negotiation/negotiation.intent-snapshot-provenance.ts",
  "packages/protocol/src/negotiation/negotiation.lifecycle-narration.ts",
  "packages/protocol/src/negotiation/negotiation.memory.ts",
  "packages/protocol/src/negotiation/negotiation.protocol.ts",
  "packages/protocol/src/negotiation/negotiation.question-safety.ts",
  "packages/protocol/src/negotiation/negotiation.reflect.ts",
  "packages/protocol/src/negotiation/negotiation.screen.ts",
  "packages/protocol/src/negotiation/negotiation.state.ts",
  "packages/protocol/src/negotiation/negotiation.summarizer.ts",
  "packages/protocol/src/negotiation/negotiation.task-lock-policy.ts",
  "packages/protocol/src/negotiation/negotiation.tools.ts",
] as const;

const LEGACY_PATH_SET = new Set(LEGACY_PATHS);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", "vendor", "generated", "coverage"]);

type Violation = { importer: string; specifier: string; legacyPath: string };

function repositoryPath(path: string): string {
  return relative(REPOSITORY_ROOT, path).split(sep).join("/");
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function specifiers(source: string, path: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const stringArgument = (node: ts.Node | undefined): string | undefined =>
    node && ts.isStringLiteral(node) ? node.text : undefined;
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const value = stringArgument(node.moduleSpecifier);
      if (value) found.push(value);
    } else if (ts.isCallExpression(node)) {
      const value = stringArgument(node.arguments[0]);
      if (value && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) found.push(value);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const value = stringArgument(node.arguments?.[0]);
      if (value) found.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function resolvedPaths(importer: string, specifier: string): string[] {
  const base = specifier.startsWith("/") ? specifier
    : specifier.startsWith(".") ? resolve(dirname(importer), specifier)
      : resolve(REPOSITORY_ROOT, specifier);
  const extension = extname(base);
  const candidates = [base];
  if (extension === ".js") candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  if (!extension) candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"));
  return candidates.map(repositoryPath);
}

async function legacyPathViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const importer of await sourceFiles(REPOSITORY_ROOT)) {
    const importerPath = repositoryPath(importer);
    if (!importerPath.startsWith("services/api/") && !importerPath.startsWith("packages/protocol/eval/clarification/")) continue;
    if (LEGACY_PATH_SET.has(importerPath)) continue;
    for (const specifier of specifiers(await readFile(importer, "utf8"), importer)) {
      for (const legacyPath of resolvedPaths(importer, specifier)) {
        if (LEGACY_PATH_SET.has(legacyPath)) violations.push({ importer: importerPath, specifier, legacyPath });
      }
    }
  }
  return violations.sort((left, right) => left.importer.localeCompare(right.importer) || left.specifier.localeCompare(right.specifier));
}

test("repository source does not reference deprecated protocol paths", async () => {
  expect(LEGACY_PATHS).toHaveLength(77);
  expect(await legacyPathViolations()).toEqual([]);
});
