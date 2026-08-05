import { isCredentialEnvKey } from "../ops/ops.allowlist.js";

export const HISTORICAL_QUALITY_TRIGGERS = ["intent", "enrichment"] as const;
export type HistoricalQualityTrigger = typeof HISTORICAL_QUALITY_TRIGGERS[number];
export const HISTORICAL_QUALITY_MAX_ATTEMPTS = 1;
export const HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS = 200;

export interface HistoricalFixedResources {
  judgeModelId: string;
  embeddingModelId: string;
  providerAccountFingerprint: string;
  corpusVersion: string;
  scoringPolicyFingerprint: string;
}

export interface HistoricalResolvedConfig {
  models: Record<string, string>;
  env: Record<string, string>;
  fixed: HistoricalFixedResources;
}

export interface HistoricalExperimentSide {
  id: "a" | "b";
  config: HistoricalResolvedConfig;
}

export type HistoricalFactorDifference = {
  kind: "model" | "env";
  key: string;
  a: string | null;
  b: string | null;
};

export interface HistoricalExperimentSlot {
  caseId: string;
  trigger: HistoricalQualityTrigger;
  repetition: number;
  sideId: "a" | "b";
  attempt: 1;
}

export interface HistoricalExperimentInput {
  caseIds: string[];
  triggers: HistoricalQualityTrigger[];
  repetitions: number;
  sides: [HistoricalExperimentSide] | [HistoricalExperimentSide, HistoricalExperimentSide];
  mode: "ordinary" | "exploratory";
}

export interface HistoricalExperimentPlan {
  slots: HistoricalExperimentSlot[];
  graphInvocations: number;
  maxAttempts: 1;
  factorDifferences: HistoricalFactorDifference[];
  causalClaimAllowed: boolean;
}

function mapDiff(kind: "model" | "env", a: Record<string, string>, b: Record<string, string>): HistoricalFactorDifference[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((key) => (a[key] ?? null) !== (b[key] ?? null))
    .map((key) => ({ kind, key, a: a[key] ?? null, b: b[key] ?? null }));
}

export function diffResolvedHistoricalConfigs(a: HistoricalResolvedConfig, b: HistoricalResolvedConfig): HistoricalFactorDifference[] {
  return [...mapDiff("model", a.models, b.models), ...mapDiff("env", a.env, b.env)];
}

function assertFixedResourcesEqual(a: HistoricalFixedResources, b: HistoricalFixedResources): void {
  for (const key of ["judgeModelId", "embeddingModelId", "providerAccountFingerprint", "corpusVersion", "scoringPolicyFingerprint"] as const) {
    if (a[key].trim() === "" || b[key].trim() === "") throw new Error(`Historical comparison ${key} must be non-empty`);
    if (a[key] !== b[key]) throw new Error(`Historical comparison ${key} must be equal across sides`);
  }
}

function assertSameKeySet(label: "model" | "env", a: Record<string, string>, b: Record<string, string>): void {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) {
    throw new Error(`Historical comparison ${label} key sets must be equal across sides`);
  }
}

export function buildHistoricalExperimentPlan(input: HistoricalExperimentInput): HistoricalExperimentPlan {
  if (input.caseIds.length === 0) throw new Error("Historical experiment requires at least one case");
  if (new Set(input.caseIds).size !== input.caseIds.length) throw new Error("Historical experiment case IDs must be unique");
  if (input.triggers.length === 0) throw new Error("Historical experiment requires at least one trigger");
  const seenTriggers = new Set<HistoricalQualityTrigger>();
  for (const trigger of input.triggers) {
    if (seenTriggers.has(trigger)) throw new Error(`Historical experiment has duplicate trigger ${trigger}`);
    seenTriggers.add(trigger);
  }
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1) throw new Error("Historical repetitions must be a positive integer");
  if (input.sides[0].id !== "a" || (input.sides.length === 2 && input.sides[1].id !== "b")) {
    throw new Error("Historical sides must be [a] or [a, b]");
  }
  for (const side of input.sides) {
    for (const [agent, modelId] of Object.entries(side.config.models)) {
      if (agent.trim() === "" || modelId.trim() === "") throw new Error("Historical resolved model assignments must be non-empty");
    }
    for (const [key, value] of Object.entries(side.config.env)) {
      if (isCredentialEnvKey(key)) throw new Error(`Historical resolved config contains credential key ${key}`);
      if (value.trim() === "") throw new Error(`Historical resolved env ${key} must be non-empty`);
    }
    for (const [key, value] of Object.entries(side.config.fixed)) {
      if (value.trim() === "") throw new Error(`Historical fixed resource ${key} must be non-empty`);
    }
  }
  if (input.mode === "exploratory" && input.sides.length !== 2) {
    throw new Error("Historical exploratory mode requires two sides");
  }

  const factorDifferences = input.sides.length === 2
    ? diffResolvedHistoricalConfigs(input.sides[0].config, input.sides[1].config)
    : [];
  if (input.sides.length === 2) {
    assertSameKeySet("model", input.sides[0].config.models, input.sides[1].config.models);
    assertSameKeySet("env", input.sides[0].config.env, input.sides[1].config.env);
    assertFixedResourcesEqual(input.sides[0].config.fixed, input.sides[1].config.fixed);
    if (input.mode === "ordinary" && factorDifferences.length !== 1) {
      throw new Error(`Historical ordinary comparison requires exactly one resolved factor difference (received ${factorDifferences.length})`);
    }
    if (input.mode === "exploratory" && factorDifferences.length === 0) {
      throw new Error("Historical exploratory comparison requires at least one resolved factor difference");
    }
  }

  const graphInvocations = input.caseIds.length * input.triggers.length * input.repetitions * input.sides.length * HISTORICAL_QUALITY_MAX_ATTEMPTS;
  if (graphInvocations > HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS) {
    throw new Error(`${graphInvocations} graph invocations exceeds hard cap ${HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS}`);
  }

  const slots: HistoricalExperimentSlot[] = [];
  for (const caseId of input.caseIds) {
    for (const trigger of input.triggers) {
      for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
        for (const side of input.sides) slots.push({ caseId, trigger, repetition, sideId: side.id, attempt: 1 });
      }
    }
  }
  return {
    slots,
    graphInvocations,
    maxAttempts: HISTORICAL_QUALITY_MAX_ATTEMPTS,
    factorDifferences,
    causalClaimAllowed: input.mode === "ordinary" && input.sides.length === 2,
  };
}
