/**
 * intents/domain — pure signal contracts.
 *
 * Value types, graph-state shapes, validation-failure enumerations, and
 * domain constants that define the signals capability's domain language.
 * No LLM calls, no LangGraph edges, no host-adapter imports.
 */

// ── State and value types ─────────────────────────────────────────────────────
export {
  type VerifiedIntent,
  type IntentValidationFailureCategory,
  type IntentValidationFailure,
  type ExecutionResult,
  IntentGraphState,
} from "./intent.state.js";

// ── Domain constants ──────────────────────────────────────────────────────────
export { DEFAULT_SPECIFICITY_WARNING } from "./signal.specificity.js";
