import { describe, expect, it } from "bun:test";

import { DISCOVERY_ENV_KEYS } from "../../ops/ops.allowlist.js";
import { fingerprintCanonicalJson } from "../../shared/index.js";
import { buildHistoricalQualityPilotPlan, type HistoricalQualityPilotInput } from "../historical-quality.pilot.js";
import { HISTORICAL_SHARED_POOL_PLAN } from "../historical-quality.shared-pool.fixture.js";

const approvedCaseIds = HISTORICAL_SHARED_POOL_PLAN.cases.map(({ caseId }) => caseId);
const resolvedConfig = {
  models: { opportunityEvaluator: "model-a", lensInferrer: "lens-a" },
  env: { DISCOVERY_ALLOWED_TYPES: "intent,profile" },
  fixed: {
    judgeModelId: "judge-v1",
    embeddingModelId: "embedding-v1",
    providerAccountFingerprint: "provider-account-a",
    corpusVersion: "historical-shared-pool-v1",
    scoringPolicyFingerprint: "scoring-v2",
  },
};
const input = (overrides: Partial<HistoricalQualityPilotInput> = {}): HistoricalQualityPilotInput => ({
  caseIds: approvedCaseIds,
  triggers: ["intent", "enrichment"],
  repetitions: 1,
  configuration: { id: "a", config: resolvedConfig },
  ...overrides,
});

