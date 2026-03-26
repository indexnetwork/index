import type { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  BaseMessage,
  SystemMessage,
  ToolMessage,
  AIMessageChunk,
} from "@langchain/core/messages";
import {
  createChatTools,
  type ToolContext,
  type ResolvedToolContext,
} from "../tools";
import { resolveChatContext } from "../tools/tool.helpers";
import { ITERATION_NUDGE, buildSystemContent } from "./chat.prompt";
import {
  extractRecentToolCalls,
  type IterationContext,
} from "./chat.prompt.modules";
import { protocolLogger } from "../support/protocol.logger";
import { createModel } from "./model.config";
import { sanitizeForDebugMeta } from "../support/debug-meta.sanitizer";
import type { DebugMetaToolCall } from "../../../types/chat-streaming.types";
import { Timed } from "../../performance";
import { requestContext } from "../../request-context";

const logger = protocolLogger("ChatAgent");

// Re-export for external consumers
export { ITERATION_NUDGE } from "./chat.prompt";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Writer callback for streaming custom data out of the graph node.
 * Matches the `config.writer` signature from LangGraphRunnableConfig.
 */
export type StreamWriter = (data: unknown) => void;

/**
 * Events emitted by `streamRun()` via the writer callback.
 *
 * - `iteration_start` — new agent loop iteration begins
 * - `llm_start`       — LLM begins generating response
 * - `text_chunk`      — a token (or group of tokens) of model text
 * - `llm_end`         — LLM finished generating (may have tool calls)
 * - `tool_activity`   — tool starts or finishes execution
 * - `graph_start`     — a LangGraph sub-graph begins inside a tool
 * - `graph_end`       — a LangGraph sub-graph completes
 * - `agent_start`     — an LLM agent begins inside a graph node
 * - `agent_end`       — an LLM agent completes
 */
export type AgentStreamEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "llm_start"; iteration: number }
  | { type: "text_chunk"; content: string }
  | { type: "llm_end"; iteration: number; hasToolCalls: boolean; toolNames?: string[] }
  | { type: "tool_activity"; phase: "start"; name: string }
  | {
      type: "tool_activity";
      phase: "end";
      name: string;
      success: boolean;
      summary?: string;
      steps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
    }
  | { type: "response_reset"; reason: string }
  | { type: "hallucination_detected"; blockType: string; tool: string }
  | { type: "graph_start"; name: string }
  | { type: "graph_end"; name: string; durationMs: number }
  | { type: "agent_start"; name: string }
  | { type: "agent_end"; name: string; durationMs: number; summary: string };

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Soft limit: After this many iterations, inject a nudge message.
 */
export const SOFT_ITERATION_LIMIT = 8;

/**
 * Hard limit: Force exit after this many iterations to prevent infinite loops.
 */
export const HARD_ITERATION_LIMIT = 12;

/**
 * Extract plain text from message content (string or structured block array).
 * Filters to only `type: "text"` blocks, discarding tool metadata.
 */
function extractTextContent(content: string | Array<Record<string, unknown>>): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: "text"; text?: string } => (b as { type?: string }).type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
  return "";
}

/**
 * Extract plain text from an AIMessageChunk (string content or text blocks).
 */
