import { describe, expect, it } from "bun:test";

import { EVAL_ARTIFACT_SCHEMA_VERSION, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_LEGACY_UNAVAILABLE, EVAL_RUN_REPORT_ARTIFACT_TYPE, buildEvalArtifact, canonicalizeForFingerprint, fingerprintCanonicalJson, fingerprintEvalConfig, fingerprintEvalCorpus, looksLikeLegacyScorecard, migrateLegacyBaseline, parseEvalArtifact, readEvalGitProvenance } from "../artifact.js";
import { buildScorecard } from "../scorecard.js";
import type { CaseResultLike, ScorecardLike } from "../types.js";
import { TEST_REVISION, makeTestMeta } from "./artifact.fixtures.js";

const caseResult = (caseId: string, rule: string, passes: number, runs = 3): CaseResultLike => ({
  caseId,
  rule,
  runs,
  passes,
  passRate: passes / runs,
  flaky: passes > 0 && passes < runs,
});

const scorecard = (): ScorecardLike =>
  buildScorecard([caseResult("a", "g", 3), caseResult("b", "g", 1), caseResult("c", "h", 0)], {
    model: "test/model",
    runs: 3,
  });

const validEnvelope = () => buildEvalArtifact(EVAL_BASELINE_ARTIFACT_TYPE, scorecard(), makeTestMeta({ runs: 3 }));

