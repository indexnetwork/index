import type { FollowUpPlan, FollowUpPlanInput } from "../../src/intents/application/intake.orchestrator.js";

/** One live semantic fixture for answer-first signal-intake follow-ups. */
export interface IntakeEvalCase {
  id: string;
  description: string;
  input: FollowUpPlanInput;
  /** At least one term must appear in the generated question prompt. */
  promptTerms: string[];
  /** Terms that identify options grounded in the newly stated domain. */
  domainTerms: string[];
  minDomainOptions: number;
  /** Terms inherited from the profile theme whose option count is capped. */
  profileTerms: string[];
  maxProfileOptions: number;
}

/** Minimal live orchestrator surface required by the runner. */
export interface IntakeOrchestratorLike {
  generateFollowUps(input: FollowUpPlanInput): Promise<FollowUpPlan>;
}

/** Deterministic score for one live planner invocation. */
export interface IntakeEvalResult {
  caseId: string;
  passed: boolean;
  promptRelevant: boolean;
  domainOptionCount: number;
  profileOptionCount: number;
  usedFallback: boolean;
  output: FollowUpPlan;
}
