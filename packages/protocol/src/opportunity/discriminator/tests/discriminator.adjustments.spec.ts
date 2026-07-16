import { describe, it, expect, afterEach } from "bun:test";

import { adjustedConfidence, buildPoolAdjustment, latestPoolDemotionDetail, mergePoolAdjustment, planPoolAdjustments, poolAdjustmentMultiplier, readPoolAdjustments, removePoolAdjustment } from "../discriminator.adjustments.js";
import type { PoolAdjustment } from "../discriminator.adjustments.js";
import type { QuestionPoolDiscriminator } from "../../../shared/schemas/question.schema.js";

const NOW = "2026-07-15T13:00:00.000Z";

function discriminator(overrides: Partial<QuestionPoolDiscriminator> = {}): QuestionPoolDiscriminator {
  return {
    label: "Hands-on builders vs advisors",
    questionSeed: "Which matters more?",
    sides: ["Hands-on builder", "Advisor"],
    sideCounts: { "Hands-on builder": 2, "Advisor": 1 },
    voi: 0.5,
    evidenceRate: 1,
    assignments: [
      { opportunityId: "opp-1", side: "Hands-on builder" },
      { opportunityId: "opp-2", side: "Advisor" },
      { opportunityId: "opp-3", side: "Hands-on builder" },
    ],
    ...overrides,
  };
}

function adjustment(overrides: Partial<PoolAdjustment> = {}): PoolAdjustment {
  return {
    questionId: "q-1",
    label: "axis",
    side: "A",
    factor: 0.6,
    appliedAt: NOW,
    ...overrides,
  };
}

describe("buildPoolAdjustment", () => {
  it("preserves exact chosen, other, and unknown P3 semantics", () => {
    expect(buildPoolAdjustment({ questionId: "q-1", label: "Style", assignedSide: "Hands-on", chosenSide: "Hands-on", appliedAt: NOW })).toEqual({
      adjustment: { questionId: "q-1", label: "Style", side: "Hands-on", factor: 1, appliedAt: NOW },
      signal: { type: "pool_discriminator", weight: 1, detail: "Style: Hands-on", questionId: "q-1" },
    });
    expect(buildPoolAdjustment({ questionId: "q-1", label: "Style", assignedSide: "Advisory", chosenSide: "Hands-on", appliedAt: NOW })).toEqual({
      adjustment: { questionId: "q-1", label: "Style", side: "Advisory", factor: 0.6, detail: "Style: you chose Hands-on", appliedAt: NOW },
      signal: { type: "pool_discriminator", weight: -1, detail: "Style: Hands-on", questionId: "q-1" },
    });
    expect(buildPoolAdjustment({ questionId: "q-1", label: "Style", assignedSide: null, chosenSide: "Hands-on", appliedAt: NOW })).toEqual({
      adjustment: { questionId: "q-1", label: "Style", side: "unknown", factor: 0.9, appliedAt: NOW },
      signal: { type: "pool_discriminator", weight: 0, detail: "Style: unassigned", questionId: "q-1" },
    });
  });
});

describe("planPoolAdjustments", () => {
  it("factors chosen side 1.0 and other side 0.6 with a demotion detail from the user's own words", () => {
    const plan = planPoolAdjustments(discriminator(), "Hands-on builder", "q-1", NOW);
    expect(plan).toHaveLength(3);
    const byId = new Map(plan.map((p) => [p.opportunityId, p.adjustment]));
    expect(byId.get("opp-1")).toMatchObject({ factor: 1, questionId: "q-1" });
    expect(byId.get("opp-1")?.detail).toBeUndefined();
    expect(byId.get("opp-2")).toMatchObject({
      factor: 0.6,
      detail: "Hands-on builders vs advisors: you chose Hands-on builder",
    });
    expect(byId.get("opp-3")?.factor).toBe(1);
    expect(plan.find((entry) => entry.opportunityId === "opp-2")?.signal).toEqual({
      type: "pool_discriminator",
      weight: -1,
      detail: "Hands-on builders vs advisors: Hands-on builder",
      questionId: "q-1",
    });
  });

  it("returns an empty plan for 'Both matter' (label not a side)", () => {
    expect(planPoolAdjustments(discriminator(), "Both matter", "q-1", NOW)).toEqual([]);
  });

  it("matches word-capped chip labels against longer side labels", () => {
    const d = discriminator({
      sides: ["one two three four five six", "Advisor"],
      assignments: [{ opportunityId: "opp-1", side: "one two three four five six" }],
    });
    // Chip label was capped at 5 words in synthesis.
    const plan = planPoolAdjustments(d, "one two three four five", "q-1", NOW);
    expect(plan).toHaveLength(1);
    expect(plan[0].adjustment.factor).toBe(1);
  });
});

