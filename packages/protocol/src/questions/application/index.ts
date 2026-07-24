/**
 * questions/application — orchestrators, agents, env, tools, and presets.
 *
 * Re-exports the orchestration tier of the questions capability: the
 * QuestionerAgent, env accessors, generation presets, and adapter tool
 * factories.
 *
 * ## Foreground adapters (participant-directed, authenticated)
 *
 * - {@link createQuestionerTools} — `read_pending_questions` and
 *   `answer_pending_question` MCP tools for authenticated answer/dismiss paths.
 * - {@link createAskUserQuestionTools} — blocking chat `ask_user_question`
 *   tool for inline chat orchestrator questions.
 *
 * ## Ambient adapters (background generation)
 *
 * Recovery, pool, uptake, inflight, and push generation are scheduled via
 * the QuestionerQueue (backend). They consume {@link QuestionerEnqueueFn}
 * injected from the composition root and call QuestionerAgent.invoke() with
 * the appropriate mode context. The ports for these adapters are declared in
 * `questions/ports/question.persistence.port.ts`.
 *
 * ## Boundary
 *
 * Imports from questions/domain, questions/ports, shared/ infrastructure,
 * and narrow capability facades (negotiation.questions.facade) — never from
 * runtime/, host implementations, or other capability internals.
 *
 * IND-547: canonical application layer for the questions capability.
 */

// ── Domain input types + validation ──────────────────────────────────────────
export {
  isValidQuestionerInputContract,
} from "./question.input.js";
export type {
  QuestionerInput,
  QuestionerContext,
  QuestionerEnqueuePayload,
  QuestionerEnqueueFn,
  DiscoveryContext,
  IntentContext,
  RecoveryIntentContext,
  ProfileContext,
  NegotiationContext,
  PostStallNegotiationContext,
  UptakeNegotiationContext,
  NegotiationInflightContext,
  ChatContext,
  PoolDiscoveryContext,
  PostStallQuestionerInput,
  InflightQuestionerInput,
  UptakeQuestionerInput,
  RecoveryQuestionerInput,
} from "./question.input.js";

// ── Agent ─────────────────────────────────────────────────────────────────────
export { QuestionerAgent } from "./question.agent.js";
export type { QuestionerAgentConfig } from "./question.agent.js";

// ── Env ───────────────────────────────────────────────────────────────────────
export {
  isQuestionerEnabled,
  isDiscoveryQuestionsEnabled,
  isUptakeGuardEnabled,
  uptakeAuthorityThreshold,
  discoveryQuestionsInputMode,
  discoveryQuestionsTimeoutMs,
  chatQuestionWaitTimeoutMs,
  DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT,
  CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT,
  UPTAKE_AUTHORITY_THRESHOLD_DEFAULT,
} from "./question.env.js";

// ── Presets ───────────────────────────────────────────────────────────────────
export { getPreset } from "./question.presets.js";
export type { QuestionerPreset } from "./question.presets.js";

// ── Foreground adapter tools ──────────────────────────────────────────────────
export { createQuestionerTools } from "./question.tools.js";
export { createAskUserQuestionTools, setQuestionerAgentForTesting } from "./question.ask.tool.js";
