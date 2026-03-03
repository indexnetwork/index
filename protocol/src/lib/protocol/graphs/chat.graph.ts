import { StateGraph, START, END, MemorySaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatGraphState } from "../states/chat.state";
import { ChatAgent } from "../agents/chat.agent";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type { Embedder } from "../interfaces/embedder.interface";
import type { Scraper } from "../interfaces/scraper.interface";
import { protocolLogger } from "../support/protocol.logger";
import { chatSessionService } from "../../../services/chat.service";
import { truncateToTokenLimit, MAX_CONTEXT_TOKENS } from "../support/chat.utils";
import { ChatStreamer } from "../streamers";
import { timed } from "../../performance";

const logger = protocolLogger("ChatGraphFactory");

function isRetriableError(err: unknown): boolean {
  const status =
    (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (typeof status === "number" && status >= 500 && status <= 599) return true;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("internal server error") ||
    /\b500\b|status[: ]*500/i.test(msg) ||
    lower.includes("econnreset") ||
    lower.includes("etimedout")
  );
}

const RETRY_DELAY_MS = 800;

// ══════════════════════════════════════════════════════════════════════════════
// CHAT GRAPH FACTORY (Agent Loop Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Factory class to build and compile the Chat Graph.
 * 
 * Architecture: ReAct-Style Agent Loop
 * 
 * The graph contains a single node that runs an agent loop:
 * 1. Agent receives messages (conversation + tool results)
 * 2. Agent decides: call tools OR respond to user
 * 3. If tools called → execute → add results → loop back
 * 4. If response → exit loop → stream to user
 * 
 * This replaces the previous 17-node conditional routing architecture
 * with a flexible, LLM-driven approach that can handle multi-step
 * reasoning and self-correction.
 */
export class ChatGraphFactory {
  private streamingService: ChatStreamer;

  constructor(
    private database: ChatGraphCompositeDatabase,
    private embedder: Embedder,
    private scraper: Scraper
  ) {
    this.streamingService = new ChatStreamer(
      (sessionId, maxMessages) => this.loadSessionContext(sessionId, maxMessages),
      (checkpointer) => this.createStreamingGraph(checkpointer)
    );
  }

  /**
   * Creates and compiles the Chat Graph without persistence.
   * @returns Compiled StateGraph ready for invocation
   */
  public createGraph() {
    return this.buildGraph().compile();
  }

  /**
   * Creates a streaming-enabled graph with optional checkpointer for persistence.
   * @param checkpointer - Optional checkpointer (e.g., MemorySaver or PostgresSaver)
   * @returns Compiled StateGraph ready for streaming
   */
  public createStreamingGraph(checkpointer?: MemorySaver | PostgresSaver) {
    const graph = this.buildGraph();
    if (checkpointer) {
      return graph.compile({ checkpointer });
    }
    return graph.compile();
  }

