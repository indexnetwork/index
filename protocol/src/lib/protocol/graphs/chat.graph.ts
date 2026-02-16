import { StateGraph, START, END, MemorySaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { BaseMessage } from "@langchain/core/messages";
import { ChatGraphState } from "../states/chat.state";
import { ChatAgent } from "../agents/chat.agent";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type { Embedder } from "../interfaces/embedder.interface";
import type { Scraper } from "../interfaces/scraper.interface";
import { protocolLogger } from "../support/protocol.logger";
import { ChatStreamer } from "../streamers";

const logger = protocolLogger("ChatGraphFactory");

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
   * Load previous messages for a conversation.
   *
   * In the XMTP architecture, conversation context is managed by the XMTP
   * agent, not stored in PostgreSQL. This method returns an empty array;
   * the XMTP agent (Task 6) will inject context directly when invoking
   * the graph.
   *
   * @param _sessionId - The conversation/session ID (unused)
   * @param _maxMessages - Maximum number of messages (unused)
   * @returns Empty array -- context is supplied by the XMTP agent
   */
  public async loadSessionContext(
    _sessionId: string,
    _maxMessages: number = 20
  ): Promise<BaseMessage[]> {
    // No-op: XMTP agent supplies conversation context directly.
    return [];
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
      logger.info("Agent loop starting", {
        userId: state.userId,
        messageCount: state.messages.length,
        currentIteration: state.iterationCount
      });

      try {
        // Create agent with current user context (async factory resolves user/index from DB)
        const indexId = state.indexId;
        const agent = await ChatAgent.create({
          userId: state.userId,
          database,
          embedder,
          scraper,
          indexId,
        });

        // Run the agent loop with streaming narration via config.writer
        const result = await agent.streamRun(state.messages, config.writer);
        logger.debug("Agent streamRun result", {
          responseText: result.responseText,
          iterationCount: result.iterationCount,
          messageCount: result.messages.length,
        });

        logger.info("Agent loop complete", {
          userId: state.userId,
          iterations: result.iterationCount,
          responseLength: result.responseText.length
        });
        return {
          messages: result.messages,
          responseText: result.responseText,
          iterationCount: result.iterationCount,
          shouldContinue: false,
        };
      } catch (error) {
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
    };

    // ─────────────────────────────────────────────────────────────────────────
    // GRAPH ASSEMBLY
    // ─────────────────────────────────────────────────────────────────────────

    const workflow = new StateGraph(ChatGraphState)
      .addNode("agent_loop", agentLoopNode)
      .addEdge(START, "agent_loop")
      .addEdge("agent_loop", END);

    logger.info("Graph built successfully (agent loop architecture)");
    return workflow;
  }
}
