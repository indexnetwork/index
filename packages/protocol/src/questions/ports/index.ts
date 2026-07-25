/**
 * questions/ports — injected dependency contracts for the questions capability.
 *
 * Re-exports the narrow port types that the questions module declares as explicit
 * injected boundaries. Consumers import these to wire host implementations
 * without depending on the application layer.
 *
 * ## Port groups
 *
 * ### Persistence ports
 * - QuestionerDatabase — question CRUD (persist, findPending, answer, dismiss).
 * - PersistableQuestion, PersistedQuestion, QuestionFilters — persistence shapes.
 *
 * ### Chat host port
 * - ChatQuestionsHost — blocking inline ask_user_question host bridge.
 * - ChatQuestionAnswerOutcome — resolution shape for awaited answers.
 *
 * ### Generator port (deprecated)
 * - QuestionGeneratorReader — legacy inline discovery question generator.
 *
 * ### Tool host ports
 * - QuestionerToolDeps — host capabilities for async question delivery tools.
 * - AskUserQuestionToolDeps — host capabilities for the chat ask_user_question tool.
 *
 * IND-547: canonical ports surface for the questions capability.
 */

// ── Persistence ───────────────────────────────────────────────────────────────
export type {
  PersistableQuestion,
  PersistedQuestion,
  QuestionFilters,
  ChatQuestionAnswerOutcome,
  ChatQuestionsHost,
  QuestionerDatabase,
} from "./question.persistence.port.js";

// ── Generator (deprecated) ────────────────────────────────────────────────────
export type { QuestionGeneratorReader } from "./question.generator.port.js";

// ── Tool host ports ───────────────────────────────────────────────────────────
export type { QuestionerToolDeps, AskUserQuestionToolDeps } from "./question.tools.port.js";
