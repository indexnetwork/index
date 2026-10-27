/**
 * Selection policy over assessment samples.
 *
 * Ported from Sydney-Levine-Lab/decision-studio custom-negotiator
 * src/intervention/assessment.ts (commit 196153c), with the lab's cooperation
 * for the MoralMod × Index integration. Rule IDs fix all sample/tie semantics;
 * never rescore or rewrite samples.
 */

export type Statistic = "mean" | "median" | "lower_decile";
export type Objective = "joint_welfare" | "principal_utility" | "aggregate_moral_value";

export interface PolicyTemplate {
  id: string;
  objective: Objective;
  statistic: Statistic;
  ties: "hold";
  description: string;
}

/** Available options, NOT approved experiment defaults. */
export const POLICY_TEMPLATES: readonly PolicyTemplate[] = Object.freeze([
  { id: "joint-welfare-mean-hold-v1", objective: "joint_welfare", statistic: "mean", ties: "hold", description: "Highest arithmetic mean of native welfare samples; exact top ties hold." },
  { id: "joint-welfare-median-hold-v1", objective: "joint_welfare", statistic: "median", ties: "hold", description: "Highest median of native welfare samples; exact top ties hold." },
  { id: "joint-welfare-lower-decile-hold-v1", objective: "joint_welfare", statistic: "lower_decile", ties: "hold", description: "Highest lower-decile nearest-rank native welfare sample; exact top ties hold." },
  { id: "principal-utility-mean-hold-v1", objective: "principal_utility", statistic: "mean", ties: "hold", description: "Highest mean utility for the verified principal; exact top ties hold." },
  { id: "aggregate-value-mean-hold-v1", objective: "aggregate_moral_value", statistic: "mean", ties: "hold", description: "Highest mean native aggregate value; exact top ties hold." },
]);

export type AssessmentErrorCode = "policy_not_selected" | "invalid_assessment" | "missing_owner" | "oversize";

export class AssessmentError extends Error {
  constructor(readonly code: AssessmentErrorCode) {
    super(`Assessment ${code}`);
  }
}

/** @param id - A policy template id. @returns The template. @throws When no template carries the id. */
export function templateFor(id: string): PolicyTemplate {
  const template = POLICY_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new AssessmentError("policy_not_selected");
  return template;
}

/** @param samples - At least two finite samples. @param kind - The template's statistic. @returns The statistic. */
export function statistic(samples: number[], kind: Statistic): number {
  if (samples.length < 2 || samples.some((sample) => !Number.isFinite(sample))) throw new AssessmentError("invalid_assessment");
  if (kind === "mean") return samples.reduce((sum, sample) => sum + sample / samples.length, 0);
  const sorted = [...samples].sort((left, right) => left - right);
  if (kind === "lower_decile") return sorted[Math.max(0, Math.ceil(sorted.length * 0.1) - 1)]!;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : sorted[mid - 1]! / 2 + sorted[mid]! / 2;
}
