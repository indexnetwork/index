/**
 * signals/public — curated public surface of the signals capability.
 *
 * Re-exports the stable contracts from domain, application, and ports.
 * Runtime adapter creation (createIntentTools) is NOT exported here; it is
 * accessible via capabilities/signals.facade for package consumers and via
 * the foreground shell (runtime/foreground/signals) for internal registries.
 *
 * Boundary: public-compatibility.  References only signals/domain,
 * signals/application, and signals/ports — never runtime/foreground or
 * host implementations.
 */

// ── Domain contracts ──────────────────────────────────────────────────────────
export {
  type VerifiedIntent,
  type IntentValidationFailureCategory,
  type IntentValidationFailure,
  type ExecutionResult,
  IntentGraphState,
  DEFAULT_SPECIFICITY_WARNING,
} from "../domain/index.js";

// ── Application seams ─────────────────────────────────────────────────────────
export {
  IntentGraphFactory,
  enforceIntentActionBoundary,
  buildExplicitUpdateActions,
  SemanticVerifier,
  type SemanticVerifierOutput,
  ExplicitIntentInferrer,
  type InferredIntent,
  type InferrerOptions,
  IntentClarifier,
  IntentReconciler,
  type IntentReconcilerOutput,
  type NormalizedIntentAction,
  IntentIndexer,
  IntentIndexerOutputSchema,
  type IntentIndexerOutput,
  describeIntentUpdateFailure,
  SignalIntakePackGenerator,
  normalizeIntakePack,
  type IntakePack,
  type IntakePackInput,
  type IntakePackQuestion,
  type IntakePackQuestionOption,
} from "../application/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type { IntentGraphDatabase, EmbeddingGenerator, IntentGraphQueue } from "../ports/index.js";
