/**
 * negotiation/application — LLM agents, graph factory, tool factory, and
 * application services for the negotiation capability.
 *
 * ## Boundary
 *
 * May import from negotiation/domain and negotiation/ports plus shared LangGraph
 * / model-binding seams. Must not import host implementations or other capability
 * internals (use the capabilities/*.facade.ts contracts instead).
 *
 * ## Exports
 *
 * ### Graph factory (ambient runtime adapter)
 * - `NegotiationGraphFactory` — LangGraph state machine; bilateral turn
 *   protocol with screen, turn, and finalize nodes.
 * - `negotiateCandidates` — parallel negotiation runner for discovery.
 *
 * ### Tool factory (foreground runtime adapter)
 * - `createNegotiationTools` — MCP tools: list_negotiations, get_negotiation,
 *   respond_to_negotiation.
 * - `AMBIENT_PARK_WINDOW_MS` — default park window for personal-agent waits.
 * - `buildLifecycleNarration` — re-exported helper for opportunity feeds.
 *
 * ### System agents (LLM)
 * - `IndexNegotiator` — structured turn-drafting agent.
 * - `NegotiationScreener` — outreach gate (P2.1 shadow/enforce).
 * - `NegotiationReflector` — post-negotiation memory distiller (P5.2).
 * - `NegotiationSummarizer` — turn-transcript compressor for discovery.
 * - `NegotiationInsightsGenerator` — history narrative generator.
 *
 * ### Detail projection
 * - `readAuthorizedNegotiationDetail` — projects authorized task into detail view.
 *
 * IND-550: canonical application layer for the negotiation capability.
 */

// ── Graph factory ─────────────────────────────────────────────────────────────
export { NegotiationGraphFactory, negotiateCandidates } from "./negotiation.graph.js";
export type { NegotiationCandidate, OnNegotiationResolved } from "./negotiation.graph.js";

// ── Tool factory ──────────────────────────────────────────────────────────────
export { createNegotiationTools, AMBIENT_PARK_WINDOW_MS, buildLifecycleNarration } from "./negotiation.tools.js";

// ── System agents ─────────────────────────────────────────────────────────────
export { IndexNegotiator } from "./negotiation.agent.js";
export type { NegotiationAgentInput } from "./negotiation.agent.js";

export {
  NegotiationScreener,
  // Screen contract re-exports for backward compat
  NEGOTIATION_SCREEN_MODES,
  configuredScreenMode,
  ScreenDecisionSchema,
  blocksNegotiationBeforeFirstTurn,
} from "./negotiation.screen.js";
export type {
  NegotiationScreenerInput,
  NegotiationScreenerConfig,
  NegotiationScreenMode,
  ScreenDecision,
  ScreenDecisionRecord,
} from "./negotiation.screen.js";

export { NegotiationReflector } from "./negotiation.reflect.js";
export type {
  DistilledMemory,
  ReflectionTranscriptEntry,
  NegotiationReflectionInput,
  ChatReflectionInput,
  NegotiationReflectJobData,
  ReflectEnqueueFn,
  NEGOTIATOR_MEMORY_KINDS,
} from "./negotiation.reflect.js";

export { NegotiationSummarizer, buildFallbackDigest } from "./negotiation.summarizer.js";
export { NegotiationInsightsGenerator } from "./insight.generator.js";
export type { NegotiationDigest } from "./insight.generator.js";

// ── Detail projection ─────────────────────────────────────────────────────────
export { readAuthorizedNegotiationDetail } from "./negotiation.detail-reader.js";