describe("buildEvalArtifact + parseEvalArtifact", () => {
  it("round-trips a valid baseline envelope", () => {
    const envelope = validEnvelope();
    const parsed = parseEvalArtifact(envelope, {
      expectedType: EVAL_BASELINE_ARTIFACT_TYPE,
      expectedHarness: "test-harness",
    });
    expect(parsed.schemaVersion).toBe(EVAL_ARTIFACT_SCHEMA_VERSION);
    expect(parsed.payload.cases).toHaveLength(3);
    expect(parsed.completeness).toEqual({
      caseCount: 3,
      ruleCount: 2,
      totalRuns: 9,
      totalPasses: 4,
      flakyCaseCount: 1,
    });
  });

  it("rejects non-object values as corrupt", () => {
    expect(() => parseEvalArtifact("truncated…", { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/corrupt or truncated/);
    expect(() => parseEvalArtifact(null, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/corrupt or truncated/);
  });

  it("rejects legacy unversioned scorecards with a migration pointer", () => {
    expect(() => parseEvalArtifact(scorecard(), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/migrate-legacy-baselines.*never cast silently/s);
  });

  it("rejects incompatible artifact types", () => {
    const envelope = validEnvelope();
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE }))
      .toThrow(/Incompatible artifact type.*index-eval\/run-report.*index-eval\/baseline/);
  });

  it("rejects unknown schema versions with the supported version named", () => {
    const envelope = { ...validEnvelope(), schemaVersion: 999 };
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/schema version 999.*supports version 1/);
  });

  it("rejects a harness mismatch", () => {
    const envelope = validEnvelope();
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE, expectedHarness: "other" }))
      .toThrow(/belongs to harness "test-harness", expected "other"/);
  });

  it("rejects unknown envelope keys", () => {
    const envelope = { ...validEnvelope(), extraneous: true };
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
  });

  it("rejects malformed numbers (NaN, out-of-range rates, non-integers)", () => {
    const base = validEnvelope();
    const withCase = (patch: Partial<CaseResultLike>) => ({
      ...base,
      payload: {
        ...base.payload,
        cases: base.payload.cases.map((c, i) => (i === 0 ? { ...c, ...patch } : c)),
      },
    });
    expect(() => parseEvalArtifact(withCase({ passRate: Number.NaN }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
    expect(() => parseEvalArtifact(withCase({ passRate: 1.5 }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
    expect(() => parseEvalArtifact(withCase({ runs: 2.5 }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
    expect(() => parseEvalArtifact(withCase({ passes: -1 }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
  });

  it("rejects passes greater than runs", () => {
    const base = validEnvelope();
    const bad = {
      ...base,
      payload: { ...base.payload, cases: base.payload.cases.map((c, i) => (i === 0 ? { ...c, passes: 99 } : c)) },
    };
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/exceeds runs/);
  });

  it("rejects duplicate case ids and duplicate rule labels", () => {
    const base = validEnvelope();
    const dupCase = {
      ...base,
      payload: { ...base.payload, cases: [...base.payload.cases, base.payload.cases[0]] },
    };
    expect(() => parseEvalArtifact(dupCase, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/duplicate caseId/);
    const dupRule = {
      ...base,
      payload: { ...base.payload, rules: [...base.payload.rules, base.payload.rules[0]] },
    };
    expect(() => parseEvalArtifact(dupRule, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/duplicate rule|rules rollup/);
  });

  it("rejects inconsistent aggregate counts and rates", () => {
    const base = validEnvelope();
    const badAggregate = { ...base, payload: { ...base.payload, aggregatePassRate: 0.123 } };
    expect(() => parseEvalArtifact(badAggregate, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/aggregatePassRate is inconsistent/);
    const badRule = {
      ...base,
      payload: {
        ...base.payload,
        rules: base.payload.rules.map((r, i) => (i === 0 ? { ...r, passRate: 0.001 } : r)),
      },
    };
    expect(() => parseEvalArtifact(badRule, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/passRate is inconsistent with its member cases/);
    const badCompleteness = { ...base, completeness: { ...base.completeness, totalPasses: 123 } };
    expect(() => parseEvalArtifact(badCompleteness, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/completeness\.totalPasses/);
  });

  it("rejects inconsistent flaky flags", () => {
    const base = validEnvelope();
    const bad = {
      ...base,
      payload: { ...base.payload, cases: base.payload.cases.map((c, i) => (i === 0 ? { ...c, flaky: true } : c)) },
    };
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/flaky flag is inconsistent/);
  });

  it("rejects non-monotonic timestamps", () => {
    const base = validEnvelope();
    const bad = { ...base, startedAt: "2026-02-01T00:00:00.000Z" }; // after completedAt
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/startedAt <= completedAt <= createdAt/);
  });

  it("rejects legacy fingerprint sentinels on run-sourced artifacts", () => {
    const base = validEnvelope();
    const bad = { ...base, corpusFingerprint: EVAL_LEGACY_UNAVAILABLE };
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/only valid for source "legacy-migration"/);
  });

  it("rejects an envelope/payload run-count mismatch and duplicate models", () => {
    const base = validEnvelope();
    expect(() => parseEvalArtifact({ ...base, runs: 7 }, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/envelope runs \(7\) != payload runs \(3\)/);
    expect(() => parseEvalArtifact({ ...base, models: ["m", "m"] }, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/duplicate model IDs/);
  });

  it("rejects selection filters on full-corpus artifacts", () => {
    expect(() =>
      buildEvalArtifact(EVAL_BASELINE_ARTIFACT_TYPE, scorecard(), makeTestMeta({
        runs: 3,
        selection: { fullCorpus: true, filters: { rule: "g" } },
      })),
    ).toThrow(/must not carry selection filters/);
  });

  it("derives completeness from the payload rather than trusting the caller", () => {
    const envelope = validEnvelope();
    expect(envelope.completeness.totalRuns).toBe(9);
    expect(envelope.completeness.flakyCaseCount).toBe(1);
  });
});

describe("fingerprints", () => {
  it("is independent of key order", () => {
    expect(fingerprintCanonicalJson({ a: 1, b: [{ x: 1, y: 2 }] }))
      .toBe(fingerprintCanonicalJson({ b: [{ y: 2, x: 1 }], a: 1 }));
  });

  it("is sensitive to array order and values", () => {
    expect(fingerprintCanonicalJson([1, 2])).not.toBe(fingerprintCanonicalJson([2, 1]));
    expect(fingerprintCanonicalJson({ a: 1 })).not.toBe(fingerprintCanonicalJson({ a: 2 }));
  });

  it("treats undefined values and functions as absent", () => {
    expect(fingerprintCanonicalJson({ a: 1, b: undefined, f: () => 1 })).toBe(fingerprintCanonicalJson({ a: 1 }));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeForFingerprint({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("fingerprints a corpus deterministically", () => {
    const corpus = [{ id: "case-1", input: "x" }, { id: "case-2", input: "y" }];
    expect(fingerprintEvalCorpus(corpus)).toBe(fingerprintEvalCorpus([...corpus]));
    expect(fingerprintEvalCorpus(corpus)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses secret-like keys in config fingerprints", () => {
    expect(() => fingerprintEvalConfig({ runs: 3, apiKey: "sk-nope" })).toThrow(/secret-like key/);
    expect(() => fingerprintEvalConfig({ nested: { OPENROUTER_API_KEY: "x" } })).toThrow(/secret-like key/);
    expect(fingerprintEvalConfig({ runs: 3, alpha: 0.05 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("readEvalGitProvenance", () => {
  it("reads a clean revision deterministically via the injected runner", () => {
    const git = readEvalGitProvenance("/repo", (args) => (args[0] === "rev-parse" ? TEST_REVISION : ""));
    expect(git).toEqual({ revision: TEST_REVISION, dirty: false });
  });

  it("marks dirty worktrees", () => {
    const git = readEvalGitProvenance("/repo", (args) => (args[0] === "rev-parse" ? TEST_REVISION : " M file.ts"));
    expect(git).toEqual({ revision: TEST_REVISION, dirty: true });
  });

  it("falls back to unknown when git is unavailable", () => {
    const git = readEvalGitProvenance("/repo", () => {
      throw new Error("no git");
    });
    expect(git).toEqual({ revision: "unknown", dirty: null });
  });

  it("rejects non-revision output", () => {
    const git = readEvalGitProvenance("/repo", () => "not-a-hash");
    expect(git).toEqual({ revision: "unknown", dirty: null });
  });
});

describe("migrateLegacyBaseline", () => {
  it("preserves the legacy payload value-for-value with explicit sentinels", () => {
    const legacy = scorecard();
    const envelope = migrateLegacyBaseline(JSON.parse(JSON.stringify(legacy)), {
      harness: "test-harness",
      harnessVersion: "1",
    });
    expect(envelope.source).toBe("legacy-migration");
    expect(envelope.corpusFingerprint).toBe(EVAL_LEGACY_UNAVAILABLE);
    expect(envelope.configFingerprint).toBe(EVAL_LEGACY_UNAVAILABLE);
    expect(envelope.git).toEqual({ revision: "unknown", dirty: null });
    expect(envelope.createdAt).toBe(legacy.generatedAt);
    expect(JSON.parse(JSON.stringify(envelope.payload))).toEqual(JSON.parse(JSON.stringify(legacy)));
  });

  it("splits legacy multi-model strings into unique model ids", () => {
    const legacy = { ...scorecard(), model: "provider/a / provider/a" };
    const envelope = migrateLegacyBaseline(JSON.parse(JSON.stringify(legacy)), {
      harness: "test-harness",
      harnessVersion: "1",
    });
    expect(envelope.models).toEqual(["provider/a"]);
  });

  it("refuses non-legacy input", () => {
    expect(() => migrateLegacyBaseline(validEnvelope(), { harness: "h", harnessVersion: "1" }))
      .toThrow(/not a legacy unversioned scorecard/);
  });

  it("refuses an internally inconsistent legacy scorecard", () => {
    const legacy = scorecard();
    const bad = { ...legacy, cases: legacy.cases.map((c, i) => (i === 0 ? { ...c, passRate: 0.5 } : c)) };
    expect(() => migrateLegacyBaseline(JSON.parse(JSON.stringify(bad)), { harness: "h", harnessVersion: "1" }))
      .toThrow(/inconsistent|Invalid eval artifact/);
  });

  it("detects legacy scorecards structurally", () => {
    expect(looksLikeLegacyScorecard(scorecard())).toBe(true);
    expect(looksLikeLegacyScorecard(validEnvelope())).toBe(false);
    expect(looksLikeLegacyScorecard("nope")).toBe(false);
  });
});
