import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { ToolScopeType } from "../shared/agent/tool.scope.js";
import type { ChatStreamEvent, DebugMetaDiscoveryQuestions, DebugMetaToolCall, DebugMetaLlm, DebugMetaOrchestratorNegotiations } from "./chat-streaming.types.js";
import { createAgentEndEvent, createAgentStartEvent, createDebugMetaEvent, createDecisionQuestionsEvent, createErrorEvent, createGraphEndEvent, createPhaseStartEvent, createPhaseEndEvent, createGraphStartEvent, createIterationStartEvent, createLlmStartEvent, createLlmEndEvent, createResponseCompleteEvent, createResponseResetEvent, createHallucinationDetectedEvent, createStatusEvent, createTokenEvent, createToolActivityEvent, createChatSummarizerStartEvent, createChatSummarizerEndEvent, createQuestionGeneratorStartEvent, createQuestionGeneratorEndEvent, createUserQuestionEvent } from "./chat-streaming.types.js";
import type { AgentStreamEvent } from "./chat.agent.js";

const logger = protocolLogger("ChatStreamer");

// ══════════════════════════════════════════════════════════════════════════════
// CHAT STREAMER (Streaming Narration Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Top-level streaming service for Chat Graph events.
 *
 * Uses `graph.stream()` with `streamMode: ["custom", "updates"]` so that
 * the agent's `config.writer()` calls arrive as `"custom"` chunks (text
 * tokens and tool-activity events) and the final state update arrives as
 * an `"updates"` chunk.
 */
export class ChatStreamer {
  constructor(
    private loadSessionContext: (
      sessionId: string,
      maxMessages: number,
    ) => Promise<BaseMessage[]>,
    private createStreamingGraph: (
      checkpointer?: BaseCheckpointSaver,
    ) => any,
  ) {}

