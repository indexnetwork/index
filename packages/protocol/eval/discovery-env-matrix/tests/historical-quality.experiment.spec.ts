import { describe, expect, it } from "bun:test";
import { HISTORICAL_QUALITY_MAX_ATTEMPTS, buildHistoricalExperimentPlan, diffResolvedHistoricalConfigs } from "../historical-quality.experiment.js";

const fixed = {
  judgeModelId: "judge-v1",
  embeddingModelId: "embedding-v1",
  providerAccountFingerprint: "provider-account-a",
  corpusVersion: "historical-v2",
  scoringPolicyFingerprint: "scoring-v2",
};
const side = (id: "a" | "b", models: Record<string, string>, env: Record<string, string> = {}) => ({
  id,
  config: { models, env, fixed },
});

describe("historical experiment contract", () => {
  it("uses exactly one attempt and plans a full pair at 180 invocations", () => {
    expect(HISTORICAL_QUALITY_MAX_ATTEMPTS).toBe(1);
    const plan = buildHistoricalExperimentPlan({
      caseIds: Array.from({ length: 15 }, (_, index) => `case-${index + 1}`),
      triggers: ["intent", "enrichment"],
      repetitions: 3,
      sides: [
        side("a", { opportunityEvaluator: "model-a" }),
        side("b", { opportunityEvaluator: "model-b" }),
      ],
      mode: "ordinary",
    });
    expect(plan.graphInvocations).toBe(180);
    expect(plan.maxAttempts).toBe(1);
    expect(plan.slots).toHaveLength(180);
    expect(plan.slots[0]).toMatchObject({ caseId: "case-1", trigger: "intent", repetition: 0, sideId: "a", attempt: 1 });
  });

  it("refuses an attempt ceiling above 200", () => {
    expect(() => buildHistoricalExperimentPlan({
      caseIds: Array.from({ length: 17 }, (_, index) => `case-${index + 1}`),
      triggers: ["intent", "enrichment"],
      repetitions: 3,
      sides: [side("a", { opportunityEvaluator: "model-a" }), side("b", { opportunityEvaluator: "model-b" })],
      mode: "ordinary",
    })).toThrow(/204 graph invocations exceeds hard cap 200/);
  });

  it("accepts exactly one resolved model or env difference and rejects multiple factors", () => {
    expect(diffResolvedHistoricalConfigs(
      side("a", { opportunityEvaluator: "model-a" }).config,
      side("b", { opportunityEvaluator: "model-b" }).config,
    )).toEqual([{ kind: "model", key: "opportunityEvaluator", a: "model-a", b: "model-b" }]);

    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"],
      triggers: ["intent"],
      repetitions: 1,
      sides: [
        side("a", { opportunityEvaluator: "model-a" }, { DISCOVERY_ALLOWED_TYPES: "intent" }),
        side("b", { opportunityEvaluator: "model-b" }, { DISCOVERY_ALLOWED_TYPES: "intent,profile" }),
      ],
      mode: "ordinary",
    })).toThrow(/ordinary comparison requires exactly one resolved factor difference/);
  });

  it("holds judge, embedding, provider, corpus, and scoring resources equal", () => {
    const b = side("b", { opportunityEvaluator: "model-b" });
    b.config.fixed = { ...fixed, judgeModelId: "judge-v2" };
    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [side("a", { opportunityEvaluator: "model-a" }), b], mode: "ordinary",
    })).toThrow(/judgeModelId must be equal/);
  });

  it("rejects duplicate triggers, asymmetric resolved maps, and credential keys", () => {
    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent", "intent"], repetitions: 1,
      sides: [side("a", { opportunityEvaluator: "model-a" })], mode: "ordinary",
    })).toThrow(/duplicate trigger intent/);

    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [
        side("a", { opportunityEvaluator: "model-a", lensInferrer: "model-lens" }),
        side("b", { opportunityEvaluator: "model-b" }),
      ],
      mode: "ordinary",
    })).toThrow(/model key sets must be equal/);

    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [side("a", { opportunityEvaluator: "model-a" }, { OPENROUTER_API_KEY: "secret" })], mode: "ordinary",
    })).toThrow(/credential key OPENROUTER_API_KEY/);
  });

  it("allows labelled exploratory multi-factor plans without a causal claim", () => {
    const plan = buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [
        side("a", { opportunityEvaluator: "model-a" }, { DISCOVERY_ALLOWED_TYPES: "intent" }),
        side("b", { opportunityEvaluator: "model-b" }, { DISCOVERY_ALLOWED_TYPES: "intent,profile" }),
      ],
      mode: "exploratory",
    });
    expect(plan.factorDifferences).toHaveLength(2);
    expect(plan.causalClaimAllowed).toBe(false);
  });
});
