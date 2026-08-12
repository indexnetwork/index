import { fingerprintCanonicalJson } from "../shared/index.js";

import { assertHistoricalResolvedConfig, type HistoricalResolvedConfig } from "./historical-quality.experiment.js";
import { HISTORICAL_SHARED_POOL_PLAN } from "./historical-quality.shared-pool.fixture.js";

export const HISTORICAL_QUALITY_PILOT_TRIGGERS = ["intent", "enrichment"] as const;
export type HistoricalQualityPilotTrigger = typeof HISTORICAL_QUALITY_PILOT_TRIGGERS[number];
export const HISTORICAL_QUALITY_PILOT_MAX_ATTEMPTS = 1;
export const HISTORICAL_QUALITY_PILOT_MAX_GRAPH_INVOCATIONS = 200;

const APPROVED_SHARED_POOL_CASE_IDS = new Set(
  HISTORICAL_SHARED_POOL_PLAN.cases.map(({ caseId }) => caseId),
);

export interface HistoricalQualityPilotConfiguration {
  id: "a";
  config: HistoricalResolvedConfig;
}

export interface HistoricalQualityPilotInput {
  caseIds: string[];
  triggers: HistoricalQualityPilotTrigger[];
  repetitions: number;
  configuration: HistoricalQualityPilotConfiguration;
}

export interface HistoricalQualityPilotSlot {
  slotId: string;
  caseId: string;
  trigger: HistoricalQualityPilotTrigger;
  repetition: number;
  selectedSide: "a";
  configurationFingerprint: string;
  maxAttempts: 1;
}

/** The only slot identity handed to a child; selection details stay parent-owned. */
export interface HistoricalQualityPilotChildSlot {
  slotId: string;
  configurationId: "a";
}

export interface HistoricalQualityPilotPlan {
  slots: HistoricalQualityPilotSlot[];
  childSlots: HistoricalQualityPilotChildSlot[];
  configurationFingerprint: string;
  graphInvocations: number;
  evaluatorCalls: number;
  maxAttempts: 1;
}

function assertPilotInput(input: HistoricalQualityPilotInput): void {
  if (Object.prototype.hasOwnProperty.call(input, "sides")) {
    throw new Error("Historical quality pilot does not accept comparison inputs");
  }
  if (input.caseIds.length === 0) throw new Error("Historical quality pilot requires at least one case");
  if (new Set(input.caseIds).size !== input.caseIds.length) {
    throw new Error("Historical quality pilot case IDs must be unique");
  }
  for (const caseId of input.caseIds) {
    if (!APPROVED_SHARED_POOL_CASE_IDS.has(caseId)) {
      throw new Error(`${caseId} is not an approved shared-pool case`);
    }
  }
  if (input.triggers.length === 0) throw new Error("Historical quality pilot requires at least one trigger");
  const seen = new Set<HistoricalQualityPilotTrigger>();
  for (const trigger of input.triggers) {
    if (!(HISTORICAL_QUALITY_PILOT_TRIGGERS as readonly string[]).includes(trigger)) {
      throw new Error(`Historical quality pilot has invalid trigger ${trigger}`);
    }
    if (seen.has(trigger)) throw new Error(`Historical quality pilot has duplicate trigger ${trigger}`);
    seen.add(trigger);
  }
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1) {
    throw new Error("Historical quality pilot repetitions must be a positive integer");
  }
  if (input.configuration.id !== "a") {
    throw new Error("Historical quality pilot configuration must be side a");
  }
  assertHistoricalResolvedConfig(input.configuration.config);
}

/**
 * Plans one independently measurable configuration without touching the
 * comparison-oriented historical experiment planner.
 */
export function buildHistoricalQualityPilotPlan(input: HistoricalQualityPilotInput): HistoricalQualityPilotPlan {
  assertPilotInput(input);
  const graphInvocations = input.caseIds.length * input.triggers.length * input.repetitions;
  if (graphInvocations > HISTORICAL_QUALITY_PILOT_MAX_GRAPH_INVOCATIONS) {
    throw new Error(`${graphInvocations} graph invocations exceeds hard cap ${HISTORICAL_QUALITY_PILOT_MAX_GRAPH_INVOCATIONS}`);
  }

  const configurationFingerprint = fingerprintCanonicalJson(input.configuration.config);
  const slots: HistoricalQualityPilotSlot[] = [];
  for (const caseId of input.caseIds) {
    for (const trigger of input.triggers) {
      for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
        const identity = { caseId, trigger, repetition, selectedSide: "a", configurationFingerprint } as const;
        slots.push({
          slotId: `hq-slot-${fingerprintCanonicalJson(identity)}`,
          ...identity,
          maxAttempts: HISTORICAL_QUALITY_PILOT_MAX_ATTEMPTS,
        });
      }
    }
  }

  return {
    slots,
    childSlots: slots.map(({ slotId }) => ({ slotId, configurationId: "a" })),
    configurationFingerprint,
    graphInvocations,
    evaluatorCalls: graphInvocations,
    maxAttempts: HISTORICAL_QUALITY_PILOT_MAX_ATTEMPTS,
  };
}