  /**
   * Load previous messages from a session and convert to LangChain messages.
   * Handles token truncation to fit within context window limits.
   *
   * @param sessionId - The session ID to load context from
   * @param maxMessages - Maximum number of messages to load (default: 20)
   * @returns Array of LangChain BaseMessage objects
   */
  public async loadSessionContext(
    sessionId: string,
    maxMessages: number = 20
  ): Promise<BaseMessage[]> {
    logger.verbose("Loading session context", {
      sessionId,
      maxMessages,
    });

    try {
      const messages = await chatSessionService.getSessionMessages(sessionId, maxMessages);

      if (messages.length === 0) {
        logger.verbose("No previous messages found", { sessionId });
        return [];
      }

      // Convert database messages to LangChain format
      const langchainMessages = messages.map((msg) => {
        if (msg.role === "user") {
          return new HumanMessage(msg.content);
        } else if (msg.role === "assistant") {
          return new HumanMessage(msg.content); // Using HumanMessage to avoid circular dependency
        } else {
          return new HumanMessage(msg.content);
        }
      });

      // Truncate to fit within token limits
      const truncatedMessages = truncateToTokenLimit(langchainMessages, MAX_CONTEXT_TOKENS);

      logger.verbose("Context loaded", {
        sessionId,
        originalCount: messages.length,
        truncatedCount: truncatedMessages.length,
      });
      return truncatedMessages;
    } catch (error) {
      logger.error("Failed to load context", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return empty array on error - don't fail the entire request
      return [];
    }
  }

  /**
   * Streams chat events with full session context.
   * Delegates to ChatGraphStreamingService.
   */
  public async *streamChatEventsWithContext(
    input: {
      userId: string;
      message: string;
      sessionId: string;
      maxContextMessages?: number;
      indexId?: string;
    },
    checkpointer?: MemorySaver | PostgresSaver
  ) {
    yield* this.streamingService.streamChatEventsWithContext(input, checkpointer);
  }

  /**
   * Streams chat events from the graph execution.
   * Delegates to ChatGraphStreamingService.
   */
  public async *streamChatEvents(
    input: { userId: string; messages: BaseMessage[] },
    sessionId: string,
    checkpointer?: MemorySaver | PostgresSaver
  ) {
    yield* this.streamingService.streamChatEvents(input, sessionId, checkpointer);
  }

  /**
   * Internal method to build the graph structure.
   * @returns Uncompiled StateGraph
   */
  private buildGraph() {
    const database = this.database;
    const embedder = this.embedder;
    const scraper = this.scraper;

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT LOOP NODE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The main agent loop node.
     * Runs a ReAct-style agent that calls tools until it decides to respond.
     *
     * Uses `agent.streamRun()` + `config.writer` so that text tokens and
     * tool-activity events are pushed into the graph's custom stream in
     * real-time rather than batched at the end.
     */
    const agentLoopNode = async (
      state: typeof ChatGraphState.State,
      config: LangGraphRunnableConfig
    ) => {
      return timed("ChatGraph.agentLoop", async () => {
        logger.verbose("Agent loop starting", {
          userId: state.userId,
          messageCount: state.messages.length,
          currentIteration: state.iterationCount
        });

        const runLoop = async () => {
          const indexId = state.indexId;
          // Direct streaming writer - emit events immediately instead of buffering
          const directWriter = (data: unknown) => {
            try {
              config.writer?.(data);
            } catch {
              /* swallow if writer is gone */
            }
          };
          const agent = await ChatAgent.create({
            userId: state.userId,
            database,
            embedder,
            scraper,
            indexId,
            sessionId: state.sessionId,
            streamWriter: directWriter,
          });
          const result = await agent.streamRun(state.messages, directWriter);
          return result;
        };

        try {
          const result = await runLoop();
          logger.debug("Agent streamRun result", {
            responseText: result.responseText,
            iterationCount: result.iterationCount,
            messageCount: result.messages.length,
          });
          logger.verbose("Agent loop complete", {
            userId: state.userId,
            iterations: result.iterationCount,
            responseLength: result.responseText.length
          });
          return {
            messages: result.messages,
            responseText: result.responseText,
            iterationCount: result.iterationCount,
            shouldContinue: false,
            debugMeta: result.debugMeta,
          };
        } catch (error) {
          if (isRetriableError(error)) {
            logger.warn("Agent loop failed with retriable error, retrying once", {
              userId: state.userId,
              error: error instanceof Error ? error.message : String(error)
            });
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            try {
              const result = await runLoop();
              logger.verbose("Agent loop complete after retry", {
                userId: state.userId,
                iterations: result.iterationCount,
              });
              return {
                messages: result.messages,
                responseText: result.responseText,
                iterationCount: result.iterationCount,
                shouldContinue: false,
                debugMeta: result.debugMeta,
              };
            } catch (retryError) {
              logger.error("Agent loop failed on retry", {
                userId: state.userId,
                error: retryError instanceof Error ? retryError.message : String(retryError)
              });
              return {
                error: retryError instanceof Error ? retryError.message : "Agent loop failed",
                responseText: "I apologize, but I encountered an issue processing your request. Please try again.",
                shouldContinue: false
              };
            }
          }

          logger.error("Agent loop failed", {
            userId: state.userId,
            error: error instanceof Error ? error.message : String(error)
          });

          return {
            error: error instanceof Error ? error.message : "Agent loop failed",
            responseText: "I apologize, but I encountered an issue processing your request. Please try again.",
            shouldContinue: false
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // GRAPH ASSEMBLY
    // ─────────────────────────────────────────────────────────────────────────

    const workflow = new StateGraph(ChatGraphState)
      .addNode("agent_loop", agentLoopNode)
      .addEdge(START, "agent_loop")
      .addEdge("agent_loop", END);

    logger.verbose("Graph built successfully (agent loop architecture)");
    return workflow;
  }
}