describe("merge/remove/read", () => {
  it("merge replaces prior entries for the same questionId (re-answer)", () => {
    const m1 = mergePoolAdjustment({ other: true }, adjustment({ factor: 0.6 }));
    const m2 = mergePoolAdjustment(m1, adjustment({ factor: 1 }));
    const read = readPoolAdjustments(m2);
    expect(read).toHaveLength(1);
    expect(read[0].factor).toBe(1);
    expect(m2.other).toBe(true);
  });

  it("merge keeps entries from other questions", () => {
    const m1 = mergePoolAdjustment(undefined, adjustment({ questionId: "q-1" }));
    const m2 = mergePoolAdjustment(m1, adjustment({ questionId: "q-2" }));
    expect(readPoolAdjustments(m2)).toHaveLength(2);
  });

  it("remove deletes all entries for a questionId and preserves the rest", () => {
    const m = mergePoolAdjustment(mergePoolAdjustment(undefined, adjustment({ questionId: "q-1" })), adjustment({ questionId: "q-2" }));
    const removed = removePoolAdjustment(m, "q-1");
    expect(readPoolAdjustments(removed).map((a) => a.questionId)).toEqual(["q-2"]);
  });

  it("read tolerates malformed metadata", () => {
    expect(readPoolAdjustments(null)).toEqual([]);
    expect(readPoolAdjustments({ poolAdjustments: "junk" })).toEqual([]);
    expect(readPoolAdjustments({ poolAdjustments: [{ nonsense: 1 }] })).toEqual([]);
  });

  it("returns only the latest explainable demotion detail for card UI", () => {
    const metadata = {
      poolAdjustments: [
        adjustment({ questionId: "q-1", factor: 0.6, detail: "First: you chose A" }),
        adjustment({ questionId: "q-2", factor: 0.9 }),
        adjustment({ questionId: "q-3", factor: 0.6, detail: "Latest: you chose B" }),
      ],
    };
    expect(latestPoolDemotionDetail(metadata)).toBe("Latest: you chose B");
    expect(latestPoolDemotionDetail({})).toBeUndefined();
  });
});

describe("multiplier + adjustedConfidence", () => {
  const flag = process.env.POOL_QUESTIONS_RANKING;
  afterEach(() => {
    if (flag === undefined) delete process.env.POOL_QUESTIONS_RANKING;
    else process.env.POOL_QUESTIONS_RANKING = flag;
  });

  it("multiplies factors and floors at 0.3", () => {
    let m: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) m = mergePoolAdjustment(m, adjustment({ questionId: `q-${i}`, factor: 0.6 }));
    // 0.6^4 = 0.1296 → floored at 0.3
    expect(poolAdjustmentMultiplier(m)).toBe(0.3);
    expect(adjustedConfidence(0.9, m)).toBeCloseTo(0.27, 6);
  });

  it("returns 1 with no adjustments (raw confidence preserved)", () => {
    expect(poolAdjustmentMultiplier({})).toBe(1);
    expect(adjustedConfidence(0.87, null)).toBe(0.87);
  });

  it("ignores non-positive/invalid factors defensively", () => {
    const m = { poolAdjustments: [adjustment({ factor: Number.NaN }), adjustment({ questionId: "q-2", factor: 0.6 })] };
    expect(poolAdjustmentMultiplier(m)).toBeCloseTo(0.6, 6);
  });
});
