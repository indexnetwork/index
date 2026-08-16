/**
 * questions/public — curated public surface of the questions capability.
 *
 * Re-exports stable contracts from domain, application, and ports.
 * Runtime adapter creation (tool factories, agent) is accessible here for
 * package consumers; internal module details (presets, prompt builders, qud
 * taxonomy) remain private to the application layer.
 *
 * ## Boundary
 *
 * References only questions/domain, questions/application, and questions/ports.
 * Never imports from the tool composition root (shared/agent), host implementations, or other
 * capability internals.
 *
 * ## Intentionally excluded from public surface
 *
 * The following are application-internal:
 * - getPreset, QuestionerPreset — LLM preset internals; import from
 *   questions/application/ when needed for testing overrides.
 * - QUD_UNDERSPECIFICATION_RULES — prompt composition detail.
 * - buildDiscoveryQuestionPrompt, DISCOVERY_SYSTEM_PROMPT — prompt internals.
 * - chatQuestionWaitTimeoutMs, CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT — only
 *   needed inside the ask tool itself.
 * - setQuestionerAgentForTesting — test seam, not for consumers.
 *
 * ## Foreground vs ambient delivery
 *
 * **Foreground adapters** (authenticated, participant-directed):
 * - `createQuestionerTools` — MCP tools for read/answer/dismiss.
 * - `createAskUserQuestionTools` — blocking inline chat questions.
 *
 * **Ambient adapters** (background generation, not exported here):
 * - Recovery, pool, uptake, inflight, and push generation are scheduled by
 *   QuestionerQueue (backend) via `QuestionerEnqueueFn`. The queue calls
 *   `QuestionerAgent.invoke()` with the appropriate mode context.
 *
 * IND-547: canonical public surface for the questions capability.
 * Legacy paths (capabilities/questions.facade.ts) re-export from here.
 */

// ── Domain schemas and types ──────────────────────────────────────────────────
export * from "../domain/index.js";

// ── Application: agent ────────────────────────────────────────────────────────
export { QuestionerAgent } from "../application/index.js";
export type { QuestionerAgentConfig } from "../application/index.js";

// ── Application: env accessors ────────────────────────────────────────────────
export {
  isQuestionerEnabled,
  isUptakeGuardEnabled,
  uptakeAuthorityThreshold,
  intentQuestionDailyCap,
  UPTAKE_AUTHORITY_THRESHOLD_DEFAULT,
  INTENT_QUESTION_DAILY_CAP_DEFAULT,
  INTENT_QUESTION_DAILY_WINDOW_HOURS,
} from "../application/index.js";

// ── Application: input types and validation ───────────────────────────────────
export {
  isValidQuestionerInputContract,
} from "../application/index.js";
export type {
  QuestionerInput,
  QuestionerEnqueuePayload,
  QuestionerEnqueueFn,
  PoolDiscoveryContext,
  RecoveryQuestionerInput,
  UptakeQuestionerInput,
  PostStallQuestionerInput,
  InflightQuestionerInput,
} from "../application/index.js";

// ── Application: foreground adapter tools ─────────────────────────────────────
export { createQuestionerTools, createAskUserQuestionTools } from "../application/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type {
  AskUserQuestionToolDeps,
  ChatQuestionAnswerOutcome,
  ChatQuestionsHost,
  PersistableQuestion,
  PersistedQuestion,
  QuestionFilters,
  QuestionerDatabase,
  QuestionerToolDeps,
} from "../ports/index.js";
