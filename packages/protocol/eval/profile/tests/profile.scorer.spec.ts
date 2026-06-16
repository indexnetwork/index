import { describe, it, expect } from "bun:test";

import { scoreRun, scoreCase, type Judge } from "../profile.scorer.js";
import type { ProfileCase, ProfileRunDetail } from "../profile.types.js";

const yes: Judge = async () => true;
const no: Judge = async () => false;

const mkCase = (expect: ProfileCase["expect"], rule: ProfileCase["rule"] = "extraction"): ProfileCase => ({
  id: "p/case",
  rule,
  tier: 1,
  description: "synthetic",
  input: "x",
  expect,
});

const detail = (over: Partial<ProfileRunDetail> = {}): ProfileRunDetail => ({
  name: "Ada Lovelace",
  bio: "Mathematician and writer.",
  location: "London, UK",
  context: "Ada works on analytical engines.",
  interests: ["computing", "poetry"],
  skills: ["mathematics", "logic"],
  piiHits: [],
  ...over,
});

describe("scoreRun — deterministic", () => {
  it("passes name, location, skills, interests, and privacy checks", async () => {
    const c = mkCase({ expectNameContains: "Ada", expectLocationContains: "London", minSkills: 2, minInterests: 2 });
    const rr = await scoreRun(c, detail(), yes);
    expect(rr.passed).toBe(true);
    expect(rr.assertions.find((a) => a.kind === "privacy")!.passed).toBe(true);
  });

  it("fails the privacy check when PII leaks into a public field", async () => {
    const c = mkCase({ expectNameContains: "Ada" }, "privacy");
    const rr = await scoreRun(c, detail({ piiHits: ["john@acme.com"] }), yes);
    expect(rr.passed).toBe(false);
    const privacy = rr.assertions.find((a) => a.kind === "privacy")!;
    expect(privacy.passed).toBe(false);
    expect(privacy.detail).toContain("john@acme.com");
  });

  it("asserts privacy by default even when noPII is unset", async () => {
    const c = mkCase({});
    const rr = await scoreRun(c, detail({ piiHits: ["+1 415-555-0199"] }), yes);
    expect(rr.assertions.some((a) => a.kind === "privacy")).toBe(true);
    expect(rr.passed).toBe(false);
  });

  it("can opt out of the privacy check with noPII:false", async () => {
    const c = mkCase({ noPII: false });
    const rr = await scoreRun(c, detail({ piiHits: ["leak@x.com"] }), yes);
    expect(rr.assertions.some((a) => a.kind === "privacy")).toBe(false);
    expect(rr.passed).toBe(true);
  });

  it("fails name and location mismatches", async () => {
    const c = mkCase({ expectNameContains: "Grace", expectLocationContains: "Paris" });
    const rr = await scoreRun(c, detail(), yes);
    expect(rr.assertions.find((a) => a.kind === "name")!.passed).toBe(false);
    expect(rr.assertions.find((a) => a.kind === "location")!.passed).toBe(false);
  });
});

describe("scoreRun — judged", () => {
  it("routes coverage, apply, and preserve through the judge", async () => {
    const c = mkCase({ mustHaveSkills: ["mathematics"], mustApply: "x", mustPreserve: "y" }, "update");
    expect((await scoreRun(c, detail(), yes)).passed).toBe(true);
    const failed = await scoreRun(c, detail(), no);
    expect(failed.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "coverage_skills")!.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "apply")!.passed).toBe(false);
    expect(failed.assertions.find((a) => a.kind === "preserve")!.passed).toBe(false);
  });
});

describe("scoreCase", () => {
  it("aggregates runs into pass-rate and flags flakiness", async () => {
    const c = mkCase({ expectNameContains: "Ada" });
    const result = await scoreCase(c, [detail(), detail({ name: "Someone Else" })], yes);
    expect(result.runs).toBe(2);
    expect(result.passes).toBe(1);
    expect(result.flaky).toBe(true);
  });
});
