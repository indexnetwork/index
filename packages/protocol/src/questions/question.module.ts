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
 * - **question.input** — per-mode context types, the discriminated
 *   QuestionerInput union, and `isValidQuestionerInputContract`, the runtime
 *   mirror of that discriminant enforced at queue boundaries.
 * - **question.agent** — QuestionerAgent: stateless, mode-driven generation.
 * - **question.presets** — system prompts and user-message builders per mode.
 * - **question.env** — the QUESTIONER_* env accessors. All reads go through it.
 * - **question.tools** / **question.ask.tool** — foreground adapters: the
 *   authenticated MCP read/answer tools, and the blocking chat
 *   `ask_user_question` tool.
 * - **question.persistence.port** / **question.tools.port** — the injected
 *   host contracts (question CRUD, chat host bridge, tool host capabilities).
 *
 * Ambient generation (recovery, pool, uptake, inflight, push) is scheduled via
 * the backend QuestionerQueue, which consumes the {@link QuestionerEnqueueFn}
 * injected from the composition root.
 *
 * ## Boundary
 *
 * The capability imports from shared/ infrastructure and the negotiations
 * barrel — never from runtime/, host implementations, or other capability
 * internals.
 */
export { QuestionerAgent } from "./question.agent.js";

export { createQuestionerTools } from "./question.tools.js";

export {
  INTENT_QUESTION_DAILY_CAP_DEFAULT,
  INTENT_QUESTION_DAILY_WINDOW_HOURS,
  isQuestionerEnabled,
} from "./question.env.js";

export { isValidQuestionerInputContract } from "./question.input.js";
export type {
  InflightQuestionerInput,
  PoolDiscoveryContext,
  PostStallQuestionerInput,
  QuestionerEnqueueFn,
  QuestionerEnqueuePayload,
  QuestionerInput,
  RecoveryQuestionerInput,
  UptakeQuestionerInput,
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
