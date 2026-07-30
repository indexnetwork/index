/**
 * Signals capability's supported outward contract.
 *
 * Explicit list intentionally narrower than the signals implementation
 * directory.  Consumers receive the graph, verification, indexing, and tool
 * entry points; signal states and implementation helpers remain private.
 *
 * IND-544: implementation paths now resolve through signals/application/
 * rather than the legacy intent/ compatibility shims.
 */
export { IntentGraphFactory } from "../signals/application/intent.graph.js";
export { SemanticVerifier } from "../signals/application/intent.verifier.js";
export { IntentIndexer } from "../signals/application/intent.indexer.js";
export type { IntentIndexerOutput } from "../signals/application/intent.indexer.js";
export { createIntentTools } from "../signals/application/intent.tools.js";
export type { IntentToolDeps } from "./signals.tools.port.js";
export {
  SignalIntakePackGenerator,
  normalizeIntakePack,
  type IntakePack,
  type IntakePackInput,
  type IntakePackQuestion,
  type IntakePackQuestionOption,
  SignalIntakeOrchestrator,
  answerLabel,
  FALLBACK_WHO_QUESTION,
  FALLBACK_BRING_QUESTION,
  type IntakeAnswer,
  type SynthesisInput,
  type SynthesisResult,
} from "../signals/application/intake.orchestrator.js";
