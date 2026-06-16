import { describe, it, expect } from "bun:test";

import { scoreRun, scoreCase, type Judge } from "../opportunity.scorer.js";
import type { OpportunityCase, OpportunityRunDetail } from "../opportunity.types.js";

const yes: Judge = async () => true;
const no: Judge = async () => false;

const mkCase = (expect: OpportunityCase["expect"], rule: OpportunityCase["rule"] = "viewer_voice"): OpportunityCase => ({
  id: "o/case",
  rule,
  tier: 1,
  description: "synthetic",
  input: {
    viewerContext: "v",
    otherPartyContext: "o",
    matchReasoning: "m",
    category: "peer",
    confidence: 0.8,
    signalsSummary: "s",
    indexName: "i",
    viewerRole: "party",
  },
  expect,
});

const detail = (over: Partial<OpportunityRunDetail> = {}): OpportunityRunDetail => ({
  headline: "A great connection",
  personalizedSummary: "You should meet them because your goals align.",
  suggestedAction: "Send a quick note.",
  greeting: "Saw we're both building climate tooling — would love to compare notes.",
  leaks: [],
  ...over,
});

describe("scoreRun — deterministic", () => {
  it("passes voice, leakage, and non-empty by default; greeting checks are opt-in", async () => {
    const rr = await scoreRun(mkCase({}), detail(), yes);
    expect(rr.passed).toBe(true);
    expect(rr.assertions.find((a) => a.kind === "voice")!.passed).toBe(true);
    expect(rr.assertions.find((a) => a.kind === "uuid")!.passed).toBe(true);
    expect(rr.assertions.some((a) => a.kind === "greeting_format")).toBe(false); // off unless greetingClean
    const withGreeting = await scoreRun(mkCase({ greetingClean: true }), detail(), yes);
    expect(withGreeting.assertions.find((a) => a.kind === "greeting_format")!.passed).toBe(true);
  });

  it("fails when the summary never addresses the viewer", async () => {
    const rr = await scoreRun(mkCase({}), detail({ personalizedSummary: "The two people share a focus on climate." }), yes);
    expect(rr.assertions.find((a) => a.kind === "voice")!.passed).toBe(false);
    expect(rr.passed).toBe(false);
  });

  it("fails on a leaked UUID in any field", async () => {
    const d = detail({ headline: "Meet 5f0a2c14-6b3e-4f9a-8c21-9d7e1b2a4c6f" });
    const rr = await scoreRun(mkCase({}), d, yes);
    expect(rr.assertions.find((a) => a.kind === "uuid")!.passed).toBe(false);
  });

  it("fails an opt-in greeting with a salutation prefix or markdown", async () => {
    const prefix = await scoreRun(mkCase({ greetingClean: true }), detail({ greeting: "Hey Sam, great to connect!" }), yes);
    expect(prefix.assertions.find((a) => a.kind === "greeting_format")!.passed).toBe(false);
    const md = await scoreRun(mkCase({ greetingClean: true }), detail({ greeting: "**Loved** your work." }), yes);
    expect(md.assertions.find((a) => a.kind === "greeting_format")!.passed).toBe(false);
  });

  it("skips greeting checks when opt-in but the greeting is empty", async () => {
    const rr = await scoreRun(mkCase({ greetingClean: true }), detail({ greeting: "" }), yes);
    expect(rr.assertions.some((a) => a.kind === "greeting_format")).toBe(false);
    expect(rr.passed).toBe(true);
  });

  it("can opt out of leakage and voice checks", async () => {
    const rr = await scoreRun(mkCase({ noLeakage: false, secondPerson: false }), detail({ personalizedSummary: "no second person", headline: "intentId leak" }), yes);
    expect(rr.assertions.some((a) => a.kind === "uuid" || a.kind === "label" || a.kind === "voice")).toBe(false);
  });
});

describe("scoreRun — judged", () => {
  it("routes grounding, framing, and tone through the judge", async () => {
    const c = mkCase({ mustReference: "x", framingCriteria: "y", toneCriteria: "z" }, "introducer_role");
    expect((await scoreRun(c, detail(), yes)).passed).toBe(true);
    const failed = await scoreRun(c, detail(), no);
    expect(failed.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "grounding")!.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "framing")!.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "tone")!.passed).toBe(false);
  });
});

describe("scoreCase", () => {
  it("aggregates runs into pass-rate and flags flakiness", async () => {
    const c = mkCase({});
    const result = await scoreCase(c, [detail(), detail({ personalizedSummary: "no viewer voice here" })], yes);
    expect(result.runs).toBe(2);
    expect(result.passes).toBe(1);
    expect(result.flaky).toBe(true);
  });
});
