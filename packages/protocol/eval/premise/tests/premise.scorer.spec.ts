import { describe, it, expect } from "bun:test";

import { scoreRun, scoreCase, type Judge } from "../premise.scorer.js";
import type { AnalyzeCase, DecomposeCase, PremiseRunDetail } from "../premise.types.js";

const yes: Judge = async () => true;
const no: Judge = async () => false;

const decompose = (expect: DecomposeCase["expect"]): DecomposeCase => ({
  id: "d/case",
  rule: "atomicity",
  tier: 1,
  component: "decompose",
  description: "synthetic",
  input: "x",
  expect,
});

const analyze = (expect: AnalyzeCase["expect"]): AnalyzeCase => ({
  id: "a/case",
  rule: "speech_act",
  tier: 1,
  component: "analyze",
  description: "synthetic",
  input: "x",
  expect,
});

const dDetail = (premises: { text: string; tier: "assertive" | "contextual" }[]): PremiseRunDetail => ({
  component: "decompose",
  reasoning: "r",
  premises,
});

const aDetail = (over: Partial<PremiseRunDetail>): PremiseRunDetail => ({
  component: "analyze",
  reasoning: "r",
  speechActType: "DECLARATIVE",
  felicity: { authority: 80, sincerity: 80, clarity: 80 },
  semanticEntropy: 0.2,
  ...over,
});

describe("scoreRun — decompose", () => {
  it("passes count, tier, and first-person checks", async () => {
    const c = decompose({ minPremises: 2, maxPremises: 3, minAssertive: 1, minContextual: 1 });
    const d = dDetail([
      { text: "I am a founder", tier: "assertive" },
      { text: "I am raising a Series A", tier: "contextual" },
    ]);
    const rr = await scoreRun(c, d, yes);
    expect(rr.passed).toBe(true);
    expect(rr.assertions.find((a) => a.kind === "count")!.passed).toBe(true);
    expect(rr.assertions.filter((a) => a.kind === "tier").every((a) => a.passed)).toBe(true);
    expect(rr.assertions.find((a) => a.kind === "first_person")!.passed).toBe(true);
  });

  it("fails count when over-split and flags non-first-person premises", async () => {
    const c = decompose({ minPremises: 1, maxPremises: 1 });
    const d = dDetail([
      { text: "I am a founder", tier: "assertive" },
      { text: "Works at Google", tier: "assertive" },
    ]);
    const rr = await scoreRun(c, d, yes);
    expect(rr.passed).toBe(false);
    expect(rr.assertions.find((a) => a.kind === "count")!.passed).toBe(false);
    expect(rr.assertions.find((a) => a.kind === "first_person")!.passed).toBe(false);
  });

  it("only checks emptiness for empty-input cases", async () => {
    const c = decompose({ expectEmpty: true });
    const empty = await scoreRun(c, dDetail([]), yes);
    expect(empty.passed).toBe(true);
    expect(empty.assertions).toHaveLength(1);
    const nonEmpty = await scoreRun(c, dDetail([{ text: "I am a founder", tier: "assertive" }]), yes);
    expect(nonEmpty.passed).toBe(false);
  });

  it("routes coverage and exclusion through the judge", async () => {
    const c = decompose({ minPremises: 1, mustCover: ["founder"], mustNotContain: "an intent" });
    const d = dDetail([{ text: "I am a founder", tier: "assertive" }]);
    expect((await scoreRun(c, d, yes)).passed).toBe(true);
    const failed = await scoreRun(c, d, no);
    expect(failed.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "coverage")!.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "exclusion")!.passed).toBe(false);
  });
});

describe("scoreRun — analyze", () => {
  it("passes speech-act and band checks within range", async () => {
    const c = analyze({ speechActType: "DECLARATIVE", clarityBand: [65, 100], entropyBand: [0, 0.45] });
    const rr = await scoreRun(c, aDetail({}), yes);
    expect(rr.passed).toBe(true);
  });

  it("fails when the band is missed", async () => {
    const c = analyze({ clarityBand: [65, 100] });
    const rr = await scoreRun(c, aDetail({ felicity: { authority: 80, sincerity: 80, clarity: 30 } }), yes);
    expect(rr.passed).toBe(false);
    expect(rr.assertions.find((a) => a.kind === "clarity")!.passed).toBe(false);
  });

  it("fails on wrong speech-act type", async () => {
    const c = analyze({ speechActType: "ASSERTIVE" });
    const rr = await scoreRun(c, aDetail({ speechActType: "DECLARATIVE" }), yes);
    expect(rr.assertions.find((a) => a.kind === "speech_act")!.passed).toBe(false);
  });
});

describe("scoreCase", () => {
  it("aggregates runs into pass-rate and flags flakiness", async () => {
    const c = analyze({ speechActType: "DECLARATIVE" });
    const result = await scoreCase(c, [aDetail({}), aDetail({ speechActType: "ASSERTIVE" })], yes);
    expect(result.runs).toBe(2);
    expect(result.passes).toBe(1);
    expect(result.flaky).toBe(true);
    expect(result.passRate).toBe(0.5);
  });
});
