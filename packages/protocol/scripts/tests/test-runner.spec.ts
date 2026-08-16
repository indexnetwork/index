import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySpecFiles, parseBunTestTotals, parseConcurrency, runFiles, validateChildResult } from "../test-runner.js";
import { LIVE_MODEL_SPECS } from "../test.js";

const success = "\n 3 pass\n 0 fail\nRan 3 tests across 1 file. [1ms]\n";

describe("validateChildResult", () => {
  test("accepts a successful child", () => {
    expect(validateChildResult({ file: "ok.spec.ts", exitCode: 0, output: success, durationMs: 1 }).failureReasons).toEqual([]);
  });

  test.each([
    ["ordinary failure", 1, "1 pass\n1 fail\nRan 2 tests across 1 file. [1ms]\n", "non-zero exit code 1"],
    ["child crash", 134, "panic: aborted", "non-zero exit code 134"],
    ["malformed output", 0, "unexpected output", "unparseable Bun test totals"],
    ["zero tests", 0, "0 pass\n0 fail\nRan 0 tests across 0 files. [1ms]\n", "child executed zero tests"],
  ])("rejects %s", (_label, exitCode, output, reason) => {
    expect(validateChildResult({ file: "bad.spec.ts", exitCode, output, durationMs: 1 }).failureReasons).toContain(reason);
  });
});

describe("parseConcurrency", () => {
  test.each(["0", "-1", "NaN", "1.5"])("rejects %s", (value) => {
    expect(() => parseConcurrency(value)).toThrow();
  });
  test("defaults to four", () => expect(parseConcurrency(undefined)).toBe(4));
});

test("unparseable output returns null", () => {
  expect(parseBunTestTotals("panic")).toBeNull();
});

test("parses mixed pass and skip totals", () => {
  expect(parseBunTestTotals("1 pass\n3 skip\n0 fail\nRan 4 tests across 1 file. [1ms]\n")).toEqual({
    pass: 1,
    fail: 0,
    error: 0,
    skip: 3,
    testsRan: 4,
    filesRan: 1,
  });
});

test("rejects duplicate or malformed skip summaries", () => {
  expect(parseBunTestTotals("1 pass\n1 skip\n1 skip\n0 fail\nRan 2 tests across 1 file. [1ms]\n")).toBeNull();
  expect(parseBunTestTotals("1 pass\nmany skip\n0 fail\nRan 1 test across 1 file. [1ms]\n")).toBeNull();
});

test("rejects a skip-only child as executing zero tests", () => {
  const result = validateChildResult({
    file: "skip-only.spec.ts",
    exitCode: 0,
    output: "0 pass\n2 skip\n0 fail\nRan 2 tests across 1 file. [1ms]\n",
    durationMs: 1,
  });
  expect(result.failureReasons).toContain("child executed zero tests");
});

test.each([
  "1 pass\n0 fail\nRan 1 test across 1 file. [1ms]\nRan 1 test across 1 file. [1ms]\n",
  "1 pass\n0 fail\nRan 1 test across 1 file. [1ms]\npanic after footer\n",
  "1 pass\n0 fail\ngarbageRan 1 test across 1 file. [1ms]\n",
])("rejects duplicate, trailing, or prefixed footer output", (output) => {
  expect(parseBunTestTotals(output)).toBeNull();
});

test("rejects internally inconsistent Bun totals", () => {
  const result = validateChildResult({
    file: "inconsistent.spec.ts",
    exitCode: 0,
    output: "3 pass\n0 fail\nRan 1 test across 2 files. [1ms]\n",
    durationMs: 1,
  });
  expect(result.failureReasons).toContain("reported test count does not match pass/fail totals");
  expect(result.failureReasons).toContain("per-file child reported 2 files");
});

describe("runFiles", () => {
  test("fails when discovery produces zero files", async () => {
    await expect(runFiles([], { concurrency: 1, runFile: async () => ({
      file: "unreachable.spec.ts",
      exitCode: 0,
      output: success,
      durationMs: 1,
    }) })).rejects.toThrow("No provider-free spec files discovered");
  });

  test("coordinates work without exceeding the configured concurrency", async () => {
    const releases: Array<() => void> = [];
    const started: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const run = runFiles(["a.spec.ts", "b.spec.ts", "c.spec.ts"], {
      concurrency: 2,
      async runFile(file) {
        started.push(file);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return { file, exitCode: 0, output: success, durationMs: 1 };
      },
    });

    await Bun.sleep(0);
    expect(started).toEqual(["a.spec.ts", "b.spec.ts"]);
    expect(maximumActive).toBe(2);
    releases.shift()?.();
    await Bun.sleep(0);
    expect(started).toEqual(["a.spec.ts", "b.spec.ts", "c.spec.ts"]);
    expect(maximumActive).toBe(2);
    for (const release of releases) release();

    expect((await run).map((result) => result.file).sort()).toEqual(["a.spec.ts", "b.spec.ts", "c.spec.ts"]);
  });

  test("validates child results returned by the pool", async () => {
    const [result] = await runFiles(["broken.spec.ts"], {
      concurrency: 1,
      runFile: async (file) => ({ file, exitCode: 134, output: "panic: aborted", durationMs: 1 }),
    });

    expect(result.failureReasons).toEqual(["non-zero exit code 134", "unparseable Bun test totals"]);
    expect(result.totals).toBeNull();
  });

  test("calls onResult with each validated result and completion count", async () => {
    const callbacks: Array<{ file: string; completed: number; total: number; reasons: readonly string[] }> = [];
    await runFiles(["first.spec.ts", "second.spec.ts"], {
      concurrency: 1,
      runFile: async (file) => ({ file, exitCode: 0, output: success, durationMs: 1 }),
      onResult(result, completed, total) {
        callbacks.push({ file: result.file, completed, total, reasons: result.failureReasons });
      },
    });

    expect(callbacks).toEqual([
      { file: "first.spec.ts", completed: 1, total: 2, reasons: [] },
      { file: "second.spec.ts", completed: 2, total: 2, reasons: [] },
    ]);
  });
});

test("discovers specs recursively and classifies live-model files", () => {
  const root = mkdtempSync(join(tmpdir(), "protocol-test-runner-"));
  try {
    for (const directory of ["chat/tests", "contact/tests", "nested/deeper"]) mkdirSync(join(root, directory), { recursive: true });
    for (const file of [
      "contact/tests/contact.inviter.spec.ts",
      "chat/tests/chat.logic.spec.ts",
      "nested/deeper/helper.test.ts",
      "nested/deeper/not-a-spec.ts",
    ]) writeFileSync(join(root, file), "");

    const discovered = classifySpecFiles(root, LIVE_MODEL_SPECS);

    expect(discovered.providerFreeFiles).toEqual([
      join(root, "chat/tests/chat.logic.spec.ts"),
      join(root, "nested/deeper/helper.test.ts"),
    ]);
    expect(discovered.liveFiles).toEqual([join(root, "contact/tests/contact.inviter.spec.ts")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
