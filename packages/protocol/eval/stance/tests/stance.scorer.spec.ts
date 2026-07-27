import { describe, it, expect } from "bun:test";
import { CASES } from "../stance.cases.js";
import { compareToBaseline, renderScoreTable, scoreBucket, scoreStance, MATERIAL_GAIN_THRESHOLD } from "../stance.scorer.js";
import { isTerminal, runNegotiation, verdictFor } from "../stance.runner.js";
import type { StanceRunResult } from "../stance.types.js";

/**
 * Provider-free specs for the stance eval (IND-611). Gated by `eval:verify`,
 * which strips provider credentials — nothing here may reach a live model.
 */

function result(over: Partial<StanceRunResult> = {}): StanceRunResult {
  return {
    caseId: "c",
    value: "low",
    stance: "advocate",
    run: 1,
    verdict: "declined",
    terminalAction: "withdraw",
    turns: [],
    refusedAtTurnZero: false,
    ...over,
  };
}

describe("stance corpus", () => {
  it("contains both genuinely valuable and plausible-but-low-value fixtures", () => {
    const high = CASES.filter((c) => c.value === "high");
    const low = CASES.filter((c) => c.value === "low");
    expect(high.length).toBeGreaterThanOrEqual(4);
    expect(low.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique ids whose prefix matches the value label", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) expect(c.id.startsWith(`${c.value}/`)).toBe(true);
  });

  it("pairs a high-value and a low-value fixture on the SAME discovery query", () => {
    // The necessary-not-sufficient query rule is only measurable if query
    // satisfaction alone cannot separate the buckets.
    const withQuery = CASES.filter((c) => c.discoveryQuery);
    expect(withQuery.length).toBeGreaterThanOrEqual(2);
    expect(new Set(withQuery.map((c) => c.value))).toEqual(new Set(["high", "low"]));
    expect(new Set(withQuery.map((c) => c.discoveryQuery)).size).toBe(1);
  });

  it("never leaks stance vocabulary into fixture text the model reads", () => {
    // A fixture that says "not worth their attention" would hand the skeptic
    // stance its own conclusion.
    const forbidden = ["opportunity cost", "worth their attention", "finite attention", "not worth making", "skeptic", "advocate"];
    for (const c of CASES) {
      const visible = [
        c.networkPrompt,
        c.discoveryQuery ?? "",
        c.seedAssessment.reasoning,
        c.source.profile.bio ?? "",
        c.candidate.profile.bio ?? "",
        ...c.source.intents.map((i) => `${i.title} ${i.description}`),
        ...c.candidate.intents.map((i) => `${i.title} ${i.description}`),
      ].join(" ").toLowerCase();
      for (const term of forbidden) expect(visible).not.toContain(term);
    }
  });

  it("keeps both buckets comparable in prose length so value is not inferable from style", () => {
    const length = (v: "high" | "low") => {
      const bucket = CASES.filter((c) => c.value === v);
      const total = bucket.reduce(
        (sum, c) => sum + c.source.intents[0].description.length + c.candidate.intents[0].description.length,
        0,
      );
      return total / bucket.length;
    };
    const ratio = length("high") / length("low");
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.7);
  });
});

describe("verdict mapping", () => {
  it("maps terminal actions to verdicts", () => {
    expect(verdictFor("accept")).toBe("accepted");
    expect(verdictFor("decline")).toBe("declined");
    expect(verdictFor("reject")).toBe("declined");
    expect(verdictFor("withdraw")).toBe("declined");
    expect(verdictFor(null)).toBe("stalled");
  });

  it("treats only terminal actions as terminal", () => {
    for (const a of ["accept", "decline", "reject", "withdraw"]) expect(isTerminal(a)).toBe(true);
    for (const a of ["counter", "question", "outreach", "propose", "ask_user"]) expect(isTerminal(a)).toBe(false);
  });
});

