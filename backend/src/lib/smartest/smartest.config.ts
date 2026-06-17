/**
 * Smartest model configuration: separate models per task.
 * - Data creation (e.g. fixture generators): fast model.
 * - Validation (LLM verifier): default is Flash for fast test runs; set SMARTEST_VERIFIER_MODEL=google/gemini-2.5-pro for a thinking model (slower, potentially stricter).
 */

const DEFAULT_SMARTEST_MODEL = 'google/gemini-2.5-flash';

/** OpenRouter model for LLM-based data creation (e.g. future fixture generators). */
export const SMARTEST_GENERATOR_MODEL =
  process.env.SMARTEST_GENERATOR_MODEL ?? DEFAULT_SMARTEST_MODEL;

/** OpenRouter model for the verifier (test oracle). Default Flash keeps test runs fast; use Pro via env for slower, more thorough judgment. */
export const SMARTEST_VERIFIER_MODEL =
  process.env.SMARTEST_VERIFIER_MODEL ?? DEFAULT_SMARTEST_MODEL;

/** Read at runtime so tests can override via process.env before runScenario. */
export function getSmartestVerifierModel(): string {
  return process.env.SMARTEST_VERIFIER_MODEL ?? DEFAULT_SMARTEST_MODEL;
}
