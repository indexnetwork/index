/**
 * The deterministic /intents/intake/* funnel is how /i/new works. The legacy
 * Signal Agent intake path is gone.
 */

/** @returns true — kept so `/auth/me` can keep reporting the surface. */
export function isFastSignalIntakeEnabled(): boolean {
  return true;
}

/** Total fast-intake question budget, including the cached round-1 question. */
export const SIGNAL_INTAKE_MAX_QUESTIONS = 3;

/** @returns The fast-intake question budget. */
export function getSignalIntakeMaxQuestions(): number {
  return SIGNAL_INTAKE_MAX_QUESTIONS;
}

/** @returns The intake knobs, read once per call site. */
export function getSignalIntakeConfig(): { maxQuestions: number } {
  return { maxQuestions: getSignalIntakeMaxQuestions() };
}
