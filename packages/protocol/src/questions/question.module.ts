/**
 * questions — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 *
 * ## What lives in the capability
 *
 * - **question.schema** — Zod schemas and derived types for the whole question
 *   vocabulary: the public Question shape, generator envelopes, and the
 *   detection/provenance/pool/recovery persistence sub-schemas.
 * - **question.input** — the park-path payload types
 *   ({@link QuestionerEnqueueFn} and the two park families).
 * - **question.env** — leftover question env constants.
 * - **question.tools** — foreground adapters: the authenticated MCP
 *   read/answer tools.
 * - **question.persistence.port** / **question.tools.port** — the injected
 *   host contracts (question CRUD, tool host capabilities).
 *
 * The QuestionerAgent, its presets, and the per-mode generation envelope are
 * retired (conversational-questions plan): a park payload now routes to the
 * question-message regeneration queue in the backend composition root.
 *
 * ## Boundary
 *
 * The capability imports from shared/ infrastructure and the negotiations
 * barrel — never from runtime/, host implementations, or other capability
 * internals.
 */
export { createQuestionerTools } from "./question.tools.js";

export {
  INTENT_QUESTION_DAILY_CAP_DEFAULT,
  INTENT_QUESTION_DAILY_WINDOW_HOURS,
} from "./question.env.js";

export type {
  InflightQuestionerInput,
  PostStallQuestionerInput,
  QuestionerEnqueueFn,
  QuestionerEnqueuePayload,
  QuestionerInput,
} from "./question.input.js";

export type {
  PersistableQuestion,
  PersistedQuestion,
  QuestionerDatabase,
  QuestionFilters,
} from "./question.persistence.port.js";
export type { QuestionerToolDeps } from "./question.tools.port.js";

export {
  NegotiationQuestionCandidateSchema,
  NegotiationQuestionProvenanceSchema,
  UnderspecificationTypeSchema,
} from "./question.schema.js";
export type {
  NegotiationQuestionCandidate,
  NegotiationQuestionProvenance,
  NegotiationQuestionPurpose,
  Question,
  QuestionGenerationResult,
  QuestionOption,
  QuestionPoolDiscriminator,
  QuestionPoolPush,
  QuestionPoolPushRequestReason,
  QuestionPoolPushRequestStatus,
  QuestionPoolSnapshot,
  QuestionPurpose,
  QuestionRecoverySnapshot,
  QuestionStrategy,
  QuestionVoidedReason,
  UnderspecificationType,
} from "./question.schema.js";
