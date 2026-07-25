/**
 * signals/application — signal lifecycle and graph orchestration seams.
 *
 * Houses the LangGraph factory, model-binding adapters (inferrer, clarifier,
 * verifier, reconciler, indexer), and the tool-definition factory.
 * Participant-facing runtime tool registration lives in the foreground shell
 * (runtime/foreground/signals/intent.tools).
 *
 * Boundary: may import from signals/domain and signals/ports, plus
 * only-when-needed LangGraph / model-binding seams inside this directory.
 * Must not import host implementations.
 */

// ── Graph orchestration ───────────────────────────────────────────────────────
export { IntentGraphFactory, enforceIntentActionBoundary, buildExplicitUpdateActions } from "./intent.graph.js";

// ── Model-binding adapters ────────────────────────────────────────────────────
export { ExplicitIntentInferrer, type InferredIntent, type InferrerOptions } from "./intent.inferrer.js";
export { IntentClarifier } from "./intent.clarifier.js";
export { SemanticVerifier, type SemanticVerifierOutput } from "./intent.verifier.js";
export { IntentReconciler, type IntentReconcilerOutput, type NormalizedIntentAction } from "./intent.reconciler.js";
export { IntentIndexer, IntentIndexerOutputSchema, type IntentIndexerOutput } from "./intent.indexer.js";

// ── Tool factory (signals layer) ──────────────────────────────────────────────
export { createIntentTools, describeIntentUpdateFailure } from "./intent.tools.js";
