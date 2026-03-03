import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { protocolLogger } from "../support/protocol.logger";
import type {
  ChatStreamEvent,
  DebugMetaToolCall,
} from "../../../types/chat-streaming.types";
import {
  createDebugMetaEvent,
  createErrorEvent,
  createIterationStartEvent,
  createLlmStartEvent,
  createLlmEndEvent,
  createNegotiationProgressEvent,
  createResponseCompleteEvent,
  createStatusEvent,
  createTokenEvent,
  createToolActivityEvent,
} from "../../../types/chat-streaming.types";
import type { AgentStreamEvent } from "../agents/chat.agent";

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
      checkpointer?: MemorySaver | PostgresSaver,
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
      indexId?: string;
    },
    checkpointer?: MemorySaver | PostgresSaver,
  ): AsyncGenerator<ChatStreamEvent> {
    const {
      userId,
      message,
      sessionId,
      maxContextMessages = 20,
      indexId,
    } = input;
    logger.verbose("Starting context-aware streaming", {
      userId,
      sessionId,
      maxContextMessages,
      hasCheckpointer: !!checkpointer,
      hasIndexId: !!indexId,
      indexId: indexId ?? undefined,
    });

    try {
      // Load previous conversation context
      const previousMessages = await this.loadSessionContext(
        sessionId,
        maxContextMessages,
      );

      // Add current message
      const allMessages = [...previousMessages, new HumanMessage(message)];

      logger.verbose("Context prepared", {
        previousCount: previousMessages.length,
        totalCount: allMessages.length,
      });

      // Stream with context using the optional checkpointer
      yield* this.streamChatEvents(
        { userId, messages: allMessages, indexId },
        sessionId,
        checkpointer,
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
    input: { userId: string; messages: BaseMessage[]; indexId?: string },
    sessionId: string,
    checkpointer?: MemorySaver | PostgresSaver,
  ): AsyncGenerator<ChatStreamEvent> {
    const graph = this.createStreamingGraph(checkpointer);

    try {
      const initialState: {
        userId: string;
        messages: BaseMessage[];
        indexId?: string;
        sessionId?: string;
      } = {
        userId: input.userId,
        messages: input.messages,
      };
      if (input.indexId) initialState.indexId = input.indexId;
      initialState.sessionId = sessionId;

      // Use graph.stream() with custom + updates modes.
      // Custom events come from config.writer() inside agentLoopNode.
      const eventStream = await graph.stream(initialState, {
        streamMode: ["custom", "updates"] as const,
        configurable: { thread_id: sessionId },
      });

      // Emit initial status
      yield createStatusEvent(sessionId, "Processing your message...");

      for await (const tuple of eventStream) {
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

          if (event.type === "negotiation_progress") {
            logger.debug("Negotiation progress", {
              negotiationId: event.negotiationId,
              eventType: event.eventType,
              candidateName: event.candidateName,
            });
            yield createNegotiationProgressEvent(sessionId, {
              negotiationId: event.negotiationId,
              candidateUserId: event.candidateUserId,
              candidateName: event.candidateName,
              eventType: event.eventType,
              turn: event.turn,
              maxTurns: event.maxTurns,
              speaker: event.speaker,
              message: event.message,
              decision: event.decision,
              outcome: event.outcome,
              reasoning: event.reasoning,
            });
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
            | { graph: string; iterations: number; tools?: DebugMetaToolCall[] }
            | undefined;
          if (
            debugMeta?.graph != null &&
            typeof debugMeta.iterations === "number"
          ) {
            yield createDebugMetaEvent(
              sessionId,
              debugMeta.graph,
              debugMeta.iterations,
              Array.isArray(debugMeta.tools) ? debugMeta.tools : [],
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
