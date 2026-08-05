/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with:
 *   cd packages/protocol && bun ./eval/ops/ops.envcatalog.build.ts
 *
 * Every environment variable each harness can actually read, derived by walking
 * that harness's own transitive import closure and collecting `process.env`
 * reads (eval/ops/ops.envscan.ts). Credentials are excluded — see
 * ENV_SECRET_KEYS in ops.envcatalog.build.ts.
 *
 * Hand-editing this file is pointless: eval/ops/tests/envcatalog.spec.ts
 * regenerates the catalogue and fails on any difference, so an edit here is
 * either reverted by the next generator run or caught by CI.
 *
 * This module is dependency-free so the browser app can import it, the same
 * constraint ops.allowlist.ts documents for itself. The scanner that produces
 * it uses node:fs and Bun.Transpiler and must never be imported by the app.
 *
 * Why derived rather than maintained: the site once offered nine flags for
 * discovery because a scan was run against a hand-written sixteen-key list.
 * The graph READS twenty-eight; two of those are credentials, so twenty-six are
 * OFFERED. (The scorecard harnesses read ten each and offer eight, by the same
 * two exclusions.) The list was the limit, not the code — so the list is gone
 * and the code answers.
 */
import type { OpsHarness } from "./ops.types.js";

export const HARNESS_ENV_KEYS: Readonly<Record<OpsHarness, readonly string[]>> = Object.freeze({
  matching: Object.freeze([
    "CHAT_MODEL",
    "CHAT_REASONING_EFFORT",
    "EVAL_MODEL_OVERRIDES",
    "OPENROUTER_FALLBACK_MODEL",
    "OPENROUTER_MAX_RETRIES",
    "OPENROUTER_REQUEST_TIMEOUT_MS",
    "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
    "SMARTEST_VERIFIER_MODEL",
  ]),
  profile: Object.freeze([
    "CHAT_MODEL",
    "CHAT_REASONING_EFFORT",
    "EVAL_MODEL_OVERRIDES",
    "OPENROUTER_FALLBACK_MODEL",
    "OPENROUTER_MAX_RETRIES",
    "OPENROUTER_REQUEST_TIMEOUT_MS",
    "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
    "SMARTEST_VERIFIER_MODEL",
  ]),
  premise: Object.freeze([
    "CHAT_MODEL",
    "CHAT_REASONING_EFFORT",
    "EVAL_MODEL_OVERRIDES",
    "OPENROUTER_FALLBACK_MODEL",
    "OPENROUTER_MAX_RETRIES",
    "OPENROUTER_REQUEST_TIMEOUT_MS",
    "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
    "SMARTEST_VERIFIER_MODEL",
  ]),
  opportunity: Object.freeze([
    "CHAT_MODEL",
    "CHAT_REASONING_EFFORT",
    "EVAL_MODEL_OVERRIDES",
    "OPENROUTER_FALLBACK_MODEL",
    "OPENROUTER_MAX_RETRIES",
    "OPENROUTER_REQUEST_TIMEOUT_MS",
    "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
    "SMARTEST_VERIFIER_MODEL",
  ]),
  discovery: Object.freeze([
    "CHAT_MODEL",
    "CHAT_REASONING_EFFORT",
    "DISCOVERY_ALLOWED_TYPES",
    "DISCOVERY_CONTEXT_TO_INTENT",
    "DISCOVERY_PROFILE_SOURCE",
    "DISCOVERY_REJECTION_COOLDOWN_DAYS",
    "DISCOVERY_SOURCE_PREMISE_LIMIT",
    "EVAL_MODEL_OVERRIDES",
    "HYDE_FRAME_CONSTRAINTS_ENABLED",
    "NEGOTIATION_ASK_USER_ENABLED",
    "NEGOTIATION_ASK_USER_WINDOW_MS",
    "NEGOTIATION_CONSULTATION_POLICY_MODE",
    "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
    "NEGOTIATION_DEADLOCK_THRESHOLD",
    "NEGOTIATION_INCLUDE_OTHER_INTENTS",
    "NEGOTIATION_MAX_TURNS_AMBIENT",
    "NEGOTIATION_MAX_TURNS_CHAT",
    "NEGOTIATION_PROTOCOL_VERSION",
    "NEGOTIATION_SCREEN_MODE",
    "NEGOTIATOR_STANCE",
    "NEGOTIATOR_TURN_TIMEOUT_MS",
    "OPENROUTER_FALLBACK_MODEL",
    "OPENROUTER_MAX_RETRIES",
    "OPENROUTER_REQUEST_TIMEOUT_MS",
    "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
    "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
  ]),
});
