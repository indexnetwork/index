import { describe, it, expect } from "bun:test";

import { buildScorecard } from "../scorecard.js";
import { formatConsole } from "../console.js";
import { renderScorecardShell, renderRuleTable, htmlEscape, rateClass, computeVerdict, groupStatus, renderHumanReport, type HumanReport } from "../html.js";
import type { CaseResultLike } from "../types.js";

const s = (caseId: string, rule: string, passRate: number, runs = 3): CaseResultLike => ({
  caseId,
  rule,
  runs,
  passes: Math.round(passRate * runs),
  passRate,
  flaky: passRate > 0 && passRate < 1,
});

describe("formatConsole", () => {
  it("uses a custom title and surfaces rule, aggregate, regressions, and skipped cases", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0)], { model: "test-model", runs: 3 });
    const out = formatConsole(
      sc,
      [{ id: "g", kind: "rule", before: 1, after: 0.5, pValue: 0.001 }],
      ["new/case"],
      { title: "Premise eval" },
    );
    expect(out).toContain("=== Premise eval ===");
    expect(out).toContain("aggregate pass-rate");
    expect(out).toContain("⚠");
    expect(out).toContain("p=");
    expect(out).toContain("absent from baseline");
  });

  it("defaults the title when none is given", () => {
    const sc = buildScorecard([s("c1", "g", 1)], { model: "m", runs: 1 });
    expect(formatConsole(sc, [])).toContain("=== Quality Scorecard ===");
  });
});

describe("html shell", () => {
  it("escapes text and classifies rates", () => {
    expect(htmlEscape("a<b>&\"c")).toBe("a&lt;b&gt;&amp;&quot;c");
    expect(rateClass(0.95)).toBe("good");
    expect(rateClass(0.8)).toBe("ok");
    expect(rateClass(0.5)).toBe("bad");
  });

  it("renders a standalone document with banner, sections, and case cards", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0)], { model: "m", runs: 3 });
    const html = renderScorecardShell(sc, [{ id: "g", kind: "rule", before: 1, after: 0.5, pValue: 0.02 }], {
      title: "Premise eval",
      intro: "<h2>About</h2><p>hi</p>",
      sections: [{ heading: "By rule", html: renderRuleTable(sc) }],
      caseCardsHtml: "<article class='case'>card</article>",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Premise eval");
    expect(html).toContain("Regressions vs baseline");
    expect(html).toContain("By rule");
    expect(html).toContain("card");
    expect(html).toContain("CI₉₅");
  });
});

describe("human-readable report", () => {
  const human: HumanReport = {
    subject: "the thing",
    oneLiner: "It does a thing and we checked it.",
    groups: [
      { label: "Telling things apart", blurb: "can it distinguish X from Y", ruleIds: ["g"], cases: [
        { caseId: "c1", scenario: "we showed it X", expectation: "keep X and Y apart" },
        { caseId: "c2", scenario: "we showed it Y", expectation: "keep X and Y apart", failNote: "it confused them" },
      ] },
    ],
  };

  it("computeVerdict translates pass-rate and regressions into plain words", () => {
    const good = buildScorecard([s("c1", "g", 1), s("c2", "g", 1)], { model: "m", runs: 3 });
    expect(computeVerdict(good, []).word).toBe("Looking good");
    expect(computeVerdict(good, []).tone).toBe("good");
    const reg = computeVerdict(good, [{ id: "g", kind: "rule", before: 1, after: 0.5, pValue: 0.01 }]);
    expect(reg.tone).toBe("bad");
    expect(reg.word).toBe("Needs attention");
  });

  it("groupStatus phrases reliability, inconsistency, and regressions plainly", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0.5)], { model: "m", runs: 3 });
    expect(groupStatus(sc, ["g"], []).phrase).toContain("missed");
    const perfect = buildScorecard([s("c1", "g", 1)], { model: "m", runs: 3 });
    expect(groupStatus(perfect, ["g"], []).phrase).toBe("works reliably");
    expect(groupStatus(perfect, ["g"], [{ id: "g", kind: "rule", before: 1, after: 0.5, pValue: 0.01 }]).phrase).toBe("newly slipping");
  });

  it("renderHumanReport shows verdict, what-we-tested, and scenario narratives with fail notes", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0)], { model: "m", runs: 3 });
    const html = renderHumanReport(sc, [], human);
    expect(html).toContain("What we tested");
    expect(html).toContain("Telling things apart");
    expect(html).toContain("we showed it X");
    expect(html).toContain("See the examples");
    expect(html).toContain("it confused them"); // failNote shown for the failing case
    expect(html).not.toContain("CI₉₅"); // no statistics in the human view
  });

  it("hero sub-line counts scenarios (not runs) and reconciles with the themes below", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0)], { model: "m", runs: 3 });
    const html = renderHumanReport(sc, [], human);
    expect(html).toContain("50% — 1 of 2 scenarios passed every time");
    expect(html).not.toContain("checks passed");
    // The single always-failing theme is named by its group label.
    expect(html).toContain("The “Telling things apart” scenario failed every run.");
  });

  it("hero blurb tallies occasionally-off scenarios when nothing fails outright", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0.5)], { model: "m", runs: 3 });
    const html = renderHumanReport(sc, [], human);
    expect(html).toContain("of 2 scenarios passed every time");
    expect(html).toContain("One was occasionally off.");
  });

  it("hero reports a clean sweep when every scenario passes every run", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 1)], { model: "m", runs: 3 });
    const html = renderHumanReport(sc, [], human);
    expect(html).toContain("2 of 2 scenarios passed every time");
    expect(html).toContain("Every scenario passed every run.");
  });

  it("renderScorecardShell puts the human report on top and collapses the technical view", () => {
    const sc = buildScorecard([s("c1", "g", 1), s("c2", "g", 0)], { model: "m", runs: 3 });
    const html = renderScorecardShell(sc, [], {
      title: "Demo eval",
      sections: [{ heading: "By rule", html: renderRuleTable(sc) }],
      caseCardsHtml: "<article class='case'>card</article>",
      human,
    });
    expect(html).toContain("What we tested");
    expect(html).toContain("Technical details (for engineers)");
    expect(html.indexOf("What we tested")).toBeLessThan(html.indexOf("Technical details"));
  });
});
