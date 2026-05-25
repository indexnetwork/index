import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

import type { DebugMetaToolCall, DebugMetaLlm, DebugMetaOrchestratorNegotiations } from "./chat-streaming.types.js";

// ══════════════════════════════════════════════════════════════════════════════
// TYPES (used by legacy subgraph nodes; agent-loop graph does not set these)
// ══════════════════════════════════════════════════════════════════════════════

/** Routing decision from router node (target, operationType, extractedContext). */
export interface RoutingDecision {
  target: string;
  operationType: string | null;
  extractedContext?: string | null;
}

/** Intent subgraph result (actions, inferredIntents, etc.). */
export interface IntentSubgraphResult {
  actions?: Array<{ type: string; payload?: string }>;
  inferredIntents?: unknown[];
  indexingResults?: unknown[];
  mode?: string;
  intents?: unknown[];
  count?: number;
  error?: string;
  /** When the intent graph exits early (e.g. index-scoped without intents); surface to user. */
  requiredMessage?: string;
}

/** Index subgraph result (memberships, ownedIndexes, specificIndexData). */
export interface IndexSubgraphResult {
  mode?: string;
  memberships?: unknown[];
  ownedIndexes?: unknown[];
  specificIndexData?: unknown;
  count?: number;
  error?: string;
}

/** Aggregated results from subgraphs (intent, index, profile, opportunity, scrape). */
export interface SubgraphResults {
  intent?: IntentSubgraphResult;
  index?: IndexSubgraphResult;
  profile?: unknown;
  opportunity?: unknown;
  scrape?: unknown;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHAT GRAPH STATE (Agent Loop Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The Chat Graph State using LangGraph Annotations.
 * 
 * This is a simplified state for the agent loop architecture.
 * The agent handles all routing decisions internally via tool calling.
 * 
 * Design Principles:
 * - Messages accumulate through the conversation (includes tool calls/results)
 * - Iteration count tracks loop progress for soft/hard limits
 * - Final response is extracted at the end
 */
export const ChatGraphState = Annotation.Root({
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE INPUTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The User ID - required for all operations.
   */
  userId: Annotation<string>,

  /**
   * Optional index (community) ID when chat is scoped to a specific index.
   * When set, the agent and tools use this as the current index (e.g. read_intents,
   * create_intent with networkId, scope index assignment to this index only).
   */
  networkId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Chat session ID when streaming with context. Used by tools to create draft
   * opportunities tied to this conversation (context.conversationId).
   */
  sessionId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Conversation history using LangGraph's built-in message reducer.
   * Includes: HumanMessage, AIMessage, ToolMessage, SystemMessage
   * Automatically handles message appending, ID management, and ordering.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current iteration count in the agent loop.
   * Used for soft limit (nudge) and hard limit (force exit).
   */
  iterationCount: Annotation<number>({
    reducer: (curr, next) => next,
    default: () => 0,
  }),

  /**
   * Flag indicating whether the agent loop should continue.
   * Set to false when agent produces final response or hits hard limit.
   */
  shouldContinue: Annotation<boolean>({
    reducer: (curr, next) => next,
    default: () => true,
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The final generated response text.
   * Set when the agent decides to stop and respond.
   */
  responseText: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Error message if the agent loop fails.
   */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Per-turn debug meta (graph, iterations, tool calls) for copy-debug.
   * Not persisted; only used so the streamer receives it in the updates chunk.
   */
  debugMeta: Annotation<{ graph: string; iterations: number; tools: DebugMetaToolCall[]; llm: DebugMetaLlm; orchestratorNegotiations?: DebugMetaOrchestratorNegotiations } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // Legacy subgraph state (used by index/intent/response nodes when present)
  /** Router output: target, operationType, extractedContext. */
  routingDecision: Annotation<RoutingDecision | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
  /** Results from intent/profile/opportunity/scrape subgraphs. */
  subgraphResults: Annotation<SubgraphResults | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
  /** User profile context (e.g. for intent nodes). */
  userProfile: Annotation<unknown>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

});

// ══════════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The full state type for the Chat Graph.
 * Use this for typing node functions and graph invocations.
 */
export type ChatGraphStateType = typeof ChatGraphState.State;
