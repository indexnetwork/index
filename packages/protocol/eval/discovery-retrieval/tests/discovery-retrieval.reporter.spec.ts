import { describe, expect, it } from "bun:test";

import { CASES } from "../discovery-retrieval.cases.js";
import { renderHtml } from "../discovery-retrieval.reporter.js";
import type { CaseResult, Scorecard } from "../discovery-retrieval.types.js";

const c = CASES[0]!;
const mode = (name: "intent_to_premise" | "intent_to_context" | "context_to_context", recallAtK: number) => ({
  mode: name,
  runs: 1,
  passes: 1,
  passRate: 1,
  flaky: false,
  runResults: [{
    runId: `${name}-1`,
    runIndex: 0,
    passed: true,
    assertions: [],
    detail: {
      mode: name,
      ranking: [{ userId: c.expect.expectedUserIds[0]!, score: 0.9, text: "target", representation: name === "intent_to_premise" ? "premise" as const : "user_context" as const }],
      recallAtK,
      expectedRanks: { [c.expect.expectedUserIds[0]!]: 1 },
      excludedInTopK: [],
    },
  }],
});

const result: CaseResult = {
  caseId: c.id,
  rule: c.rule,
  runs: 3,
  passes: 3,
  passRate: 1,
  flaky: false,
  modeResults: [mode("intent_to_premise", 0.5), mode("intent_to_context", 1), mode("context_to_context", 1)],
};

const scorecard: Scorecard = {
  generatedAt: new Date().toISOString(),
  model: "test",
  runs: 1,
  aggregatePassRate: 1,
  rules: [{ rule: c.rule, caseCount: 1, passRate: 1 }],
  cases: [result],
};

describe("discovery retrieval reporter", () => {
  it("renders separate premise/context representations and their recall delta", () => {
    const html = renderHtml(scorecard, [], [c]);
    expect(html).toContain("Intent → premise");
    expect(html).toContain("Intent → user context");
    expect(html).toContain("Paired context − premise Recall@K");
    expect(html).toContain("+0.500");
  });
});
