import { describe, expect, test } from "bun:test";

import { HarnessProgressParser, parseHarnessProgress } from "../ops.progress.js";

const HEADER = "Running 3 case(s) × 1 run(s) against anthropic/claude-test…\n";
const DEBUG_BLOCK =
  "[OpportunityEvaluator:invokeEntityBundle] Done {\n" +
  "  total: 1,\n" +
  "  afterClaimGuard: 0,\n" +
  "  accepted: 0,\n" +
  "}\n";

describe("parseHarnessProgress", () => {
  test("parses the real format: start line, debug dump, completion on its own line", () => {
    const log =
      HEADER +
      `  is_a/identity-basic … ${DEBUG_BLOCK}` +
      "1/1\n" +
      `  is_a/identity-negated … ${DEBUG_BLOCK}` +
      "0/1 (flaky)\n" +
      `  location/remote-vs-onsite … ${DEBUG_BLOCK}` +
      "1/1\n" +
      "\nScorecard: 66.7%\n";
    const p = parseHarnessProgress(log);
    expect(p.totalCases).toBe(3);
    expect(p.runsPerCase).toBe(1);
    expect(p.model).toBe("anthropic/claude-test");
    expect(p.completed).toBe(3);
    expect(p.passed).toBe(2);
    expect(p.failed).toBe(1);
    expect(p.current).toBeNull();
    expect(p.cases.map((c) => c.id)).toEqual([
      "is_a/identity-basic",
      "is_a/identity-negated",
      "location/remote-vs-onsite",
    ]);
    expect(p.cases[1].flaky).toBe(true);
  });

  test("quiet output: start and completion on one line", () => {
    const p = parseHarnessProgress(HEADER + "  is_a/identity-basic … 1/1\n  a/two … 0/1 (flaky)\n");
    expect(p.completed).toBe(2);
    expect(p.passed).toBe(1);
    expect(p.failed).toBe(1);
  });

  test("a case stays in flight while debug output scrolls past", () => {
    const log = HEADER + "  is_a/identity-basic … 1/1\n" + `  location/known-mismatch … ${DEBUG_BLOCK}`;
    const p = parseHarnessProgress(log);
    expect(p.completed).toBe(1);
    expect(p.current?.id).toBe("location/known-mismatch");
    expect(p.cases).toHaveLength(2);
  });

  test("a new case start closes the previous case as unknown", () => {
    const log = HEADER + "  a/one … debug without completion\n" + "  a/two … 1/1\n";
    const p = parseHarnessProgress(log);
    expect(p.cases).toHaveLength(2);
    expect(p.cases[0]).toMatchObject({ id: "a/one", done: true, passes: null, runs: null });
    expect(p.cases[1]).toMatchObject({ id: "a/two", done: true, passes: 1, runs: 1 });
    // Unknown completions count as neither passed nor failed.
    expect(p.passed).toBe(1);
    expect(p.failed).toBe(0);
    expect(p.completed).toBe(2);
  });

  test("retry notices do not complete a case, despite containing attempt N/M", () => {
    const log =
      HEADER +
      `  a/one … ${DEBUG_BLOCK}` +
      "[matching eval] call failed (run 1, attempt 1/3); retrying in 1000ms: evaluator-incomplete\n" +
      "[matching eval] call failed (run 1, attempt 2/3); retrying in 2000ms: evaluator-incomplete\n" +
      "2/3\n";
    const p = parseHarnessProgress(log);
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0]).toMatchObject({ passes: 2, runs: 3, done: true });
  });

  test("returns nulls for output that is not a harness run", () => {
    const p = parseHarnessProgress("Usage: eval:matching [flags]\n--runs <n>\n");
    expect(p.totalCases).toBeNull();
    expect(p.cases).toHaveLength(0);
  });

  test("strips ANSI colour before parsing", () => {
    const esc = "\u001b";
    const log = HEADER + `  ${esc}[32mis_a/identity-basic${esc}[0m … 1/1\n`;
    const p = parseHarnessProgress(log);
    expect(p.completed).toBe(1);
    expect(p.cases[0].id).toBe("is_a/identity-basic");
  });

  test("handles judge-off header variant", () => {
    const p = parseHarnessProgress(
      "Running 8 case(s) × 3 run(s) against openai/gpt-test (judge off)…\n",
    );
    expect(p.totalCases).toBe(8);
    expect(p.runsPerCase).toBe(3);
    expect(p.model).toBe("openai/gpt-test");
  });
});

describe("HarnessProgressParser (incremental)", () => {
  test("a completion line split across chunks still parses", () => {
    const parser = new HarnessProgressParser();
    parser.push(HEADER);
    parser.push("  a/one … debug\n");
    expect(parser.snapshot().current?.id).toBe("a/one");
    parser.push("1/");
    expect(parser.snapshot().current?.id).toBe("a/one");
    parser.push("1\n");
    const p = parser.snapshot();
    expect(p.completed).toBe(1);
    expect(p.current).toBeNull();
    expect(p.cases[0].passes).toBe(1);
  });

  test("snapshot is a copy; mutation does not corrupt the parser", () => {
    const parser = new HarnessProgressParser();
    parser.push(HEADER + "  a/one … 1/1\n");
    parser.snapshot().cases.pop();
    expect(parser.snapshot().cases).toHaveLength(1);
  });

  test("a case completed after the snapshot mutates the parser, not the snapshot", () => {
    const parser = new HarnessProgressParser();
    parser.push(HEADER + "  a/one … debug\n");
    const before = parser.snapshot();
    parser.push("0/1\n");
    expect(before.cases[0].done).toBe(false);
    expect(parser.snapshot().cases[0].done).toBe(true);
  });
});