  /**
   * Streams chat events with full session context.
   * Loads previous conversation history and optionally uses a checkpointer
   * for state persistence.
   *
   * @param input - Configuration for context-aware streaming
   * @param checkpointer - Optional checkpointer for state persistence
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEventsWithContext(
    input: {
      userId: string;
      message: string;
      sessionId: string;
      maxContextMessages?: number;
      /** @deprecated Use scopeType/scopeId. Kept for REST/session edge compatibility. */
      networkId?: string;
      scopeType?: ToolScopeType;
      scopeId?: string;
      prefillMessages?: Array<{ role: "assistant" | "user"; content: string }>;
      /** Per-run identifier used to form a composite LangGraph thread_id (sessionId:runId).
       * When provided, prevents stale checkpoint state from a prior run being resumed.
       * Defaults to sessionId alone when absent (backward compatible). */
      runId?: string;
    },
    checkpointer?: BaseCheckpointSaver,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const {
      userId,
      message,
      sessionId,
      maxContextMessages = 20,
      networkId,
      scopeType,
      scopeId,
      prefillMessages,
      runId,
    } = input;
    const effectiveScopeType: ToolScopeType | undefined = scopeType ?? (networkId ? 'network' : undefined);
    const effectiveScopeId = scopeId ?? (effectiveScopeType === 'network' ? networkId : undefined);
    logger.verbose("Starting context-aware streaming", {
      userId,
      sessionId,
      maxContextMessages,
      hasCheckpointer: !!checkpointer,
      hasIndexScope: !!effectiveScopeId,
      scopeType: effectiveScopeType,
      scopeId: effectiveScopeId,
    });

    try {
      // Load previous conversation context
      const previousMessages = await this.loadSessionContext(
        sessionId,
        maxContextMessages,
      );

      // Inject prefill messages (e.g. hardcoded onboarding greeting) only for fresh sessions
      const prefill: BaseMessage[] = previousMessages.length === 0
        ? (prefillMessages ?? []).map((pm) =>
            pm.role === "assistant" ? new AIMessage(pm.content) : new HumanMessage(pm.content),
          )
        : [];

      const allMessages = [...previousMessages, ...prefill, new HumanMessage(message)];

      logger.verbose("Context prepared", {
        previousCount: previousMessages.length,
        totalCount: allMessages.length,
      });

      // Form composite thread_id when a runId is provided
      const threadId = runId ? `${sessionId}:${runId}` : sessionId;

      // Stream with context using the optional checkpointer
      yield* this.streamChatEvents(
        { userId, messages: allMessages, scopeType: effectiveScopeType, scopeId: effectiveScopeId },
        sessionId,
        checkpointer,
        signal,
        threadId,
      );
    } catch (error) {
      logger.error("Stream error", {
        error: error instanceof Error ? error.message : String(error),
      });
      yield createErrorEvent(
        sessionId,
        error instanceof Error
          ? error.message
          : "Unknown error during context-aware streaming",
        "CONTEXT_STREAM_ERROR",
      );
    }
  }

  /**
   * Streams chat events from the graph execution.
   *
   * Uses `graph.stream()` with `streamMode: ["custom", "updates"]`:
   * - `"custom"` chunks carry {@link AgentStreamEvent} objects emitted by
   *   `ChatAgent.streamRun()` via `config.writer()`
   * - `"updates"` chunks carry the final state update from `agentLoopNode`
   *
   * @param input - The input state for the graph (userId and messages)
   * @param sessionId - The session ID for event attribution
   * @param checkpointer - Optional checkpointer for persistence
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEvents(
    input: { userId: string; messages: BaseMessage[]; networkId?: string; scopeType?: ToolScopeType; scopeId?: string },
    sessionId: string,
    checkpointer?: BaseCheckpointSaver,
    signal?: AbortSignal,
    threadId?: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const graph = this.createStreamingGraph(checkpointer);

    try {
      const initialState: {
        userId: string;
        messages: BaseMessage[];
        networkId?: string;
        scopeType?: ToolScopeType;
        scopeId?: string;
        sessionId?: string;
      } = {
        userId: input.userId,
        messages: input.messages,
      };
      const effectiveScopeType: ToolScopeType | undefined = input.scopeType ?? (input.networkId ? 'network' : undefined);
      const effectiveScopeId = input.scopeId ?? (effectiveScopeType === 'network' ? input.networkId : undefined);
      if (input.networkId) initialState.networkId = input.networkId;
      if (effectiveScopeType && effectiveScopeId) {
        initialState.scopeType = effectiveScopeType;
        initialState.scopeId = effectiveScopeId;
      }
      initialState.sessionId = sessionId;

      // Use graph.stream() with custom + updates modes.
      // Custom events come from config.writer() inside agentLoopNode.
      const eventStream = await graph.stream(initialState, {
        streamMode: ["custom", "updates"] as const,
        configurable: { thread_id: threadId ?? sessionId, signal },
        signal,
      });

      // Emit initial status
      yield createStatusEvent(sessionId, "Processing your message...");

      for await (const tuple of eventStream) {
        if (signal?.aborted) break;
        // graph.stream with multiple modes yields [mode, chunk] tuples
        const [mode, chunk] = tuple as [string, unknown];

        // ─────────────────────────────────────────────────────────────────
        // CUSTOM: writer events from ChatAgent.streamRun()
        // ─────────────────────────────────────────────────────────────────
        if (mode === "custom") {
          const event = chunk as AgentStreamEvent;

          if (event.type === "iteration_start") {
            yield createIterationStartEvent(sessionId, event.iteration);
          }

          if (event.type === "llm_start") {
            yield createLlmStartEvent(sessionId, event.iteration);
          }

          if (event.type === "text_chunk" && event.content) {
            yield createTokenEvent(sessionId, event.content);
          }

          if (event.type === "response_reset") {
            yield createResponseResetEvent(sessionId, event.reason);
          }

          if (event.type === "hallucination_detected") {
            yield createHallucinationDetectedEvent(sessionId, event.blockType, event.tool);
          }

          if (event.type === "llm_end") {
            yield createLlmEndEvent(
              sessionId,
              event.iteration,
              event.hasToolCalls,
              event.toolNames,
            );
          }

          if (event.type === "tool_activity") {
            logger.debug("Tool activity", { name: event.name, phase: event.phase });
            if (event.phase === "start") {
              yield createToolActivityEvent(
                sessionId,
                event.name,
                event.name,
                "start",
              );
            } else {
              yield createToolActivityEvent(
                sessionId,
                event.name,
                event.name,
                "end",
                event.success,
                event.summary,
                event.steps,
              );
            }
          }

          if (event.type === "graph_start") {
            yield createGraphStartEvent(sessionId, event.name);
          }

          if (event.type === "graph_end") {
            yield createGraphEndEvent(sessionId, event.name, event.durationMs);
          }

          if (event.type === "phase_start") {
            yield createPhaseStartEvent(sessionId, event.name);
          }

          if (event.type === "phase_end") {
            yield createPhaseEndEvent(sessionId, event.name, event.durationMs);
          }

          if (event.type === "agent_start") {
            yield createAgentStartEvent(sessionId, event.name);
          }

          if (event.type === "agent_end") {
            yield createAgentEndEvent(sessionId, event.name, event.durationMs, event.summary);
          }

          if (event.type === "decision_questions") {
            yield createDecisionQuestionsEvent(sessionId, { questions: event.questions });
          }

          if (event.type === "user_question") {
            yield createUserQuestionEvent(sessionId, { questions: event.questions });
          }

          if (event.type === "status") {
            // Keep-alive/status line from long-blocking tools (e.g. the
            // ask_user_question wait loop) so SSE transports do not idle out.
            yield createStatusEvent(sessionId, event.message);
          }

          if (event.type === "chat_summarizer_start") {
            yield createChatSummarizerStartEvent(sessionId, event.payload);
          }

          if (event.type === "chat_summarizer_end") {
            yield createChatSummarizerEndEvent(sessionId, event.payload);
          }

          if (event.type === "question_generator_start") {
            yield createQuestionGeneratorStartEvent(sessionId, event.payload);
          }

          if (event.type === "question_generator_end") {
            yield createQuestionGeneratorEndEvent(sessionId, event.payload);
          }
        }

        // ─────────────────────────────────────────────────────────────────
        // UPDATES: final state from agentLoopNode
        // ─────────────────────────────────────────────────────────────────
        if (mode === "updates") {
          // The updates chunk is { agent_loop: { responseText, error, ... } }
          const updates = chunk as Record<string, Record<string, unknown>>;
          const agentOutput = updates?.agent_loop;

          if (agentOutput?.error) {
            logger.warn("Agent loop returned error via updates", {
              error: agentOutput.error,
            });
            yield createErrorEvent(
              sessionId,
              String(agentOutput.error),
              "AGENT_ERROR",
            );
          }

          // Yield the agent's authoritative response text so the
          // controller can persist it without relying on token accumulation.
          const responseText = typeof agentOutput?.responseText === "string"
            ? (agentOutput.responseText as string)
            : "";
          yield createResponseCompleteEvent(sessionId, responseText);

          const debugMeta = agentOutput?.debugMeta as
            | { graph: string; iterations: number; tools?: DebugMetaToolCall[]; llm?: DebugMetaLlm; orchestratorNegotiations?: DebugMetaOrchestratorNegotiations; discoveryQuestions?: DebugMetaDiscoveryQuestions }
            | undefined;
          if (
            debugMeta?.graph != null &&
            typeof debugMeta.iterations === "number"
          ) {
            const llmFallback: DebugMetaLlm = { calls: 0, totalDurationMs: 0, resets: [], hallucinations: [] };
            yield createDebugMetaEvent(
              sessionId,
              debugMeta.graph,
              debugMeta.iterations,
              Array.isArray(debugMeta.tools) ? debugMeta.tools : [],
              debugMeta.llm ?? llmFallback,
              debugMeta.orchestratorNegotiations,
              debugMeta.discoveryQuestions,
            );
          }

          logger.verbose("Agent loop complete (updates)", {
            responseLength: responseText.length,
          });
        }
      }
    } catch (error) {
      logger.error("Stream error", {
        error: error instanceof Error ? error.message : String(error),
      });
      yield createErrorEvent(
        sessionId,
        error instanceof Error
          ? error.message
          : "Unknown error during streaming",
        "STREAM_ERROR",
      );
    }
  }
}
