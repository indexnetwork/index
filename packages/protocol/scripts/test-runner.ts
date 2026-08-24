import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type TestTotals = { pass: number; fail: number; error: number; skip: number; testsRan: number; filesRan: number };
export type ChildTestResult = {
  file: string;
  exitCode: number;
  totals: TestTotals | null;
  durationMs: number;
  output: string;
  failureReasons: readonly string[];
};

type ChildTestInput = Omit<ChildTestResult, "totals" | "failureReasons">;

export type RunFilesOptions = {
  concurrency: number;
  runFile(file: string): Promise<ChildTestInput>;
  onResult?(result: ChildTestResult, completed: number, total: number): void;
};

export function parseBunTestTotals(output: string): TestTotals | null {
  const passMatches = [...output.matchAll(/(?:^|\n)\s*(\d+)\s+pass(?:ed)?\b/gm)];
  const failMatches = [...output.matchAll(/(?:^|\n)\s*(\d+)\s+fail(?:ed)?\b/gm)];
  const errorMatches = [...output.matchAll(/(?:^|\n)\s*(\d+)\s+error(?:s)?\b/gm)];
  const skipMatches = [...output.matchAll(/(?:^|\n)\s*(\d+)\s+skip(?:ped)?\b/gm)];
  const skipSummaryLines = [...output.matchAll(/^\s*\S+\s+skip(?:ped)?\s*$/gm)];
  const ranMatches = [...output.matchAll(/^Ran\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?\.\s+\[[^\]\n]+\]$/gm)];
  if (
    passMatches.length !== 1
    || failMatches.length !== 1
    || errorMatches.length > 1
    || skipMatches.length > 1
    || skipSummaryLines.length !== skipMatches.length
    || ranMatches.length !== 1
  ) return null;
  const pass = passMatches[0];
  const fail = failMatches[0];
  const error = errorMatches[0];
  const skip = skipMatches[0];
  const ran = ranMatches[0];
  const footerTail = output.slice((ran.index ?? 0) + ran[0].length);
  if (!/^\s*$/.test(footerTail)) return null;
  return {
    pass: Number(pass[1]),
    fail: Number(fail[1]),
    error: error ? Number(error[1]) : 0,
    skip: skip ? Number(skip[1]) : 0,
    testsRan: Number(ran[1]),
    filesRan: Number(ran[2]),
  };
}

export function validateChildResult(input: ChildTestInput): ChildTestResult {
  const totals = parseBunTestTotals(input.output);
  const reasons: string[] = [];
  if (input.exitCode !== 0) reasons.push(`non-zero exit code ${input.exitCode}`);
  if (!totals) reasons.push("unparseable Bun test totals");
  if (totals && (totals.pass + totals.fail + totals.error === 0 || totals.filesRan === 0)) reasons.push("child executed zero tests");
  if (totals && totals.testsRan !== totals.pass + totals.fail + totals.skip) reasons.push("reported test count does not match pass/fail totals");
  if (totals && totals.filesRan !== 1) reasons.push(`per-file child reported ${totals.filesRan} files`);
  if (totals && totals.fail > 0) reasons.push(`${totals.fail} failed tests`);
  if (totals && totals.error > 0) reasons.push(`${totals.error} test errors`);
  return { ...input, totals, failureReasons: reasons };
}

export function parseConcurrency(value: string | undefined): number {
  const parsed = value === undefined ? 4 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`TEST_CONCURRENCY must be an integer >= 1; received ${value}`);
  return parsed;
}

export function findSpecFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...findSpecFiles(full));
    else if (entry.endsWith(".spec.ts") || entry.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

export function classifySpecFiles(root: string, liveModelSpecs: ReadonlySet<string>): {
  providerFreeFiles: string[];
  liveFiles: string[];
} {
  const allFiles = findSpecFiles(root).sort();
  const relativePath = (file: string) => relative(root, file).replace(/^internal\//, "");
  return {
    providerFreeFiles: allFiles.filter((file) => !liveModelSpecs.has(relativePath(file))),
    liveFiles: allFiles.filter((file) => liveModelSpecs.has(relativePath(file))),
  };
}

export async function runFiles(files: string[], options: RunFilesOptions): Promise<ChildTestResult[]> {
  if (files.length === 0) throw new Error("No provider-free spec files discovered");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("Concurrency must be an integer >= 1");

  const results: ChildTestResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];
      const result = validateChildResult(await options.runFile(file));
      results.push(result);
      options.onResult?.(result, results.length, files.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, files.length) }, worker));
  return results;
}
