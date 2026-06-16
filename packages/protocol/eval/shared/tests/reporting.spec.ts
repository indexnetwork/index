import { describe, it, expect } from "bun:test";

import { buildScorecard } from "../scorecard.js";
import { formatConsole } from "../console.js";
import { renderScorecardShell, renderRuleTable, htmlEscape, rateClass } from "../html.js";
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
