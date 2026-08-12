/**
 * questions/domain — pure question value types and schemas.
 *
 * Contains Zod schemas and TypeScript types that define the questions
 * capability's domain language.  No LLM calls, no agents, no cross-capability
 * imports beyond zod.
 *
 * ## What lives here
 *
 * - **question.schema** — Question, QuestionWithStrategy, QuestionDetection,
 *   QuestionMode, QuestionPurpose, NegotiationQuestionCandidate,
 *   NegotiationQuestionProvenance, pool/push/recovery sub-schemas, and all
 *   derived TypeScript types.
 *
 * ## What does NOT live here
 *
 * - QuestionerInput/QuestionerContext: they reference capability facades
 *   (negotiation question-safety) and belong in questions/application.
 * - QuestionerAgent and tool factories: application layer.
 * - Persistence/generator ports: questions/ports.
 *
 * IND-547: canonical home for question domain types.
 */

export * from "./question.schema.js";
