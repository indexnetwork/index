import type { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, SystemMessage, ToolMessage, AIMessageChunk } from "@langchain/core/messages";
import { createChatTools, type ToolContext, type ResolvedToolContext } from "../shared/agent/tool.factory.js";
import { resolveChatContext } from "../shared/agent/tool.helpers.js";
import { ITERATION_NUDGE, buildSystemContent } from "./chat.prompt.js";
import { extractRecentToolCalls, type IterationContext } from "./chat.prompt.modules.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { createModel, type ModelConfig } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { sanitizeForDebugMeta } from "../shared/observability/debug-meta.sanitizer.js";
import type { DebugMetaToolCall, DebugMetaLlm, DebugMetaOrchestratorNegotiations, DebugMetaDiscoveryQuestions } from "./chat-streaming.types.js";
import type { Question, QuestionStrategy } from "../shared/schemas/question.schema.js";
import type { Opportunity } from "../shared/interfaces/database.interface.js";
import { Timed } from "../shared/observability/performance.js";
import { requestContext } from "../shared/observability/request-context.js";
import { deduplicateQuestions } from "./chat.question-dedup.js";

const logger = protocolLogger("ChatAgent");

// Re-export for external consumers
export { ITERATION_NUDGE } from "./chat.prompt.js";

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
 * - `opportunity_draft_ready` — an orchestrator-triggered negotiation finalized
 *                       to `draft` and the card is ready to render inline
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
  | { type: "phase_start"; name: string }
  | { type: "phase_end"; name: string; durationMs: number }
  | { type: "agent_start"; name: string }
  | { type: "agent_end"; name: string; durationMs: number; summary: string }
  | {
      // Emitted from the orchestrator branch of OpportunityGraph.negotiateNode
      // each time a per-candidate negotiation resolves to an accepted draft.
      // Carries the opportunity row plus the counterparty's display basics so
      // the frontend can append an inline card to the chat timeline without a
      // second round-trip user lookup.
      type: "opportunity_draft_ready";
      opportunityId: string;
      opportunity: Opportunity;
      /** Viewer-centric summary derived from interpretation.reasoning via viewerCentricCardSummary. */
      personalizedSummary?: string;
      counterparty: {
        userId: string;
        name?: string;
      };
    }
  | {
      type: "negotiation_session_start";
      opportunityId: string;
      negotiationConversationId: string;
      sourceUserId: string;
      candidateUserId: string;
      candidateName?: string;
      trigger: "orchestrator" | "ambient";
      startedAt: number;
    }
  | {
      type: "negotiation_session_end";
      opportunityId: string;
      negotiationConversationId: string;
      durationMs: number;
    }
  | {
      type: "negotiation_turn";
      opportunityId: string;
      negotiationConversationId: string;
      turnIndex: number;
      actor: "source" | "candidate";
      action: "propose" | "accept" | "reject" | "counter" | "question";
      reasoning?: string;
      message?: string;
      suggestedRoles?: { ownUser?: string; otherUser?: string };
      durationMs: number;
    }
  | {
      type: "negotiation_outcome";
      opportunityId: string;
      outcome:
        | "accepted"
        | "rejected_stalled"
        | "waiting_for_agent"
        | "timed_out"
        | "turn_cap";
      turnCount: number;
      reasoning?: string;
      agreedRoles?: { ownUser?: string; otherUser?: string };
    }
  | { type: "decision_questions"; questions: Question[] }
  | { type: "chat_summarizer_start"; payload: { sessionId: string } }
  | { type: "chat_summarizer_end"; payload: { durationMs: number } }
  | { type: "question_generator_start"; payload: { inputMode: "transcripts" | "insights"; negotiationCount: number; hasChatContext: boolean; truncated?: { originalCount: number; keptCount: number } } }
  | { type: "question_generator_end"; payload: { finalCount: number; strategies: QuestionStrategy[]; durationMs: number; inputMode: "transcripts" | "insights" } };

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
    modelConfig?: ModelConfig,
  ) {
    this.model = createModel("chat", modelConfig);

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
      networkId: context.networkId,
      sessionId: context.sessionId,
    });
    const tools = await createChatTools(context, resolved);
    return new ChatAgent(resolved, tools, context.modelConfig);
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
    const response = await invokeWithAbortSignal(this.model, fullMessages);
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

          if (tc.name === "discover_opportunities") {
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
   * When discover_opportunities returned createIntentSuggested, call create_intent then discover_opportunities.
   * Returns the new discover_opportunities result string or null if no callback / create_intent failed.
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
    const discoverOpportunitiesTool = this.toolsByName.get("discover_opportunities");
    if (!createIntentTool || !discoverOpportunitiesTool) return null;

    logger.verbose("Create-intent signal: auto-calling create_intent then discover_opportunities");
    const createIntentResult = await createIntentTool.invoke({
      description: parsed.data.suggestedIntentDescription,
      networkId: (originalArgs as { networkId?: string }).networkId,
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
      logger.warn("Create-intent failed; not re-running discover_opportunities", {
        error: createIntentParsed.error,
      });
      return null;
    }

    const newResult = await discoverOpportunitiesTool.invoke(originalArgs);
    return typeof newResult === "string" ? newResult : JSON.stringify(newResult);
  }

  /**
   * Check whether any tool call produced valid opportunity blocks.
   * Both `discover_opportunities` and `list_opportunities` can return
   * ```opportunity code blocks — either one counts as a valid source.
   */
  private static hasOpportunitySource(
    toolsUsed: Array<{ name: string; success: boolean; resultSummary?: string }>,
  ): boolean {
    return toolsUsed.some(
      (t) =>
        (t.name === "discover_opportunities" || t.name === "list_opportunities") &&
        t.success &&
        !t.resultSummary?.startsWith("Found 0") &&
        !t.resultSummary?.startsWith("No matches") &&
        !t.resultSummary?.startsWith("No opportunities"),
    );
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
    userMessage?: string,
  ): { type: string; tool: string; description: string } | null {
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

    // Check for hallucinated opportunity blocks
    if (text.includes("```opportunity") && !ChatAgent.hasOpportunitySource(toolsUsed)) {
      // Use the user's original message as the search query — NOT fields from the
      // hallucinated JSON. The model fabricates person names and reasoning that have
      // nothing to do with the user's actual request, leading to wrong results and
      // the model re-calling the tool with the correct query (doubling negotiation cost).
      const description = userMessage?.trim() || "find connections";
      return { type: "opportunity", tool: "discover_opportunities", description };
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

    const hasSuccessfulCreateIntent = toolsUsed.some(
      (t) => t.name === "create_intent" && t.success,
    );

    if (!ChatAgent.hasOpportunitySource(toolsUsed) && result.includes("```opportunity")) {
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

  // ─── Phantom write detection ─────────────────────────────────────────────

  private static readonly PHANTOM_WRITE_PATTERNS = [
    /\bI(?:'ve| have) (?:updated|adjusted|changed|modified|edited|created|added|removed|deleted|saved|set up)\b/i,
    /\bI (?:updated|adjusted|changed|modified|edited|created|added|removed|deleted|saved|set up)\b/i,
    /\b(?:Updated|Adjusted|Changed|Modified|Edited|Created|Added|Removed|Deleted|Saved) (?:your|the|their)\b/i,
    /\bEverything is (?:now )?(?:updated|changed|adjusted|saved|set)\b/i,
    /\b(?:profile|bio|premise|signal|intent|membership|narrative) (?:has been|is now) (?:updated|changed|modified|adjusted|saved)\b/i,
  ];

  /**
   * Detect when the model claims to have performed a write action
   * without having called any tools in the turn.
   */
  private static detectPhantomWrite(
    responseText: string,
    toolsUsed: Array<{ name: string }>,
  ): boolean {
    if (toolsUsed.length > 0) return false;
    return ChatAgent.PHANTOM_WRITE_PATTERNS.some(pattern => pattern.test(responseText));
  }

  // ─── Shared tool-result post-processing types ─────────────────────────────
  private static readonly STEP_DETAIL_MAX = 300;

  private static readonly STEP_NAME_MAX = 100;

  /**
   * Post-process a tool result: strip _graphTimings, extract summary/debugSteps,
   * and optionally run discover_opportunities → create_intent callback.
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
    decisionQuestions?: Question[];
    discoveryQuestionsDebug?: DebugMetaDiscoveryQuestions;
  }> {
    let normalized = resultStr;

    // Run create_intent callback for discover_opportunities results
    if (toolName === "discover_opportunities") {
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
    let decisionQuestions: Question[] | undefined;
    let discoveryQuestionsDebug: DebugMetaDiscoveryQuestions | undefined;

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

      const rawQuestions = (payload as { questions?: unknown }).questions ?? (parsed as { questions?: unknown }).questions;
      const rawQuestionDebug = (payload as { _discoveryQuestionsDebug?: unknown })._discoveryQuestionsDebug
        ?? (parsed as { _discoveryQuestionsDebug?: unknown })._discoveryQuestionsDebug;
      if (Array.isArray(rawQuestions)) {
        decisionQuestions = rawQuestions as Question[];
      }
      if (rawQuestionDebug && typeof rawQuestionDebug === "object") {
        discoveryQuestionsDebug = rawQuestionDebug as DebugMetaDiscoveryQuestions;
      }
      // `_discoveryQuestionsDebug` is internal trace data — strip from the LLM-facing
      // tool result. `questions` is intentionally kept visible so the agent can
      // follow the prompt addendum and reference the decision prompts in its reply.
      if (discoveryQuestionsDebug !== undefined) {
        try {
          const cleaned = JSON.parse(normalized) as Record<string, unknown>;
          const stripFrom = (obj: Record<string, unknown>) => {
            delete obj._discoveryQuestionsDebug;
          };
          stripFrom(cleaned);
          if (cleaned.data && typeof cleaned.data === "object") {
            stripFrom(cleaned.data as Record<string, unknown>);
          }
          normalized = JSON.stringify(cleaned);
        } catch { /* keep original */ }
      }
    } catch {
      /* not JSON, keep default */
    }

    return {
      resultStr: normalized,
      summary,
      debugSteps,
      graphTimings,
      ...(decisionQuestions !== undefined ? { decisionQuestions } : {}),
      ...(discoveryQuestionsDebug !== undefined ? { discoveryQuestionsDebug } : {}),
    };
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

    const forcedResponse = await invokeWithAbortSignal(this.model, forceResponseMessages);
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
    debugMeta: { graph: string; iterations: number; tools: DebugMetaToolCall[]; llm: DebugMetaLlm; orchestratorNegotiations?: DebugMetaOrchestratorNegotiations; discoveryQuestions?: DebugMetaDiscoveryQuestions };
  }> {
    const llm: DebugMetaLlm = { calls: 0, totalDurationMs: 0, resets: [], hallucinations: [] };
    const orchestratorNegotiationIds = new Set<string>();
    let lastLlmStart = 0;
    let latestDiscoveryQuestionsDebug: DebugMetaDiscoveryQuestions | undefined;

    const emit = (event: AgentStreamEvent) => {
      if (event.type === "llm_start") {
        llm.calls += 1;
        lastLlmStart = Date.now();
      } else if (event.type === "llm_end") {
        if (lastLlmStart > 0) {
          llm.totalDurationMs += Date.now() - lastLlmStart;
          lastLlmStart = 0;
        }
      } else if (event.type === "response_reset") {
        llm.resets.push({ reason: event.reason, at: Date.now() });
      } else if (event.type === "hallucination_detected") {
        llm.hallucinations.push({ blockType: event.blockType, tool: event.tool, at: Date.now() });
      } else if (event.type === "negotiation_session_start") {
        orchestratorNegotiationIds.add(event.opportunityId);
      }
      try {
        writer?.(event);
      } catch {
        /* swallow if writer is gone */
      }
    };

    let messages = initialMessages;
    let iterationCount = 0;
    const toolsDebug: DebugMetaToolCall[] = [];
    const surfacedQuestionIds = new Set<string>();
    const hallucinationAutoInvokeCounts = new Map<string, number>();

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

        // Clear any narration text streamed before tool calls — this text is
        // intermediate reasoning and should not appear in the final response.
        // The next iteration (after tool execution) will produce the real response.
        if (iterationText) {
          emit({ type: "response_reset", reason: "Tool calls detected" });
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
              {
                ...currentCtx,
                traceEmitter: (e) => emit(e as AgentStreamEvent),
                // Propagate the caller's AbortSignal into requestContext so
                // long-running graph nodes (orchestrator negotiation fan-out)
                // can suppress event emits after the chat session closes.
                ...(signal && { abortSignal: signal }),
              },
              () => tool.invoke(tc.args),
            );
            const toolDurationMs = Date.now() - toolStart;
            let resultStr =
              typeof result === "string" ? result : JSON.stringify(result);

            const normalized = await this.normalizeToolResult(tc.name, resultStr, tc.args);
            if (normalized.discoveryQuestionsDebug) latestDiscoveryQuestionsDebug = normalized.discoveryQuestionsDebug;
            resultStr = normalized.resultStr;
            result = resultStr;

            if (normalized.decisionQuestions && normalized.decisionQuestions.length > 0) {
              const { fresh, newIds } = deduplicateQuestions(normalized.decisionQuestions, surfacedQuestionIds);
              if (fresh.length > 0) {
                emit({ type: "decision_questions", questions: fresh });
                for (const id of newIds) surfacedQuestionIds.add(id);
              }
            }

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
      const hallucinatedBlock = this.detectHallucinatedBlock(iterationText, toolsDebug, iterCtx.currentMessage);
      const priorAutoInvokes = hallucinatedBlock ? (hallucinationAutoInvokeCounts.get(hallucinatedBlock.type) ?? 0) : 0;
      if (hallucinatedBlock && priorAutoInvokes < 2 && iterationCount < HARD_ITERATION_LIMIT - 1) {
        hallucinationAutoInvokeCounts.set(hallucinatedBlock.type, priorAutoInvokes + 1);
        logger.warn("Streaming: detected hallucinated block, auto-invoking tool", {
          iteration: iterationCount,
          blockType: hallucinatedBlock.type,
          tool: hallucinatedBlock.tool,
          extractedDescription: hallucinatedBlock.description,
          autoInvokeAttempt: priorAutoInvokes + 1,
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
              {
                ...currentCtx,
                traceEmitter: (e) => emit(e as AgentStreamEvent),
                // Propagate the caller's AbortSignal into requestContext so
                // long-running graph nodes (orchestrator negotiation fan-out)
                // can suppress event emits after the chat session closes.
                ...(signal && { abortSignal: signal }),
              },
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
            // Mirror the main tool loop's handling: forward decision questions
            // and capture debug metadata even when the discovery tool was invoked
            // via the hallucination-recovery path.
            if (normalized.discoveryQuestionsDebug) {
              latestDiscoveryQuestionsDebug = normalized.discoveryQuestionsDebug;
            }
            if (normalized.decisionQuestions && normalized.decisionQuestions.length > 0) {
              const { fresh: freshHallucination, newIds: newIdsHallucination } = deduplicateQuestions(normalized.decisionQuestions, surfacedQuestionIds);
              if (freshHallucination.length > 0) {
                emit({ type: "decision_questions", questions: freshHallucination });
                for (const id of newIdsHallucination) surfacedQuestionIds.add(id);
              }
            }
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

      // ── Circuit breaker: hallucination detected but auto-invoke cap reached ──
      if (hallucinatedBlock && priorAutoInvokes >= 2) {
        logger.warn("Streaming: hallucination auto-invoke cap reached, stripping blocks", {
          iteration: iterationCount,
          blockType: hallucinatedBlock.type,
          attempts: priorAutoInvokes,
        });
        emit({ type: "response_reset", reason: `Hallucination cap reached for ${hallucinatedBlock.type}` });
        const stripped = this.stripUnbackedBlocks(iterationText, toolsDebug);
        if (stripped.trim()) {
          emit({ type: "text_chunk", content: stripped });
        } else {
          messages = [
            ...messages,
            accumulated,
            new SystemMessage(
              "Your previous response only contained invalid code blocks that were removed. " +
              "Write a plain text response now — summarize the results of the tools you used. " +
              "Do NOT include ```opportunity or ```intent_proposal blocks.",
            ),
          ];
          iterationCount++;
          continue;
        }
      }

      // ── Phantom write: model claims a write action without calling any tools ──
      if (
        ChatAgent.detectPhantomWrite(iterationText, toolsDebug) &&
        iterationCount < HARD_ITERATION_LIMIT - 1
      ) {
        logger.warn("Streaming: detected phantom write claim without tool calls", {
          iteration: iterationCount,
        });
        emit({ type: "response_reset", reason: "Phantom write detected — no tools were called" });
        emit({ type: "hallucination_detected", blockType: "phantom_write", tool: "none" });

        messages = [
          ...messages,
          accumulated,
          new SystemMessage(
            "CORRECTION: You claimed to have performed an action (update, create, modify) but you did NOT call any tools. " +
            "The user's request has NOT been fulfilled. You MUST call the appropriate tool(s) to actually make the change, " +
            "then confirm based on the tool result. Do it now.",
          ),
        ];
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

        // If stripping removed ALL content, force a recovery iteration so the
        // user sees an actual response instead of a blank message.
        if (!sanitizedText.trim() && iterationCount < HARD_ITERATION_LIMIT - 1) {
          logger.warn("Streaming: sanitized text is empty, forcing recovery iteration", {
            iteration: iterationCount,
          });
          messages = [
            ...messages,
            accumulated,
            new SystemMessage(
              "Your previous response only contained invalid code blocks that were removed. " +
              "Write a plain text response now — summarize the results of the tools you used. " +
              "Do NOT include ```opportunity or ```intent_proposal blocks.",
            ),
          ];
          iterationCount++;
          continue;
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
        debugMeta: {
          graph: "agent_loop",
          iterations: iterationCount,
          tools: toolsDebug,
          llm,
          ...(orchestratorNegotiationIds.size > 0 && {
            orchestratorNegotiations: { opportunityIds: [...orchestratorNegotiationIds] },
          }),
          ...(latestDiscoveryQuestionsDebug && { discoveryQuestions: latestDiscoveryQuestionsDebug }),
        },
      };
    }

    // If aborted, return immediately without making another LLM call
    if (signal?.aborted) {
      return {
        responseText: "",
        messages,
        iterationCount,
        debugMeta: {
          graph: "agent_loop",
          iterations: iterationCount,
          tools: toolsDebug,
          llm,
          ...(orchestratorNegotiationIds.size > 0 && {
            orchestratorNegotiations: { opportunityIds: [...orchestratorNegotiationIds] },
          }),
          ...(latestDiscoveryQuestionsDebug && { discoveryQuestions: latestDiscoveryQuestionsDebug }),
        },
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
      debugMeta: {
        graph: "agent_loop",
        iterations: iterationCount,
        tools: toolsDebug,
        llm,
        ...(orchestratorNegotiationIds.size > 0 && {
          orchestratorNegotiations: { opportunityIds: [...orchestratorNegotiationIds] },
        }),
        ...(latestDiscoveryQuestionsDebug && { discoveryQuestions: latestDiscoveryQuestionsDebug }),
      },
    };
  }
}