describe("scoreBucket", () => {
  it("computes the decline rate over non-errored runs only", () => {
    const bucket = scoreBucket([
      result({ verdict: "declined" }),
      result({ verdict: "accepted", terminalAction: "accept" }),
      result({ verdict: "stalled", terminalAction: null }),
      result({ verdict: "stalled", terminalAction: null, error: "provider timeout" }),
    ]);
    expect(bucket.runs).toBe(3);
    expect(bucket.errors).toBe(1);
    expect(bucket.declined).toBe(1);
    expect(bucket.accepted).toBe(1);
    expect(bucket.stalled).toBe(1);
    expect(bucket.declineRate).toBeCloseTo(1 / 3);
  });

  it("returns a zero rate rather than NaN when every run errored", () => {
    expect(scoreBucket([result({ error: "boom" })]).declineRate).toBe(0);
  });
});

describe("scoreStance", () => {
  const results: StanceRunResult[] = [
    result({ stance: "skeptic", value: "low", verdict: "declined", refusedAtTurnZero: true }),
    result({ stance: "skeptic", value: "low", verdict: "declined" }),
    result({ stance: "skeptic", value: "high", verdict: "accepted", terminalAction: "accept" }),
    result({ stance: "skeptic", value: "high", verdict: "accepted", terminalAction: "accept" }),
    // Another stance's runs must not bleed in.
    result({ stance: "advocate", value: "low", verdict: "accepted", terminalAction: "accept" }),
  ];

  it("scores only its own stance's runs", () => {
    const score = scoreStance("skeptic", results);
    expect(score.lowValue.runs).toBe(2);
    expect(score.highValue.runs).toBe(2);
    expect(score.lowValue.declineRate).toBe(1);
    expect(score.highValue.declineRate).toBe(0);
  });

  it("reports discrimination as low-value minus high-value decline rate", () => {
    expect(scoreStance("skeptic", results).discrimination).toBe(1);
  });

  it("scores blanket pessimism as zero discrimination", () => {
    const pessimist: StanceRunResult[] = [
      result({ stance: "skeptic", value: "low", verdict: "declined" }),
      result({ stance: "skeptic", value: "high", verdict: "declined" }),
    ];
    expect(scoreStance("skeptic", pessimist).discrimination).toBe(0);
  });

  it("counts turn-0 refusals", () => {
    expect(scoreStance("skeptic", results).turnZeroRefusals).toBe(1);
  });
});

describe("compareToBaseline", () => {
  const advocate = scoreStance("advocate", [
    result({ stance: "advocate", value: "low", verdict: "accepted", terminalAction: "accept" }),
    result({ stance: "advocate", value: "low", verdict: "accepted", terminalAction: "accept" }),
    result({ stance: "advocate", value: "high", verdict: "accepted", terminalAction: "accept" }),
  ]);

  it("flags a material low-value gain that keeps the good matches", () => {
    const skeptic = scoreStance("skeptic", [
      result({ stance: "skeptic", value: "low", verdict: "declined" }),
      result({ stance: "skeptic", value: "low", verdict: "declined" }),
      result({ stance: "skeptic", value: "high", verdict: "accepted", terminalAction: "accept" }),
    ]);
    const cmp = compareToBaseline(advocate, skeptic);
    expect(cmp.lowValueDeclineDelta).toBe(1);
    expect(cmp.materialLowValueGain).toBe(true);
    expect(cmp.lostGoodMatches).toBe(false);
  });

  it("reports a null result when behaviour is unchanged", () => {
    const evaluator = scoreStance("evaluator", [
      result({ stance: "evaluator", value: "low", verdict: "accepted", terminalAction: "accept" }),
      result({ stance: "evaluator", value: "low", verdict: "accepted", terminalAction: "accept" }),
      result({ stance: "evaluator", value: "high", verdict: "accepted", terminalAction: "accept" }),
    ]);
    const cmp = compareToBaseline(advocate, evaluator);
    expect(cmp.lowValueDeclineDelta).toBe(0);
    expect(cmp.materialLowValueGain).toBe(false);
  });

  it("flags lost good matches even when the low-value gain is material", () => {
    const overshoot = scoreStance("skeptic", [
      result({ stance: "skeptic", value: "low", verdict: "declined" }),
      result({ stance: "skeptic", value: "low", verdict: "declined" }),
      result({ stance: "skeptic", value: "high", verdict: "declined" }),
    ]);
    const cmp = compareToBaseline(advocate, overshoot);
    expect(cmp.materialLowValueGain).toBe(true);
    expect(cmp.lostGoodMatches).toBe(true);
  });

  it("uses a fixed, documented materiality threshold", () => {
    expect(MATERIAL_GAIN_THRESHOLD).toBe(0.2);
  });
});

