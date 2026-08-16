/**
 * signals — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + signals/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  answerLabel,
  FALLBACK_BRING_QUESTION,
  FALLBACK_WHO_QUESTION,
  SignalIntakeOrchestrator,
} from "./application/intake.orchestrator.js";
export type {
  FollowUpPlan,
  FollowUpPlanInput,
  IntakeAnswer,
  IntakeRound,
  SynthesisInput,
  SynthesisResult,
} from "./application/intake.orchestrator.js";
export {
  normalizeIntakePack,
  SignalIntakePackGenerator,
} from "./application/intake.pack.generator.js";
export type {
  IntakePack,
  IntakePackInput,
  IntakePackQuestion,
  IntakePackQuestionOption,
} from "./application/intake.pack.generator.js";
export {
  IntentGraphFactory,
} from "./application/intent.graph.js";
export {
  IntentIndexer,
} from "./application/intent.indexer.js";
export type {
  IntentIndexerOutput,
} from "./application/intent.indexer.js";
export {
  createIntentTools,
} from "./application/intent.tools.js";
export {
  SemanticVerifier,
} from "./application/intent.verifier.js";
export {
  normalizeIntentDescription,
} from "./domain/intent.proposal.js";
export type {
  IntentToolDeps,
} from "./ports/signals.tools.port.js";
