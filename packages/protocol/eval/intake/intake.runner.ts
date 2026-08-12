import type { IntakeEvalCase, IntakeOrchestratorLike } from "./intake.types.js";

/** Run the real follow-up planner for one semantic fixture. */
export async function runCase(orchestrator: IntakeOrchestratorLike, c: IntakeEvalCase) {
  return orchestrator.generateFollowUps(c.input);
}
