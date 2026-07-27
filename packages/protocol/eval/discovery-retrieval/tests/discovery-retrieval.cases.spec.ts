import { describe, expect, it } from "bun:test";

import { CASES, validateCorpus } from "../discovery-retrieval.cases.js";

describe("discovery retrieval corpus", () => {
  it("has 6–8 unique Tier-1 cases and validates every paired representation", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.length).toBeLessThanOrEqual(8);
    expect(() => validateCorpus(CASES)).not.toThrow();
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(c.tier).toBe(1);
      expect(c.candidates.every((p) => p.premises.length > 0 && p.userContext.length > 0)).toBe(true);
      expect(c.expect.expectedUserIds.length).toBeGreaterThan(0);
    }
  });

  it("rejects an expected candidate absent from the paired candidate pool", () => {
    expect(() => validateCorpus([{ ...CASES[0]!, expect: { ...CASES[0]!.expect, expectedUserIds: ["missing"] } }])).toThrow("expectedUserIds");
  });

  it("covers every required retrieval rule", () => {
    expect(new Set(CASES.map((c) => c.rule))).toEqual(
      new Set(["complementary_role", "same_side_exclusion", "location_constraint", "organization_constraint", "compressed_context", "premise_distractor"]),
    );
  });
});