describe("historical quality pilot planner", () => {
  it("plans the approved five-case corpus at exactly 10 invocations for one repetition", () => {
    const plan = buildHistoricalQualityPilotPlan(input());
    expect(plan.slots).toHaveLength(10);
    expect(plan.graphInvocations).toBe(10);
    expect(plan.evaluatorCalls).toBe(10);
    expect(plan.maxAttempts).toBe(1);
  });

  it("accepts a generated discovery env key", () => {
    expect(DISCOVERY_ENV_KEYS).toContain("NEGOTIATOR_STANCE");
    expect(() => buildHistoricalQualityPilotPlan(input({
      configuration: {
        id: "a",
        config: { ...resolvedConfig, env: { NEGOTIATOR_STANCE: "balanced" } },
      },
    }))).not.toThrow();
  });

  it.each([
    ["one case", approvedCaseIds.slice(0, 1)],
    ["a subset", approvedCaseIds.slice(1, 4)],
    ["all five cases", approvedCaseIds],
  ])("accepts %s from the approved shared pool", (_label, caseIds) => {
    const plan = buildHistoricalQualityPilotPlan(input({ caseIds, triggers: ["intent"] }));
    expect(plan.slots.map((slot) => slot.caseId)).toEqual(caseIds);
  });

  it("plans exactly 30 graph and evaluator calls at the default three repetitions", () => {
    const plan = buildHistoricalQualityPilotPlan(input({ repetitions: 3 }));
    expect(plan.slots).toHaveLength(30);
    expect(plan.graphInvocations).toBe(30);
    expect(plan.evaluatorCalls).toBe(30);
  });

  it("orders slots case then trigger then repetition", () => {
    const plan = buildHistoricalQualityPilotPlan(input({ caseIds: approvedCaseIds.slice(0, 2), repetitions: 2 }));
    expect(plan.slots.map(({ caseId, trigger, repetition }) => `${caseId}/${trigger}/r${repetition}`)).toEqual([
      `${approvedCaseIds[0]}/intent/r0`,
      `${approvedCaseIds[0]}/intent/r1`,
      `${approvedCaseIds[0]}/enrichment/r0`,
      `${approvedCaseIds[0]}/enrichment/r1`,
      `${approvedCaseIds[1]}/intent/r0`,
      `${approvedCaseIds[1]}/intent/r1`,
      `${approvedCaseIds[1]}/enrichment/r0`,
      `${approvedCaseIds[1]}/enrichment/r1`,
    ]);
  });

  it("uses unique opaque IDs, side a, one attempt, and one stable configuration fingerprint", () => {
    const plan = buildHistoricalQualityPilotPlan(input());
    expect(new Set(plan.slots.map((slot) => slot.slotId)).size).toBe(10);
    expect(plan.slots.every((slot) => /^hq-slot-[a-f0-9]{64}$/.test(slot.slotId))).toBe(true);
    expect(plan.slots.every((slot) => slot.selectedSide === "a" && slot.maxAttempts === 1)).toBe(true);
    expect(new Set(plan.slots.map((slot) => slot.configurationFingerprint))).toEqual(new Set([plan.configurationFingerprint]));
    expect(plan.configurationFingerprint).toBe(fingerprintCanonicalJson(resolvedConfig));
    expect(plan.childSlots).toEqual(plan.slots.map((slot) => ({ slotId: slot.slotId, configurationId: "a" })));
    expect(Object.keys(plan.childSlots[0]!).sort()).toEqual(["configurationId", "slotId"]);

    const reordered = {
      fixed: { ...resolvedConfig.fixed },
      env: { ...resolvedConfig.env },
      models: { lensInferrer: "lens-a", opportunityEvaluator: "model-a" },
    };
    expect(buildHistoricalQualityPilotPlan(input({ configuration: { id: "a", config: reordered } })).configurationFingerprint)
      .toBe(plan.configurationFingerprint);
  });

  it("binds each slot ID to its canonical slot identity", () => {
    const plan = buildHistoricalQualityPilotPlan(input({ caseIds: [approvedCaseIds[0]!], triggers: ["intent"], repetitions: 1 }));
    const slot = plan.slots[0]!;
    expect(slot.slotId).toBe(`hq-slot-${fingerprintCanonicalJson({
      caseId: approvedCaseIds[0],
      trigger: "intent",
      repetition: 0,
      selectedSide: "a",
      configurationFingerprint: plan.configurationFingerprint,
    })}`);
  });

  it.each([
    [input({ caseIds: [] }), /requires at least one case/],
    [input({ caseIds: [approvedCaseIds[0]!, approvedCaseIds[0]!] }), /case IDs must be unique/],
    [input({ caseIds: ["historical/not-approved"] }), /not an approved shared-pool case/],
    [input({ caseIds: [...approvedCaseIds, "historical/sixth-case"] }), /not an approved shared-pool case/],
    [input({ triggers: [] }), /requires at least one trigger/],
    [input({ triggers: ["intent", "intent"] }), /duplicate trigger intent/],
    [input({ triggers: ["invalid" as "intent"] }), /invalid trigger invalid/],
    [input({ repetitions: 0 }), /positive integer/],
    [input({ repetitions: 1.5 }), /positive integer/],
    [input({ configuration: { id: "b" as "a", config: resolvedConfig } }), /configuration must be side a/],
    [{ ...input(), sides: [{ id: "a", config: resolvedConfig }, { id: "b", config: resolvedConfig }] } as HistoricalQualityPilotInput, /does not accept comparison inputs/],
    [input({ caseIds: [approvedCaseIds[0]!], triggers: ["intent"], repetitions: 201 }), /201 graph invocations exceeds hard cap 200/],
  ])("rejects an invalid pilot shape", (value, expected) => {
    expect(() => buildHistoricalQualityPilotPlan(value)).toThrow(expected);
  });

  it.each([
    ["EVAL_MODEL_OVERRIDES", { ...resolvedConfig, env: { EVAL_MODEL_OVERRIDES: '{"opportunityEvaluator":"model-a"}' } }, /EVAL_MODEL_OVERRIDES.*resolved models map/],
    ["credential env key", { ...resolvedConfig, env: { OPENROUTER_API_KEY: "secret" } }, /credential key OPENROUTER_API_KEY/],
    ["unknown env key", { ...resolvedConfig, env: { HISTORICAL_UNKNOWN_FLAG: "value" } }, /resolved env key HISTORICAL_UNKNOWN_FLAG is not allowed for discovery/],
    ["non-discovery env key", { ...resolvedConfig, env: { SMARTEST_VERIFIER_MODEL: "model-a" } }, /resolved env key SMARTEST_VERIFIER_MODEL is not allowed for discovery/],
    ["blank model key", { ...resolvedConfig, models: { " ": "model-a" } }, /model assignments must be non-empty/],
    ["blank model value", { ...resolvedConfig, models: { opportunityEvaluator: " " } }, /model assignments must be non-empty/],
    ["blank env value", { ...resolvedConfig, env: { DISCOVERY_ALLOWED_TYPES: " " } }, /resolved env DISCOVERY_ALLOWED_TYPES must be non-empty/],
    ...Object.keys(resolvedConfig.fixed).map((key) => [
      `blank fixed ${key}`,
      { ...resolvedConfig, fixed: { ...resolvedConfig.fixed, [key]: " " } },
      new RegExp(`fixed resource ${key} must be non-empty`),
    ] as const),
  ])("rejects an invalid resolved config: %s", (_label, config, expected) => {
    expect(() => buildHistoricalQualityPilotPlan(input({
      configuration: { id: "a", config },
    }))).toThrow(expected);
  });
});
