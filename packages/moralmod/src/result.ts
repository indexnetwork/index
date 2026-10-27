/**
 * The assessment result as the consult returns it: the subset of the lab's
 * DecisionRunResult that selection needs, under the draft moralmod-consult-0
 * contract. Cross-field invariants mirror the lab's validateResult; samples
 * are never rescored or rewritten.
 */

import { AssessmentError } from "./selection.ts";

export interface AssessedAction {
  action_id: string;
  value: number[];
  welfare: number[];
  severity: number[];
  utilities: Record<string, number[]>;
}

export interface DecisionRunResult {
  run_id: string;
  assessment: {
    ordered_action_ids: string[];
    /** Participant → native id; null when the participant could not be mapped. */
    participant_map: Record<string, string | null>;
    settings: { n_samples: number };
    actions: AssessedAction[];
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sampleArray(value: unknown, count: number): value is number[] {
  return Array.isArray(value) && value.length === count && value.every((sample) => typeof sample === "number" && Number.isFinite(sample));
}

/** @param raw - Untrusted consult output. @returns The validated result. @throws On any structural or cross-field violation. */
export function validateResult(raw: unknown): DecisionRunResult {
  if (!record(raw) || typeof raw.run_id !== "string" || !raw.run_id || !record(raw.assessment)) throw new AssessmentError("invalid_assessment");
  const assessment = raw.assessment;
  const ids = assessment.ordered_action_ids;
  const actions = assessment.actions;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string") || !Array.isArray(actions)) throw new AssessmentError("invalid_assessment");
  if (!record(assessment.settings) || typeof assessment.settings.n_samples !== "number" || assessment.settings.n_samples < 2) throw new AssessmentError("invalid_assessment");
  if (!record(assessment.participant_map) || !Object.values(assessment.participant_map).every((native) => native === null || typeof native === "string")) throw new AssessmentError("invalid_assessment");
  const count = assessment.settings.n_samples;
  // An empty menu is a broken run, never a tie: a tie holds the turn and asks
  // the principal, while a broken run must fall back to the plain negotiator.
  if (!actions.length) throw new AssessmentError("invalid_assessment");
  if (new Set(ids).size !== actions.length || ids.length !== actions.length) throw new AssessmentError("invalid_assessment");
  const participants = assessment.participant_map as Record<string, string | null>;
  const people = Object.keys(participants).filter((person) => participants[person] !== null).sort();
  actions.forEach((action, index) => {
    if (!record(action) || action.action_id !== ids[index]) throw new AssessmentError("invalid_assessment");
    if (!record(action.utilities) || JSON.stringify(Object.keys(action.utilities).sort()) !== JSON.stringify(people)) throw new AssessmentError("invalid_assessment");
    for (const samples of [action.value, action.welfare, action.severity, ...Object.values(action.utilities)]) {
      if (!sampleArray(samples, count)) throw new AssessmentError("invalid_assessment");
    }
  });
  return raw as unknown as DecisionRunResult;
}
