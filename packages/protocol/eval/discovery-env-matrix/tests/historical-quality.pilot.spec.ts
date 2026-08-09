import { describe, expect, it } from "bun:test";

import { HISTORICAL_QUALITY_CASES } from "../../matching/matching.historical.js";
import { fingerprintCanonicalJson } from "../../shared/index.js";
import { buildHistoricalQualityPilotPlan, type HistoricalQualityPilotInput } from "../historical-quality.pilot.js";

const approvedCaseIds = HISTORICAL_QUALITY_CASES.map((historicalCase) => historicalCase.id);
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
});
