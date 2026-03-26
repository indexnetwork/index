/**
 * SSE Event types for Chat Graph streaming.
 *
 * These types define the structure of events sent during streaming chat responses.
 * Events are sent as Server-Sent Events (SSE) with JSON payloads.
 */

// Event type discriminator
export type ChatStreamEventType =
  | "status"
  | "routing"
  | "thinking"
  | "subgraph_start"
  | "subgraph_result"
  | "token"
  | "done"
  | "error"
  // Agent Loop Architecture events
  | "tool_start"
  | "tool_end"
  | "agent_thinking"
  // Streaming narration events
  | "tool_activity"
  // Agent loop trace events
  | "iteration_start"
  | "llm_start"
  | "llm_end"
  // Internal response tracking events
  | "response_complete"
  | "response_reset"
  // Debug meta (per-turn graph/tool usage for copy debug)
  | "debug_meta"
  | "graph_start"
  | "graph_end"
  | "agent_start"
  | "agent_end";

/**
 * Base interface for all chat stream events.
 */
export interface ChatStreamEventBase {
  /** Event type discriminator */
  type: ChatStreamEventType;
  /** Session ID for the chat session */
  sessionId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Status event - sent to indicate processing state changes.
 */
export interface StatusEvent extends ChatStreamEventBase {
  type: "status";
  /** Human-readable status message */
  message: string;
}

/**
 * Routing event - sent when the router determines which subgraph to use.
 */
export interface RoutingEvent extends ChatStreamEventBase {
  type: "routing";
  /** Target subgraph name */
  target: string;
  /** Optional reasoning for the routing decision */
  reasoning?: string;
}

/**
 * Thinking event - sent to stream the model's reasoning and decision-making process.
 */
export interface ThinkingEvent extends ChatStreamEventBase {
  type: "thinking";
  /** The thinking/reasoning content */
  content: string;
  /** Optional step identifier (e.g., 'router', 'inference', 'verification') */
  step?: string;
}

/**
 * Subgraph start event - sent when a subgraph begins processing.
 */
export interface SubgraphStartEvent extends ChatStreamEventBase {
  type: "subgraph_start";
  /** Name of the subgraph being executed */
  subgraph: string;
}

/**
 * Subgraph result event - sent when a subgraph completes with results.
 */
export interface SubgraphResultEvent extends ChatStreamEventBase {
  type: "subgraph_result";
  /** Name of the subgraph that completed */
  subgraph: string;
  /** Result data from the subgraph */
  data: Record<string, unknown>;
}

/**
 * Token event - sent for each token during streaming response.
 */
export interface TokenEvent extends ChatStreamEventBase {
  type: "token";
  /** Token content (partial text) */
  content: string;
}

/**
 * Chat suggestion for follow-up actions.
 * Matches frontend Suggestion type (label, type, followupText/prefill).
 */
export interface ChatSuggestion {
  label: string;
  type: "direct" | "prompt";
  /** For 'direct' type: text to auto-submit as next message */
  followupText?: string;
  /** For 'prompt' type: text to prefill the input */
  prefill?: string;
}

/**
 * Rich opportunity card data for chat messages.
 * Matches the home page card format for consistent rendering.
 */
export interface OpportunityCardPayload {
  opportunityId: string;
  userId: string;
  name?: string;
  avatar?: string | null;
  /** Main body text (personalizedSummary from presenter). */
  mainText: string;
  /** Call-to-action line (suggestedAction from presenter). */
  cta?: string;
  /** Short headline hook. */
  headline?: string;
  /** Label for primary action button (e.g. "Start Chat"). */
  primaryActionLabel?: string;
  /** Label for secondary action button (e.g. "Skip"). */
  secondaryActionLabel?: string;
  /** Subtitle under the other party name (e.g. "1 mutual intent"). */
  mutualIntentsLabel?: string;
  /** Narrator chip for human-introduced opportunities. */
  narratorChip?: {
    name: string;
    text: string;
    avatar?: string | null;
    userId?: string;
  };
  /** Viewer's role in this opportunity. */
  viewerRole?: string;
  /** Match confidence score (0-1). */
  score?: number;
  /** Opportunity status. */
  status?: string;
}

/**
 * Done event - sent when the response is complete.
 */
export interface DoneEvent extends ChatStreamEventBase {
  type: "done";
  /** Complete response text */
  response: string;
  /** Server-generated assistant message ID (for trace event persistence) */
  messageId?: string;
  /** Optional routing decision metadata */
  routingDecision?: Record<string, unknown>;
  /** Optional subgraph results metadata */
  subgraphResults?: Record<string, unknown>;
  /** Optional session title (auto-generated or existing) */
  title?: string;
  /** Optional context-aware follow-up suggestions */
  suggestions?: ChatSuggestion[];
  /** Optional rich opportunity cards returned by tools */
  opportunityCards?: OpportunityCardPayload[];
}

/**
 * Error event - sent when an error occurs.
 */
export interface ErrorEvent extends ChatStreamEventBase {
  type: "error";
  /** Human-readable error message */
  message: string;
  /** Optional error code for programmatic handling */
  code?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT LOOP ARCHITECTURE EVENTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tool start event - sent when a tool begins executing.
 */
export interface ToolStartEvent extends ChatStreamEventBase {
  type: "tool_start";
  /** Name of the tool being executed */
  toolName: string;
  /** Arguments passed to the tool */
  toolArgs: Record<string, unknown>;
}

/**
 * Tool end event - sent when a tool finishes executing.
 */
export interface ToolEndEvent extends ChatStreamEventBase {
  type: "tool_end";
  /** Name of the tool that completed */
  toolName: string;
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Brief summary of the result */
  resultSummary?: string;
}

/**
 * Agent thinking event - sent between agent iterations.
 */
export interface AgentThinkingEvent extends ChatStreamEventBase {
  type: "agent_thinking";
  /** Current iteration number */
  iteration: number;
  /** Tools used in this iteration */
  toolsUsed: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT LOOP TRACE EVENTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Iteration start event - emitted when a new agent loop iteration begins.
 */
export interface IterationStartEvent extends ChatStreamEventBase {
  type: "iteration_start";
  iteration: number;
}

/**
 * LLM start event - emitted when the LLM begins generating a response.
 */
export interface LlmStartEvent extends ChatStreamEventBase {
  type: "llm_start";
  iteration: number;
}

/**
 * LLM end event - emitted when the LLM finishes generating (may include tool calls).
 */
export interface LlmEndEvent extends ChatStreamEventBase {
  type: "llm_end";
  iteration: number;
  hasToolCalls: boolean;
  toolNames?: string[];
}

/**
 * Tool activity event - inline narration of tool execution.
 * Sent as the agent streams its response, replacing the old ThinkingDropdown.
 */
export interface ToolActivityEvent extends ChatStreamEventBase {
  type: "tool_activity";
  /** Internal tool name */
  toolName: string;
  /** User-friendly description (e.g. "Looking up your profile...") */
  description: string;
  /** Whether the tool is starting or has finished */
  phase: "start" | "end";
  /** Whether the tool succeeded (present when phase === 'end') */
  success?: boolean;
  /** Brief result summary (present when phase === 'end') */
  summary?: string;
  /** Internal steps executed by this tool (present when phase === 'end') */
  steps?: DebugMetaStep[];
}

/**
 * Internal event carrying the agent's authoritative final response text.
 * Emitted by the streamer after the graph completes. Not forwarded to the frontend SSE stream.
 */
export interface ResponseCompleteEvent extends ChatStreamEventBase {
  type: "response_complete";
  /** The agent's final response text (from the last iteration only) */
  response: string;
}

/**
 * Response reset event — tells the frontend to discard all previously streamed tokens.
 * Emitted when the agent detects hallucinated code blocks and forces a correction iteration.
 */
export interface ResponseResetEvent extends ChatStreamEventBase {
  type: "response_reset";
  /** Human-readable reason for the reset */
  reason: string;
}

/**
 * Hallucination detected event — tells the frontend that the agent caught a
 * hallucinated code block and is auto-invoking the correct tool.
 */
export interface HallucinationDetectedEvent extends ChatStreamEventBase {
  type: "hallucination_detected";
  /** The type of block that was hallucinated (e.g. "intent_proposal", "opportunity") */
  blockType: string;
  /** The tool being auto-invoked to recover */
  tool: string;
}

/**
 * One internal step reported by a tool for debug visibility (e.g. subgraph, subtask).
 */
export interface DebugMetaStep {
  step: string;
  detail?: string;
  /** Structured data for rich display (e.g., Felicity scores, classification, candidate info). */
  data?: Record<string, unknown>;
}

/**
 * One agent invocation recorded inside a graph run.
 */
export interface DebugMetaAgent {
  /** Name of the agent (e.g. "opportunity.evaluator"). */
  name: string;
  /** Wall-clock milliseconds for this agent invocation. */
  durationMs: number;
}

/**
 * One graph invocation recorded by a tool that calls a LangGraph graph.
 */
export interface DebugMetaGraph {
  /** Name of the graph (e.g. "opportunity"). */
  name: string;
  /** Wall-clock milliseconds for the full graph run. */
  durationMs: number;
  /** Agent invocations recorded inside this graph run. */
  agents: DebugMetaAgent[];
}

/**
 * One tool call entry in debug meta (sanitized args, result summary, optional steps).
 */
export interface DebugMetaToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
  success: boolean;
  /** Wall-clock milliseconds for the full tool execution. */
  durationMs: number;
  /** Internal steps (subgraphs, subtasks) when the tool reports debugSteps in its result. */
  steps?: DebugMetaStep[];
  /** LangGraph graphs invoked by this tool, with their agent timings. */
  graphs?: DebugMetaGraph[];
}

/**
 * Debug meta event - per-turn graph and tool usage for copy debug.
 */
export interface DebugMetaEvent extends ChatStreamEventBase {
  type: "debug_meta";
  graph: string;
  iterations: number;
  tools: DebugMetaToolCall[];
}

/** Graph start event — emitted when a LangGraph sub-graph begins inside a tool. */
export interface GraphStartEvent extends ChatStreamEventBase {
  type: "graph_start";
  graphName: string;
}

/** Graph end event — emitted when a LangGraph sub-graph completes. */
export interface GraphEndEvent extends ChatStreamEventBase {
  type: "graph_end";
  graphName: string;
  durationMs: number;
}

/** Agent start event — emitted when an LLM agent begins inside a graph node. */
export interface AgentStartEvent extends ChatStreamEventBase {
  type: "agent_start";
  agentName: string;
}

/** Agent end event — emitted when an LLM agent completes. */
export interface AgentEndEvent extends ChatStreamEventBase {
  type: "agent_end";
  agentName: string;
  durationMs: number;
  /** Structured outcome summary, e.g. "5 of 12 passed" or "3 intents extracted". */
  summary: string;
}

/**
 * Union type of all chat stream events.
 */
export type ChatStreamEvent =
  | StatusEvent
  | RoutingEvent
  | ThinkingEvent
  | SubgraphStartEvent
  | SubgraphResultEvent
  | TokenEvent
  | DoneEvent
  | ErrorEvent
  // Agent Loop Architecture events
  | ToolStartEvent
  | ToolEndEvent
  | AgentThinkingEvent
  // Streaming narration events
  | ToolActivityEvent
  // Agent loop trace events
  | IterationStartEvent
  | LlmStartEvent
  | LlmEndEvent
  // Internal response tracking events
  | ResponseCompleteEvent
  | ResponseResetEvent
  | HallucinationDetectedEvent
  // Debug meta
  | DebugMetaEvent
  // Trace hierarchy events
  | GraphStartEvent
  | GraphEndEvent
  | AgentStartEvent
  | AgentEndEvent;

/**
 * Formats a chat stream event as an SSE message. If JSON.stringify throws (e.g. circular ref,
 * non-serializable value), returns a minimal error event so the stream stays valid.
 *
 * @param event - The event to format
 * @returns SSE-formatted string with "data: " prefix and double newline
 */
export function formatSSEEvent(event: ChatStreamEvent): string {
  try {
    return `data: ${JSON.stringify(event)}\n\n`;
  } catch (serializeError) {
    const fallback: ErrorEvent = {
      type: "error",
      sessionId:
        typeof (event as ChatStreamEventBase).sessionId === "string"
          ? (event as ChatStreamEventBase).sessionId
          : "unknown",
      timestamp: new Date().toISOString(),
      message: "Response could not be serialized. Please try again.",
      code: "SERIALIZATION_ERROR",
    };
    return `data: ${JSON.stringify(fallback)}\n\n`;
  }
}

/**
 * Creates a chat stream event with common fields populated.
 *
 * @param type - Event type
 * @param sessionId - Session ID
 * @param data - Event-specific data (excluding type, sessionId, timestamp)
 * @returns Complete event object
 *
 * @example
 * ```ts
 * const statusEvent = createStreamEvent<StatusEvent>('status', 'session-123', {
 *   message: 'Processing your request...'
 * });
 * ```
 */
export function createStreamEvent<T extends ChatStreamEvent>(
  type: T["type"],
  sessionId: string,
  data: Omit<T, "type" | "sessionId" | "timestamp">,
): T {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    ...data,
  } as T;
}

/**
 * Type guard to check if an event is a specific type.
 */
export function isEventType<T extends ChatStreamEvent>(
  event: ChatStreamEvent,
  type: T["type"],
): event is T {
  return event.type === type;
}

/**
 * Creates a formatted status event.
 */
export function createStatusEvent(
  sessionId: string,
  message: string,
): StatusEvent {
  return createStreamEvent<StatusEvent>("status", sessionId, { message });
}

/**
 * Creates a formatted routing event.
 */
export function createRoutingEvent(
  sessionId: string,
  target: string,
  reasoning?: string,
): RoutingEvent {
  return createStreamEvent<RoutingEvent>("routing", sessionId, {
    target,
    reasoning,
  });
}

/**
 * Creates a formatted subgraph start event.
 */
export function createSubgraphStartEvent(
  sessionId: string,
  subgraph: string,
): SubgraphStartEvent {
  return createStreamEvent<SubgraphStartEvent>("subgraph_start", sessionId, {
    subgraph,
  });
}

/**
 * Creates a formatted subgraph result event.
 */
export function createSubgraphResultEvent(
  sessionId: string,
  subgraph: string,
  data: Record<string, unknown>,
): SubgraphResultEvent {
  return createStreamEvent<SubgraphResultEvent>("subgraph_result", sessionId, {
    subgraph,
    data,
  });
}

/**
 * Creates a formatted token event.
 */
export function createTokenEvent(
  sessionId: string,
  content: string,
): TokenEvent {
  return createStreamEvent<TokenEvent>("token", sessionId, { content });
}

/**
 * Options for the done event (optional metadata).
 */
export interface CreateDoneEventOptions {
  messageId?: string;
  routingDecision?: Record<string, unknown>;
  subgraphResults?: Record<string, unknown>;
  title?: string;
  suggestions?: ChatSuggestion[];
  opportunityCards?: OpportunityCardPayload[];
}

/**
 * Creates a formatted done event.
 */
export function createDoneEvent(
  sessionId: string,
  response: string,
  options?: CreateDoneEventOptions,
): DoneEvent {
  return createStreamEvent<DoneEvent>("done", sessionId, {
    response,
    ...options,
  });
}

/**
 * Creates a formatted error event.
 */
export function createErrorEvent(
  sessionId: string,
  message: string,
  code?: string,
): ErrorEvent {
  return createStreamEvent<ErrorEvent>("error", sessionId, { message, code });
}

/**
 * Creates a formatted thinking event.
 */
export function createThinkingEvent(
  sessionId: string,
  content: string,
  step?: string,
): ThinkingEvent {
  return createStreamEvent<ThinkingEvent>("thinking", sessionId, {
    content,
    step,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT LOOP EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a formatted tool start event.
 */
export function createToolStartEvent(
  sessionId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): ToolStartEvent {
  return createStreamEvent<ToolStartEvent>("tool_start", sessionId, {
    toolName,
    toolArgs,
  });
}

/**
 * Creates a formatted tool end event.
 */
export function createToolEndEvent(
  sessionId: string,
  toolName: string,
  success: boolean,
  resultSummary?: string,
): ToolEndEvent {
  return createStreamEvent<ToolEndEvent>("tool_end", sessionId, {
    toolName,
    success,
    resultSummary,
  });
}

/**
 * Creates a formatted agent thinking event.
 */
export function createAgentThinkingEvent(
  sessionId: string,
  iteration: number,
  toolsUsed: string[],
): AgentThinkingEvent {
  return createStreamEvent<AgentThinkingEvent>("agent_thinking", sessionId, {
    iteration,
    toolsUsed,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT LOOP TRACE EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a formatted iteration start event.
 */
export function createIterationStartEvent(
  sessionId: string,
  iteration: number,
): IterationStartEvent {
  return createStreamEvent<IterationStartEvent>("iteration_start", sessionId, {
    iteration,
  });
}

/**
 * Creates a formatted LLM start event.
 */
export function createLlmStartEvent(
  sessionId: string,
  iteration: number,
): LlmStartEvent {
  return createStreamEvent<LlmStartEvent>("llm_start", sessionId, {
    iteration,
  });
}

/**
 * Creates a formatted LLM end event.
 */
export function createLlmEndEvent(
  sessionId: string,
  iteration: number,
  hasToolCalls: boolean,
  toolNames?: string[],
): LlmEndEvent {
  return createStreamEvent<LlmEndEvent>("llm_end", sessionId, {
    iteration,
    hasToolCalls,
    toolNames,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// STREAMING NARRATION EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a formatted tool activity event (inline narration).
 */
export function createToolActivityEvent(
  sessionId: string,
  toolName: string,
  description: string,
  phase: "start" | "end",
  success?: boolean,
  summary?: string,
  steps?: DebugMetaStep[],
): ToolActivityEvent {
  return createStreamEvent<ToolActivityEvent>("tool_activity", sessionId, {
    toolName,
    description,
    phase,
    success,
    summary,
    steps,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL RESPONSE TRACKING EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a formatted response complete event.
 */
export function createResponseCompleteEvent(
  sessionId: string,
  response: string,
): ResponseCompleteEvent {
  return createStreamEvent<ResponseCompleteEvent>("response_complete", sessionId, { response });
}

/**
 * Creates a formatted response reset event.
 * Tells the frontend to discard all previously streamed tokens.
 */
export function createResponseResetEvent(
  sessionId: string,
  reason: string,
): ResponseResetEvent {
  return createStreamEvent<ResponseResetEvent>("response_reset", sessionId, { reason });
}

/**
 * Creates a hallucination detected event for the trace panel.
 */
export function createHallucinationDetectedEvent(
  sessionId: string,
  blockType: string,
  tool: string,
): HallucinationDetectedEvent {
  return createStreamEvent<HallucinationDetectedEvent>("hallucination_detected", sessionId, { blockType, tool });
}

// ════════════════════════════════════════════════════════════════════════════
// DEBUG META EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a formatted debug meta event (per-turn graph and tool usage).
 */
export function createDebugMetaEvent(
  sessionId: string,
  graph: string,
  iterations: number,
  tools: DebugMetaToolCall[],
): DebugMetaEvent {
  return createStreamEvent<DebugMetaEvent>("debug_meta", sessionId, {
    graph,
    iterations,
    tools,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TRACE HIERARCHY EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a graph start event emitted when a LangGraph sub-graph begins inside a tool.
 */
export function createGraphStartEvent(sessionId: string, graphName: string): GraphStartEvent {
  return createStreamEvent<GraphStartEvent>("graph_start", sessionId, { graphName });
}

/**
 * Creates a graph end event emitted when a LangGraph sub-graph completes.
 */
export function createGraphEndEvent(sessionId: string, graphName: string, durationMs: number): GraphEndEvent {
  return createStreamEvent<GraphEndEvent>("graph_end", sessionId, { graphName, durationMs });
}

/**
 * Creates an agent start event emitted when an LLM agent begins inside a graph node.
 */
export function createAgentStartEvent(sessionId: string, agentName: string): AgentStartEvent {
  return createStreamEvent<AgentStartEvent>("agent_start", sessionId, { agentName });
}

/**
 * Creates an agent end event emitted when an LLM agent completes.
 */
export function createAgentEndEvent(
  sessionId: string,
  agentName: string,
  durationMs: number,
  summary: string,
): AgentEndEvent {
  return createStreamEvent<AgentEndEvent>("agent_end", sessionId, { agentName, durationMs, summary });
}