function extractTextFromChunk(chunk: AIMessageChunk): string {
  return extractTextContent(chunk.content as string | Array<Record<string, unknown>>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of a single agent iteration.
 */
export interface AgentIterationResult {
  /** Whether the agent wants to continue (made tool calls) or stop (produced final response) */
  shouldContinue: boolean;
  /** Tool calls made in this iteration (if any) */
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  /** Tool results from executing the tool calls */
  toolResults?: Array<{
    toolCallId: string;
    name: string;
    result: string;
  }>;
  /** Final response text (if agent is done) */
  responseText?: string;
  /** Updated messages array */
  messages: BaseMessage[];
}

/**
 * ChatAgent: ReAct-style agent that uses tools to help users.
 *
 * The agent operates in a loop:
 * 1. Receive messages (conversation history + tool results)
 * 2. Decide: call tools OR respond to user
 * 3. If tools called: execute them, add results, loop back
 * 4. If response: return final text
 *
 * Use `ChatAgent.create(context)` to construct (async factory).
 */
export class ChatAgent {
  private model: ChatOpenAI;
  private tools: Awaited<ReturnType<typeof createChatTools>>;
  private toolsByName: Map<string, any>;

  /**
   * Private constructor — use `ChatAgent.create()` instead.
   */
  private constructor(
    private resolvedContext: ResolvedToolContext,
    tools: Awaited<ReturnType<typeof createChatTools>>,
  ) {
    this.model = createModel("chat");

    // Store tools and index by name
    this.tools = tools;
    this.toolsByName = new Map();
    for (const tool of this.tools) {
      this.toolsByName.set(tool.name, tool);
    }

    // Bind tools to model
    this.model = this.model.bindTools(this.tools) as ChatOpenAI;
  }

  /**
   * Extracts the text content of the most recent HumanMessage.
   */
  private static getCurrentUserMessage(messages: BaseMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]._getType() === "human") {
        const content = messages[i].content;
        return typeof content === "string" ? content : undefined;
      }
    }
    return undefined;
  }

  /**
   * Async factory: creates a ChatAgent with resolved user/index context.
   * Resolves user/index identity from DB during tool initialization.
   */
  static async create(context: ToolContext): Promise<ChatAgent> {
    const resolved: ResolvedToolContext = await resolveChatContext({
      database: context.database,
      userId: context.userId,
      indexId: context.indexId,
      sessionId: context.sessionId,
    });
    const tools = await createChatTools(context, resolved);
    return new ChatAgent(resolved, tools);
  }

  /**
   * Run a single iteration of the agent loop.
   *
   * @param messages - Current conversation including any tool results
   * @param iterationCount - Current iteration number (for soft limit)
   * @returns Result indicating whether to continue and any tool calls/response
   */
  @Timed()
  async runIteration(
    messages: BaseMessage[],
    iterationCount: number,
  ): Promise<AgentIterationResult> {
    const iterCtx: IterationContext = {
      recentTools: extractRecentToolCalls(messages),
      currentMessage: ChatAgent.getCurrentUserMessage(messages),
      ctx: this.resolvedContext,
    };
    const systemContent = buildSystemContent(this.resolvedContext, iterCtx);

    const fullMessages: BaseMessage[] = [
      new SystemMessage(systemContent),
      ...messages,
    ];

    // Add nudge if past soft limit
    if (iterationCount >= SOFT_ITERATION_LIMIT) {
      fullMessages.push(new SystemMessage(ITERATION_NUDGE));
    }

    logger.verbose("Agent iteration", {
      iteration: iterationCount,
      messageCount: messages.length,
      pastSoftLimit: iterationCount >= SOFT_ITERATION_LIMIT,
    });

    // Invoke model
    const response = await this.model.invoke(fullMessages);
    logger.debug("Chat model response", {
      content:
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content),
      toolCalls: response.tool_calls?.length ?? 0,
      toolCallNames: response.tool_calls?.map((tc) => tc.name) ?? [],
    });

    // Check if model made tool calls
    const toolCalls = response.tool_calls || [];

    if (toolCalls.length > 0) {
      logger.verbose("Agent made tool calls", {
        iteration: iterationCount,
        toolCount: toolCalls.length,
        tools: toolCalls.map((tc) => tc.name),
      });

      // Execute tools (can be parallelized if independent)
      const toolResults = await this.executeToolCalls(toolCalls);

      // Build updated messages
      const updatedMessages = [
        ...messages,
        response, // AIMessage with tool_calls
        ...toolResults.map(
          (tr) =>
            new ToolMessage({
              tool_call_id: tr.toolCallId,
              content: tr.result,
              name: tr.name,
            }),
        ),
      ];

      return {
        shouldContinue: true,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id!,
          name: tc.name,
          args: tc.args as Record<string, unknown>,
        })),
        toolResults,
        messages: updatedMessages,
      };
    }

    // No tool calls - agent is responding
    const responseText = extractTextContent(
      response.content as string | Array<Record<string, unknown>>,
    );
    logger.debug("Agent produced response (raw)", {
      iteration: iterationCount,
      responseText,
    });
    logger.verbose("Agent produced response", {
      iteration: iterationCount,
      responseLength: responseText.length,
    });

    return {
      shouldContinue: false,
      responseText,
      messages: [...messages, response],
    };
  }

  /**
   * Execute tool calls, potentially in parallel.
   */
  private async executeToolCalls(
    toolCalls: Array<{
      id?: string;
      name: string;
      args: Record<string, unknown>;
    }>,
  ): Promise<Array<{ toolCallId: string; name: string; result: string }>> {
    // Execute all tool calls in parallel
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const tool = this.toolsByName.get(tc.name);

        if (!tool) {
          logger.error("Unknown tool", { name: tc.name });
          return {
            toolCallId: tc.id || `unknown-${Date.now()}`,
            name: tc.name,
            result: JSON.stringify({
              success: false,
              error: `Unknown tool: ${tc.name}`,
            }),
          };
        }

        try {
          logger.verbose("Executing tool", { name: tc.name, args: tc.args });
          let result = await tool.invoke(tc.args);
          let resultStr =
            typeof result === "string" ? result : JSON.stringify(result);

          if (tc.name === "create_opportunities") {
            const newResult = await this.handleCreateIntentCallback(resultStr, tc.args);
            if (newResult !== null) {
              resultStr = newResult;
              result = newResult;
            }
          }

          logger.debug("Tool response", { name: tc.name, result: resultStr });
          logger.verbose("Tool completed", {
            name: tc.name,
            resultLength: resultStr.length,
          });

          return {
            toolCallId: tc.id || `${tc.name}-${Date.now()}`,
            name: tc.name,
            result: resultStr,
          };
        } catch (error) {
          logger.error("Tool execution failed", {
            name: tc.name,
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            toolCallId: tc.id || `${tc.name}-${Date.now()}`,
            name: tc.name,
            result: JSON.stringify({
              success: false,
              error: `Tool execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            }),
          };
        }
      }),
    );

    return results;
  }

  /**
   * When create_opportunities returned createIntentSuggested, call create_intent then create_opportunities.
   * Returns the new create_opportunities result string or null if no callback / create_intent failed.
   */
  private async handleCreateIntentCallback(
    resultStr: string,
    originalArgs: Record<string, unknown>
  ): Promise<string | null> {
    let parsed: { success?: boolean; error?: string; data?: { createIntentSuggested?: boolean; suggestedIntentDescription?: string } };
    try {
      parsed = JSON.parse(resultStr) as typeof parsed;
    } catch {
      return null;
    }
    if (
      !parsed?.data?.createIntentSuggested ||
      typeof parsed.data.suggestedIntentDescription !== "string"
    ) {
      return null;
    }
    // Never auto-create intents during introducer flows — signals are personal
    if ((originalArgs as { introTargetUserId?: string }).introTargetUserId) {
      return null;
    }
    const createIntentTool = this.toolsByName.get("create_intent");
    const createOpportunitiesTool = this.toolsByName.get("create_opportunities");
    if (!createIntentTool || !createOpportunitiesTool) return null;

    logger.verbose("Create-intent signal: auto-calling create_intent then create_opportunities");
    const createIntentResult = await createIntentTool.invoke({
      description: parsed.data.suggestedIntentDescription,
      indexId: (originalArgs as { indexId?: string }).indexId,
    });
    const createIntentStr =
      typeof createIntentResult === "string" ? createIntentResult : JSON.stringify(createIntentResult);
    let createIntentParsed: { success?: boolean; error?: string };
    try {
      createIntentParsed = JSON.parse(createIntentStr) as { success?: boolean; error?: string };
    } catch {
      createIntentParsed = {};
    }
    if (createIntentParsed.success === false) {
      logger.warn("Create-intent failed; not re-running create_opportunities", {
        error: createIntentParsed.error,
      });
      return null;
    }

    const newResult = await createOpportunitiesTool.invoke(originalArgs);
    return typeof newResult === "string" ? newResult : JSON.stringify(newResult);
  }

  /**
   * Detect hallucinated ```intent_proposal or ```opportunity blocks in model text
   * that were NOT generated by the corresponding tool call.
   *
   * A tool call that returned 0 cards (e.g. "Found 0 match(es)") counts as
   * NOT having produced valid blocks — the LLM must not fabricate them.
   *
   * @returns Block info if hallucination detected, null otherwise
   */
  private detectHallucinatedBlock(
    text: string,
    toolsUsed: Array<{ name: string; success: boolean; resultSummary?: string }>,
  ): { type: string; tool: string; description: string } | null {
    // Only trust successful tool calls that actually returned results.
    // A call that returned "Found 0 match(es)" doesn't produce valid blocks.
    const hasSuccessfulCreateIntent = toolsUsed.some(
      (t) => t.name === "create_intent" && t.success,
    );
    const hasSuccessfulCreateOpportunities = toolsUsed.some(
      (t) =>
        t.name === "create_opportunities" &&
        t.success &&
        !t.resultSummary?.startsWith("Found 0") &&
        !t.resultSummary?.startsWith("No matches"),
    );

    // Check for hallucinated intent_proposal
    if (text.includes("```intent_proposal") && !hasSuccessfulCreateIntent) {
      const match = text.match(/```intent_proposal\s*\n\s*\{[^}]*"description"\s*:\s*"([^"]+)"/);
      if (match) {
        return { type: "intent_proposal", tool: "create_intent", description: match[1] };
      }
    }

    // Check for hallucinated opportunity blocks
    if (text.includes("```opportunity") && !hasSuccessfulCreateOpportunities) {
      // Extract a search query from the hallucinated block for the correction call
      const nameMatch = text.match(/```opportunity\s*\n\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
      const reasoningMatch = text.match(/```opportunity\s*\n\s*\{[^}]*"reasoning"\s*:\s*"([^"]+)"/);
      const description = nameMatch?.[1] || reasoningMatch?.[1] || "find connections";
      return { type: "opportunity", tool: "create_opportunities", description };
    }

    return null;
  }

  /**
   * Strip ```opportunity and ```intent_proposal code blocks from text
   * when no corresponding successful tool call was made.
   * Defense-in-depth: catches hallucinated blocks that slip past detectHallucinatedBlock
   * (e.g. after a correction iteration that still hallucinates).
   *
   * @param text - The response text to sanitize
   * @param toolsUsed - Tool call records from the agent loop
   * @returns Sanitized text with unbacked blocks removed
   */
  private stripUnbackedBlocks(
    text: string,
    toolsUsed: Array<{ name: string; success: boolean; resultSummary?: string }>,
  ): string {
    let result = text;
    let removedBlock = false;

    const hasSuccessfulCreateOpportunities = toolsUsed.some(
      (t) =>
        t.name === "create_opportunities" &&
        t.success &&
        !t.resultSummary?.startsWith("Found 0") &&
        !t.resultSummary?.startsWith("No matches"),
    );
    const hasSuccessfulCreateIntent = toolsUsed.some(
      (t) => t.name === "create_intent" && t.success,
    );

    if (!hasSuccessfulCreateOpportunities && result.includes("```opportunity")) {
      const next = result.replace(/```opportunity\s*\n[\s\S]*?```/g, "");
      removedBlock ||= next !== result;
      result = next;
    }
    if (!hasSuccessfulCreateIntent && result.includes("```intent_proposal")) {
      const next = result.replace(/```intent_proposal\s*\n[\s\S]*?```/g, "");
      removedBlock ||= next !== result;
      result = next;
    }

    // Clean up leftover double blank lines only when a block was actually removed
    if (removedBlock) {
      result = result.replace(/\n{3,}/g, "\n\n").trim();
    }

    return result;
  }

  // ─── Shared tool-result post-processing types ─────────────────────────────
  private static readonly STEP_DETAIL_MAX = 300;

  private static readonly STEP_NAME_MAX = 100;

  /**
   * Post-process a tool result: strip _graphTimings, extract summary/debugSteps,
   * and optionally run create_opportunities → create_intent callback.
   *
   * Returns the normalized result string and extracted debug metadata so both
   * the normal streaming tool loop and the hallucination-recovery branch
   * produce identical LLM-facing payloads.
   */
  private async normalizeToolResult(
    toolName: string,
    resultStr: string,
    toolArgs: Record<string, unknown>,
  ): Promise<{
    resultStr: string;
    summary: string;
    debugSteps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
    graphTimings?: Array<{ name: string; durationMs: number; agents: Array<{ name: string; durationMs: number }> }>;
  }> {
    let normalized = resultStr;

    // Run create_intent callback for create_opportunities results
    if (toolName === "create_opportunities") {
      const callbackResult = await this.handleCreateIntentCallback(normalized, toolArgs);
      if (callbackResult !== null) {
        normalized = callbackResult;
      }
    }

    type StepData = Record<string, unknown>;
    type DebugStep = { step: string; detail?: string; data?: StepData };
    type GraphTiming = { name: string; durationMs: number; agents: Array<{ name: string; durationMs: number }> };

    let summary = "Done";
    let debugSteps: DebugStep[] | undefined;
    let graphTimings: GraphTiming[] | undefined;

    try {
      const parsed = JSON.parse(normalized) as {
        success?: boolean;
        data?: {
          summary?: string;
          debugSteps?: DebugStep[];
          _graphTimings?: GraphTiming[];
        };
        summary?: string;
        debugSteps?: DebugStep[];
        _graphTimings?: GraphTiming[];
      };
      const payload = parsed.success && parsed.data != null ? parsed.data : parsed;
      summary = payload.summary ?? parsed.summary ?? "Done";

      const rawSteps = payload.debugSteps ?? parsed.debugSteps;
      if (Array.isArray(rawSteps) && rawSteps.length > 0) {
        debugSteps = rawSteps.map((s) => ({
          step: String(s.step ?? "").slice(0, ChatAgent.STEP_NAME_MAX),
          detail:
            s.detail != null
              ? String(s.detail).slice(0, ChatAgent.STEP_DETAIL_MAX)
              : undefined,
          ...(s.data && typeof s.data === "object" ? { data: s.data } : {}),
        }));
      }

      const rawGraphTimings = payload._graphTimings ?? parsed._graphTimings;
      if (Array.isArray(rawGraphTimings) && rawGraphTimings.length > 0) {
        graphTimings = rawGraphTimings as GraphTiming[];
        // Strip _graphTimings from the result string sent back to the LLM
        try {
          const cleanedResult = JSON.parse(normalized) as Record<string, unknown>;
          delete cleanedResult._graphTimings;
          if (cleanedResult.data && typeof cleanedResult.data === "object") {
            delete (cleanedResult.data as Record<string, unknown>)._graphTimings;
          }
          normalized = JSON.stringify(cleanedResult);
        } catch { /* keep original if can't clean */ }
      }
    } catch {
      /* not JSON, keep default */
    }

    return { resultStr: normalized, summary, debugSteps, graphTimings };
  }

  /**
   * Run the full agent loop until completion or hard limit.
   *
   * @param initialMessages - Starting conversation messages
   * @returns Final response text and full message history
   */
  @Timed()
  async run(initialMessages: BaseMessage[]): Promise<{
    responseText: string;
    messages: BaseMessage[];
    iterationCount: number;
  }> {
    let messages = initialMessages;
    let iterationCount = 0;

    while (iterationCount < HARD_ITERATION_LIMIT) {
      const result = await this.runIteration(messages, iterationCount);
      iterationCount++;
      messages = result.messages;

      if (!result.shouldContinue) {
        const responseText =
          result.responseText ||
          "I apologize, but I couldn't generate a response.";
        logger.debug("Agent final response", { responseText });
        return {
          responseText,
          messages,
          iterationCount,
        };
      }
    }

    // Hit hard limit - force a response
    logger.warn("Hit hard iteration limit", { iterationCount });

    const forceResponseMessages = [
      ...messages,
      new SystemMessage(
        "You have reached the maximum number of tool calls. You MUST provide a final response now. Summarize what you've accomplished and what might still be needed.",
      ),
    ];

    const forcedResponse = await this.model.invoke(forceResponseMessages);
    const responseText = extractTextContent(
      forcedResponse.content as string | Array<Record<string, unknown>>,
    );
    logger.debug("Agent forced response", { responseText });

    return {
      responseText,
      messages: [...messages, forcedResponse],
      iterationCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STREAMING RUN (for narration-style output)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run the full agent loop with streaming narration.
   *
   * Instead of returning a single blob at the end, this method calls
   * `writer()` for every text token and tool-activity event so the
   * consumer (graph node) can push them out via `config.writer`.
   *
   * @param initialMessages - Starting conversation messages
   * @param writer - Callback to emit streaming events (from `config.writer`)
   * @param signal - Optional AbortSignal to cancel the streaming LLM call and tool execution
   * @returns Final response metadata (same shape as `run()`)
   */
  @Timed()
  async streamRun(
    initialMessages: BaseMessage[],
    writer?: StreamWriter,
    signal?: AbortSignal,
  ): Promise<{
    responseText: string;
    messages: BaseMessage[];
    iterationCount: number;
    debugMeta: { graph: string; iterations: number; tools: DebugMetaToolCall[] };
  }> {
    const emit = (event: AgentStreamEvent) => {
      try {
        writer?.(event);
      } catch {
        /* swallow if writer is gone */
      }
    };

    let messages = initialMessages;
    let iterationCount = 0;
    const toolsDebug: DebugMetaToolCall[] = [];

    while (iterationCount < HARD_ITERATION_LIMIT) {
      if (signal?.aborted) {
        logger.verbose("Stream aborted by client", { iterationCount });
        break;
      }
      emit({ type: "iteration_start", iteration: iterationCount });

      const iterCtx: IterationContext = {
        recentTools: extractRecentToolCalls(messages),
        currentMessage: ChatAgent.getCurrentUserMessage(messages),
        ctx: this.resolvedContext,
      };
      const systemContent = buildSystemContent(this.resolvedContext, iterCtx);
      const fullMessages: BaseMessage[] = [
        new SystemMessage(systemContent),
        ...messages,
      ];
      if (iterationCount >= SOFT_ITERATION_LIMIT) {
        fullMessages.push(new SystemMessage(ITERATION_NUDGE));
      }

      logger.verbose("Streaming iteration", {
        iteration: iterationCount,
        messageCount: messages.length,
        pastSoftLimit: iterationCount >= SOFT_ITERATION_LIMIT,
      });

      // ── Stream the model response token-by-token ──────────────────────
      emit({ type: "llm_start", iteration: iterationCount });

      let accumulated: AIMessageChunk | undefined;
      let iterationText = "";

      try {
        const stream = await this.model.stream(fullMessages, { signal });
        for await (const chunk of stream) {
          // Accumulate using AIMessageChunk.concat() so tool_call_chunks merge and tool_calls is populated
          accumulated = accumulated ? accumulated.concat(chunk) : chunk;

          // Emit text content tokens to the user immediately
          const textPart = extractTextFromChunk(chunk);
          if (textPart) {
            emit({ type: "text_chunk", content: textPart });
            iterationText += textPart;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          logger.verbose("LLM stream aborted by client", { iterationCount });
          break; // breaks the outer while loop
        }
        throw err; // re-throw non-abort errors
      }

      if (!accumulated) {
        logger.warn("Empty model response in streaming iteration", {
          iterationCount,
        });
        iterationCount++;
        continue;
      }

      // ── Check for tool calls ──────────────────────────────────────────
      const toolCalls = accumulated.tool_calls || [];

      emit({
        type: "llm_end",
        iteration: iterationCount,
        hasToolCalls: toolCalls.length > 0,
        toolNames: toolCalls.length > 0 ? toolCalls.map((tc) => tc.name) : undefined,
      });

      if (toolCalls.length > 0) {
        logger.verbose("Streaming: agent made tool calls", {
          iteration: iterationCount,
          tools: toolCalls.map((tc) => tc.name),
        });

        // Strip ```shell (or ```bash, ```plaintext, etc.) code fences that some models
        // (e.g. Gemini) wrap around narration text during tool-calling iterations.
        // Keep the narration content itself — only remove the fence markers.
        if (iterationText) {
          const cleaned = iterationText
            .replace(/```(?:shell|bash|plaintext|text|)\s*\n?/g, "")
            .replace(/```\s*$/gm, "");
          if (cleaned !== iterationText) {
            emit({ type: "response_reset", reason: "Stripped code fence markers from tool-calling narration" });
            if (cleaned.trim()) {
              emit({ type: "text_chunk", content: cleaned });
            }
            iterationText = cleaned;
          }
        }

        // Execute tools one-by-one.
        const toolResults: Array<{
          toolCallId: string;
          name: string;
          result: string;
        }> = [];
        for (const tc of toolCalls) {
          if (signal?.aborted) {
            logger.verbose("Stream aborted by client during tool execution");
            break;
          }
          emit({ type: "tool_activity", phase: "start", name: tc.name });

          const tool = this.toolsByName.get(tc.name);
          if (!tool) {
            const errResult = JSON.stringify({
              success: false,
              error: `Unknown tool: ${tc.name}`,
            });
            toolsDebug.push({
              name: tc.name,
              args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
              resultSummary: "Unknown tool",
              success: false,
              durationMs: 0,
            });
            emit({
              type: "tool_activity",
              phase: "end",
              name: tc.name,
              success: false,
              summary: "Unknown tool",
            });
            toolResults.push({
              toolCallId: tc.id || `unknown-${Date.now()}`,
              name: tc.name,
              result: errResult,
            });
            continue;
          }

          const toolStart = Date.now();
          try {
            logger.verbose("Streaming: executing tool", { name: tc.name });
            const currentCtx = requestContext.getStore() ?? {};
            let result = await requestContext.run(
              { ...currentCtx, traceEmitter: (e) => emit({ type: e.type, name: e.name, durationMs: e.durationMs, summary: e.summary } as AgentStreamEvent) },
              () => tool.invoke(tc.args),
            );
            const toolDurationMs = Date.now() - toolStart;
            let resultStr =
              typeof result === "string" ? result : JSON.stringify(result);

            const normalized = await this.normalizeToolResult(tc.name, resultStr, tc.args);
            resultStr = normalized.resultStr;
            result = resultStr;

            logger.verbose("Streaming: tool completed", {
              name: tc.name,
              resultLength: resultStr.length,
            });

            toolsDebug.push({
              name: tc.name,
              args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
              resultSummary: normalized.summary,
              success: true,
              durationMs: toolDurationMs,
              ...(normalized.debugSteps?.length ? { steps: normalized.debugSteps } : {}),
              ...(normalized.graphTimings?.length ? { graphs: normalized.graphTimings } : {}),
            });
            emit({
              type: "tool_activity",
              phase: "end",
              name: tc.name,
              success: true,
              summary: normalized.summary,
              steps: normalized.debugSteps,
            });

            toolResults.push({
              toolCallId: tc.id || `${tc.name}-${Date.now()}`,
              name: tc.name,
              result: resultStr,
            });
          } catch (error) {
            const errMsg =
              error instanceof Error ? error.message : "Unknown error";
            logger.error("Streaming: tool failed", {
              name: tc.name,
              error: errMsg,
            });
            toolsDebug.push({
              name: tc.name,
              args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
              resultSummary: errMsg,
              success: false,
              durationMs: Date.now() - toolStart,
            });
            emit({
              type: "tool_activity",
              phase: "end",
              name: tc.name,
              success: false,
              summary: errMsg,
            });
            toolResults.push({
              toolCallId: tc.id || `${tc.name}-${Date.now()}`,
              name: tc.name,
              result: JSON.stringify({
                success: false,
                error: `Tool execution failed: ${errMsg}`,
              }),
            });
          }
        }

        // If aborted during tool execution, discard partial results
        if (signal?.aborted) {
          logger.verbose("Stream aborted after partial tool execution, discarding results");
          break; // break outer while loop — don't append partial toolResults to messages
        }

        // Build updated messages and loop
        messages = [
          ...messages,
          accumulated, // AIMessage with tool_calls
          ...toolResults.map(
            (tr) =>
              new ToolMessage({
                tool_call_id: tr.toolCallId,
                content: tr.result,
                name: tr.name,
              }),
          ),
        ];
        iterationCount++;
        continue;
      }

      // ── No tool calls → check for hallucinated code blocks ──────────
      // LLMs sometimes write ```intent_proposal or ```opportunity blocks
      // directly instead of calling the corresponding tool. These blocks
      // lack valid proposalIds / data and won't work in the frontend.
      // Auto-invoke the correct tool directly instead of re-asking the LLM.
      const hallucinatedBlock = this.detectHallucinatedBlock(iterationText, toolsDebug);
      if (hallucinatedBlock && iterationCount < HARD_ITERATION_LIMIT - 1) {
        logger.warn("Streaming: detected hallucinated block, auto-invoking tool", {
          iteration: iterationCount,
          blockType: hallucinatedBlock.type,
          tool: hallucinatedBlock.tool,
          extractedDescription: hallucinatedBlock.description,
        });
        // Tell the frontend to discard all streamed tokens from this iteration
        emit({ type: "response_reset", reason: `Hallucinated ${hallucinatedBlock.type} block detected` });
        emit({ type: "hallucination_detected", blockType: hallucinatedBlock.type, tool: hallucinatedBlock.tool });

        const tool = this.toolsByName.get(hallucinatedBlock.tool);
        if (tool) {
          const toolCallId = `auto-${hallucinatedBlock.tool}-${Date.now()}`;
          const toolArgs = hallucinatedBlock.type === "opportunity"
            ? { searchQuery: hallucinatedBlock.description }
            : { description: hallucinatedBlock.description };

          emit({ type: "tool_activity", phase: "start", name: hallucinatedBlock.tool });
          const toolStart = Date.now();
          try {
            const currentCtx = requestContext.getStore() ?? {};
            const result = await requestContext.run(
              { ...currentCtx, traceEmitter: (e) => emit({ type: e.type, name: e.name, durationMs: e.durationMs, summary: e.summary } as AgentStreamEvent) },
              () => tool.invoke(toolArgs),
            );
            const rawResultStr = typeof result === "string" ? result : JSON.stringify(result);
            const toolDurationMs = Date.now() - toolStart;

            // Same normalization as the main tool loop: callback + _graphTimings strip
            const normalized = await this.normalizeToolResult(hallucinatedBlock.tool, rawResultStr, toolArgs);

            toolsDebug.push({
              name: hallucinatedBlock.tool,
              args: sanitizeForDebugMeta(toolArgs) as Record<string, unknown>,
              resultSummary: normalized.summary,
              success: true,
              durationMs: toolDurationMs,
              ...(normalized.debugSteps?.length ? { steps: normalized.debugSteps } : {}),
              ...(normalized.graphTimings?.length ? { graphs: normalized.graphTimings } : {}),
            });
            emit({
              type: "tool_activity",
              phase: "end",
              name: hallucinatedBlock.tool,
              success: true,
              summary: normalized.summary,
              steps: normalized.debugSteps,
            });

            // Build synthetic tool call message + tool result so the next LLM
            // iteration can narrate around real data instead of hallucinated blocks.
            const syntheticAIMessage = new AIMessage({
              content: "",
              tool_calls: [{ id: toolCallId, name: hallucinatedBlock.tool, args: toolArgs }],
            });
            messages = [
              ...messages,
              syntheticAIMessage,
              new ToolMessage({ tool_call_id: toolCallId, content: normalized.resultStr, name: hallucinatedBlock.tool }),
            ];
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            logger.error("Streaming: auto-invoked tool failed after hallucination", {
              tool: hallucinatedBlock.tool,
              error: errMsg,
            });
            toolsDebug.push({
              name: hallucinatedBlock.tool,
              args: sanitizeForDebugMeta(toolArgs) as Record<string, unknown>,
              resultSummary: errMsg,
              success: false,
              durationMs: Date.now() - toolStart,
            });
            emit({ type: "tool_activity", phase: "end", name: hallucinatedBlock.tool, success: false, summary: errMsg });

            // Fall back to correction message if tool invocation fails
            messages = [
              ...messages,
              accumulated,
              new SystemMessage(
                `CORRECTION: You wrote a \`\`\`${hallucinatedBlock.type} block without calling ${hallucinatedBlock.tool}. ` +
                `The auto-retry failed (${errMsg}). Please try calling the tool directly.`
              ),
            ];
          }
        } else {
          // Tool not found — fall back to correction message
          messages = [
            ...messages,
            accumulated,
            new SystemMessage(
              `CORRECTION: You wrote a \`\`\`${hallucinatedBlock.type} block without calling ${hallucinatedBlock.tool}. ` +
              `That block is INVALID. Call the tool directly instead.`
            ),
          ];
        }
        iterationCount++;
        continue;
      }

      // ── Final response already streamed ─────────────────────────────
      // Defense-in-depth: strip any code blocks that require tool backing
      // but slipped through without a successful tool call.
      const sanitizedText = this.stripUnbackedBlocks(iterationText, toolsDebug);
      if (sanitizedText !== iterationText) {
        logger.warn("Streaming: stripped unbacked code blocks from final response", {
          originalLength: iterationText.length,
          sanitizedLength: sanitizedText.length,
        });
        emit({ type: "response_reset", reason: "Sanitized unbacked blocks from response" });
        // Re-emit the sanitized text so the frontend displays clean content
        if (sanitizedText.trim()) {
          emit({ type: "text_chunk", content: sanitizedText });
        }
      }

      logger.verbose("Streaming: agent produced response", {
        iteration: iterationCount,
        responseLength: sanitizedText.length,
      });
      messages = [...messages, accumulated];
      iterationCount++;

      return {
        responseText: sanitizedText,
        messages,
        iterationCount,
        debugMeta: { graph: "agent_loop", iterations: iterationCount, tools: toolsDebug },
      };
    }

    // If aborted, return immediately without making another LLM call
    if (signal?.aborted) {
      return {
        responseText: "",
        messages,
        iterationCount,
        debugMeta: { graph: "agent_loop", iterations: iterationCount, tools: toolsDebug },
      };
    }

    // ── Hard limit: force a response ──────────────────────────────────────
    logger.warn("Streaming: hit hard iteration limit", { iterationCount });

    const forceMessages = [
      ...messages,
      new SystemMessage(
        "You have reached the maximum number of tool calls. You MUST provide a final response now. Summarize what you've accomplished and what might still be needed.",
      ),
    ];

    let forcedAccumulated: AIMessageChunk | undefined;
    let forcedResponseText = "";
    const forceStream = await this.model.stream(forceMessages);
    for await (const chunk of forceStream) {
      forcedAccumulated = forcedAccumulated
        ? forcedAccumulated.concat(chunk)
        : chunk;
      const textPart = extractTextFromChunk(chunk);
      if (textPart) {
        emit({ type: "text_chunk", content: textPart });
        forcedResponseText += textPart;
      }
    }

    return {
      responseText: forcedResponseText,
      messages: [
        ...messages,
        ...(forcedAccumulated ? [forcedAccumulated] : []),
      ],
      iterationCount,
      debugMeta: { graph: "agent_loop", iterations: iterationCount, tools: toolsDebug },
    };
  }
}
