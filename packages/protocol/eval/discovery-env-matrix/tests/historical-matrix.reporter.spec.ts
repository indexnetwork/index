import { describe, expect, it } from "bun:test";

import { leanMatrixScorecard, renderHtml } from "../historical-matrix.reporter.js";
import type { MatrixScorecard } from "../historical-matrix.policy.js";

const scorecard: MatrixScorecard = {
  generatedAt: "2026-07-28T00:00:00.000Z",
  model: "test-model",
  runs: 3,
  aggregatePassRate: 1,
  rules: [{ rule: "both-premise", caseCount: 1, passRate: 1 }],
  cases: [{
    caseId: "historical/case-a",
    rule: "both-premise",
    rowId: "both-premise",
    repetition: 1,
    runs: 1,
    passes: 1,
    passRate: 1,
    flaky: false,
    passed: true,
    targetRank: 1,
    evidenceTypes: ["intent", "premise"],
    configDeltas: [{ key: "DISCOVERY_ALLOWED_TYPES", before: "intent", after: "intent,profile" }],
    assertions: [
      { kind: "target_returned", passed: true, detail: "expected target returned at rank 1" },
      { kind: "excluded_absent", passed: true, detail: "excluded targets absent" },
      { kind: "fixture_ownership", passed: true, detail: "all candidates are fixture-owned" },
      { kind: "allowed_evidence", passed: true, detail: "all evidence types are allowed" },
      { kind: "completion", passed: true, detail: "slot completed" },
      { kind: "judge", passed: true, detail: "judge approved" },
    ],
    candidates: [{ id: "candidate-a", evidenceTypes: ["intent", "premise"], evidenceIds: { candidateIntentId: "intent-a", candidatePremiseId: "premise-a" }, rawText: "raw provider candidate text" }],
    judge: { passed: true, detail: "judge approved" },
  }],
};

describe("historical discovery environment matrix reporter", () => {
  it("renders matrix slots in a scorecard-shell table with score and configuration evidence", () => {
    const html = renderHtml(scorecard, []);

    expect(html).toContain("Discovery environment matrix eval");
    expect(html).toContain("historical/case-a");
    expect(html).toContain("both-premise");
    expect(html).toContain("target rank");
    expect(html).toContain("intent, premise");
    expect(html).toContain("target_returned: pass");
    expect(html).toContain("judge: pass");
    expect(html).toContain("DISCOVERY_ALLOWED_TYPES: intent → intent,profile");
  });

  it("retains raw candidate text in run scorecards but removes it from baseline scorecards", () => {
    const baseline = leanMatrixScorecard(scorecard);

    expect(JSON.stringify(scorecard)).toContain("raw provider candidate text");
    expect(JSON.stringify(baseline)).not.toContain("raw provider candidate text");
    expect(baseline.cases[0]!.candidates[0]).not.toHaveProperty("rawText");
    expect(baseline.cases[0]!.candidates[0]!.evidenceIds).toEqual({ candidateIntentId: "intent-a", candidatePremiseId: "premise-a" });
  });
});
