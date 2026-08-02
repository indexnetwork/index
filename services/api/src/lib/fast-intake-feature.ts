/**
 * Fast signal intake flag.
 *
 * Disabled unless FAST_SIGNAL_INTAKE is exactly "true". Gates the deterministic
 * /intents/intake/* funnel; the legacy Signal Agent intake path is untouched.
 */

/** @returns true when /i/new must use the deterministic intake funnel. */
export function isFastSignalIntakeEnabled(): boolean {
  return process.env.FAST_SIGNAL_INTAKE === 'true';
}

/** Per-turn delivery of intake follow-up questions. */
export type SignalIntakeQuestionMode = 'singular' | 'plural';

const DEFAULT_MAX_QUESTIONS = 2;
const MAX_QUESTIONS_FLOOR = 1;
const MAX_QUESTIONS_CEILING = 10;

/**
 * Total fast-intake question budget, including the cached round-1 question.
 * Defaults to 2 (the pre-configuration funnel: round 1 + one follow-up);
 * unparseable values fall back to the default rather than failing startup.
 *
 * @returns The configured budget clamped to [1, 10]
 */
export function getSignalIntakeMaxQuestions(): number {
  const raw = process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
  if (!raw) return DEFAULT_MAX_QUESTIONS;
  const parsed = /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (Number.isNaN(parsed)) return DEFAULT_MAX_QUESTIONS;
  return Math.min(Math.max(parsed, MAX_QUESTIONS_FLOOR), MAX_QUESTIONS_CEILING);
}

/**
 * Per-turn delivery mode: `singular` serves one follow-up per /question turn;
 * `plural` serves the whole remaining batch in one turn. Default `singular`.
 *
 * @returns The configured mode, `singular` for any unrecognized value
 */
export function getSignalIntakeQuestionMode(): SignalIntakeQuestionMode {
  return process.env.SIGNAL_INTAKE_QUESTION_MODE === 'plural' ? 'plural' : 'singular';
}

/** @returns Both intake knobs, read once per call site. */
export function getSignalIntakeConfig(): { maxQuestions: number; mode: SignalIntakeQuestionMode } {
  return { maxQuestions: getSignalIntakeMaxQuestions(), mode: getSignalIntakeQuestionMode() };
}