describe("renderScoreTable", () => {
  it("renders one markdown row per stance with explicit counts", () => {
    const table = renderScoreTable([
      scoreStance("advocate", [result({ stance: "advocate", value: "low", verdict: "accepted", terminalAction: "accept" })]),
    ]);
    expect(table).toContain("| stance | decline rate (low value) |");
    expect(table).toContain("| `advocate` | 0% (0/1) |");
  });
});

describe("runNegotiation (injected agent — no provider)", () => {
  const c = CASES[0];

  it("stops at the first terminal action and records the verdict", async () => {
    const script = [
      { action: "outreach", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } }, message: "hi" },
      { action: "accept", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } }, message: null },
      { action: "counter", assessment: { reasoning: "never reached", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } }, message: null },
    ];
    let i = 0;
    const agent = { invoke: async () => script[i++] };
    const res = await runNegotiation(c, "advocate", 1, 6, agent as never);
    expect(res.verdict).toBe("accepted");
    expect(res.turns.length).toBe(2);
    expect(res.refusedAtTurnZero).toBe(false);
  });

  it("records a turn-0 withdraw as a decline — reachable only after the IND-611 prerequisite", async () => {
    const agent = {
      invoke: async () => ({
        action: "withdraw",
        assessment: { reasoning: "not a fit", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
        message: null,
      }),
    };
    const res = await runNegotiation(c, "skeptic", 1, 6, agent as never);
    expect(res.refusedAtTurnZero).toBe(true);
    expect(res.verdict).toBe("declined");
    expect(res.turns.length).toBe(1);
  });

  it("stalls at the turn cap when no terminal action arrives", async () => {
    const agent = {
      invoke: async () => ({
        action: "counter",
        assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
        message: null,
      }),
    };
    const res = await runNegotiation(c, "advocate", 1, 4, agent as never);
    expect(res.verdict).toBe("stalled");
    expect(res.turns.length).toBe(4);
  });

  it("captures a provider failure as an errored run rather than throwing", async () => {
    const agent = { invoke: async () => { throw new Error("upstream 503"); } };
    const res = await runNegotiation(c, "advocate", 1, 6, agent as never);
    expect(res.error).toContain("upstream 503");
    expect(res.verdict).toBe("stalled");
  });

  it("alternates seats, initiator first, and scopes the discovery query to the source", async () => {
    const seen: Array<{ seat?: string; hasQuery: boolean }> = [];
    const queryCase = CASES.find((x) => x.discoveryQuery)!;
    const agent = {
      invoke: async (input: { seat?: string; discoveryQuery?: string }) => {
        seen.push({ seat: input.seat, hasQuery: input.discoveryQuery !== undefined });
        return { action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } }, message: null };
      },
    };
    await runNegotiation(queryCase, "advocate", 1, 4, agent as never);
    expect(seen.map((s) => s.seat)).toEqual(["initiator", "counterparty", "initiator", "counterparty"]);
    expect(seen.map((s) => s.hasQuery)).toEqual([true, false, true, false]);
  });
});
