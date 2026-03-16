import type { ChatOpenAI } from "@langchain/openai";
import {
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
import { protocolLogger } from "../support/protocol.logger";
import { createModel } from "./model.config";
import { sanitizeForDebugMeta } from "../support/debug-meta.sanitizer";
import type { DebugMetaToolCall } from "../../../types/chat-streaming.types";
import { Timed } from "../../performance";

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
 */
export type AgentStreamEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "llm_start"; iteration: number }
  | { type: "text_chunk"; content: string }
  | { type: "llm_end"; iteration: number; hasToolCalls: boolean; toolNames?: string[] }
  | {
      type: "tool_activity";
      phase: "start";
      name: string;
    }
  | {
      type: "tool_activity";
      phase: "end";
      name: string;
      success: boolean;
      summary?: string;
      steps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
    };

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
    const systemContent = buildSystemContent(this.resolvedContext);

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
   * @returns Block info if hallucination detected, null otherwise
   */
  private detectHallucinatedBlock(
    text: string,
    toolsUsed: Array<{ name: string; success: boolean }>,
  ): { type: string; tool: string; description: string } | null {
    // Only trust successful create_intent calls — a failed attempt doesn't produce
    // a valid proposalId, so a subsequent inline block is still hallucinated.
    const hasSuccessfulCreateIntent = toolsUsed.some(
      (t) => t.name === "create_intent" && t.success,
    );

    // Check for hallucinated intent_proposal
    if (text.includes("```intent_proposal") && !hasSuccessfulCreateIntent) {
      const match = text.match(/```intent_proposal\s*\n\s*\{[^}]*"description"\s*:\s*"([^"]+)"/);
      if (match) {
        return { type: "intent_proposal", tool: "create_intent", description: match[1] };
      }
    }

    return null;
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

      const systemContent = buildSystemContent(this.resolvedContext);
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

        // Execute tools one-by-one. The model's own streamed text serves as
        // the narration; we only emit tool_activity "end" events for logging.
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

          try {
            logger.verbose("Streaming: executing tool", { name: tc.name });
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

            logger.verbose("Streaming: tool completed", {
              name: tc.name,
              resultLength: resultStr.length,
            });

            // Build brief summary for the activity event. Prefer tool-provided
            // summary. Tools use success(data) → { success: true, data: { ... } }, so read from data when present.
            let summary = "Done";
            type StepData = Record<string, unknown>;
            type DebugStep = { step: string; detail?: string; data?: StepData };
            let debugSteps: DebugStep[] | undefined;
            try {
              const parsed = JSON.parse(resultStr) as {
                success?: boolean;
                data?: {
                  summary?: string;
                  debugSteps?: DebugStep[];
                };
                summary?: string;
                debugSteps?: DebugStep[];
              };
              const payload = parsed.success && parsed.data != null ? parsed.data : parsed;
              summary = payload.summary ?? parsed.summary ?? "Done";
              const rawSteps = payload.debugSteps ?? parsed.debugSteps;
              if (Array.isArray(rawSteps) && rawSteps.length > 0) {
                const maxDetail = 300;
                debugSteps = rawSteps.map((s) => ({
                  step: String(s.step ?? "").slice(0, 100),
                  detail:
                    s.detail != null
                      ? String(s.detail).slice(0, maxDetail)
                      : undefined,
                  ...(s.data && typeof s.data === "object" ? { data: s.data } : {}),
                }));
              }
            } catch {
              /* not JSON, keep default */
            }

            toolsDebug.push({
              name: tc.name,
              args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
              resultSummary: summary,
              success: true,
              durationMs: 0,
              ...(debugSteps?.length ? { steps: debugSteps } : {}),
            });
            emit({
              type: "tool_activity",
              phase: "end",
              name: tc.name,
              success: true,
              summary,
              steps: debugSteps,
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
              durationMs: 0,
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
      // Detect this and force a correction iteration.
      const hallucinatedBlock = this.detectHallucinatedBlock(iterationText, toolsDebug);
      if (hallucinatedBlock && iterationCount < HARD_ITERATION_LIMIT - 1) {
        logger.warn("Streaming: detected hallucinated block without tool call", {
          iteration: iterationCount,
          blockType: hallucinatedBlock.type,
          extractedDescription: hallucinatedBlock.description,
        });
        messages = [
          ...messages,
          accumulated,
          new SystemMessage(
            `CORRECTION: You wrote a \`\`\`${hallucinatedBlock.type} block in your response without calling the required tool. ` +
            `That block is INVALID — it has no proposalId and will not work. ` +
            `You MUST call ${hallucinatedBlock.tool}(description="${hallucinatedBlock.description}") now. ` +
            `Only the tool generates valid blocks. Do NOT write the block yourself again.`
          ),
        ];
        iterationCount++;
        continue;
      }

      // ── Final response already streamed ─────────────────────────────
      logger.verbose("Streaming: agent produced response", {
        iteration: iterationCount,
        responseLength: iterationText.length,
      });
      messages = [...messages, accumulated];
      iterationCount++;

      return {
        responseText: iterationText,
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
