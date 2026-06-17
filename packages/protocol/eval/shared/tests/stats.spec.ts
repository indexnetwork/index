import { describe, it, expect } from "bun:test";

import { binomialCI, binomialPValue, binomialSignificance, predictivePValue, mean, rateWithCI } from "../stats.js";

describe("binomialCI", () => {
  it("returns [0,1] when total is zero", () => {
    const [lo, hi] = binomialCI(0, 0);
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });

  it("centres on 0.5 for 1/2 with wide CI", () => {
    const [lo] = binomialCI(1, 2);
    expect(lo).toBeLessThan(0.16);
    expect(lo).toBeGreaterThan(0);
  });

  it("tightens dramatically as n grows — lower bound lifts", () => {
    const [lo3, hi3] = binomialCI(3, 3);
    const [lo7, hi7] = binomialCI(7, 7);
    expect(hi3).toBe(1);
    expect(hi7).toBe(1);
    expect(lo7).toBeGreaterThan(lo3);
    expect(lo3).toBeLessThan(0.5);
  });

  it("is symmetric within rounding for moderate p", () => {
    const [lo, hi] = binomialCI(21, 30); // 70%
    const spread = hi - lo;
    expect(spread).toBeGreaterThan(0.2);
    expect(spread).toBeLessThan(0.5);
  });
});

describe("binomial / predictive p-values", () => {
  it("returns interpretable p-values", () => {
    expect(binomialPValue(2, 7, 0.8)).toBeCloseTo(0.00467, 3);
    expect(binomialPValue(5, 7, 0.8)).toBeGreaterThan(0.4);
  });

  it("does not flag when the baseline is zero", () => {
    expect(binomialPValue(0, 7, 0)).toBe(1);
    expect(binomialSignificance(0, 7, 0, 0.05)).toBe(false);
  });

  it("flags any miss against a perfect point-null baseline", () => {
    expect(binomialPValue(6, 7, 1)).toBe(0);
    expect(binomialSignificance(6, 7, 1, 0.05)).toBe(true);
  });

  it("does not flag perfect current performance against a perfect baseline", () => {
    expect(binomialSignificance(7, 7, 1, 0.05)).toBe(false);
  });

  it("posterior predictive accounts for baseline uncertainty", () => {
    // Point-null treats 6/7 after a 7/7 baseline as impossible; predictive treats it as plausible noise.
    expect(binomialPValue(6, 7, 1)).toBe(0);
    expect(predictivePValue(6, 7, 7, 7)).toBeGreaterThan(0.05);
  });

  it("returns 1 for degenerate run counts", () => {
    expect(predictivePValue(0, 0, 7, 7)).toBe(1);
    expect(predictivePValue(5, 7, 0, 0)).toBe(1);
  });
});

describe("mean / rateWithCI", () => {
  it("mean is 0 for empty and averages otherwise", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 0, 1])).toBeCloseTo(2 / 3, 5);
  });

  it("rateWithCI is n/a for zero total and a percent+CI otherwise", () => {
    expect(rateWithCI(0, 0)).toBe("n/a");
    expect(rateWithCI(7, 7)).toContain("100%");
    expect(rateWithCI(7, 7)).toContain("CI₉₅");
  });
});
