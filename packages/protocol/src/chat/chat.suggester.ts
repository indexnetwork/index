import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ChatSuggestion } from "./chat-streaming.types.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("SuggestionGenerator");

const suggestionItemSchema = z.object({
  label: z.string().describe("Short label for the chip (2-5 words)"),
  type: z.enum(["direct", "prompt"]).describe("direct = auto-submit message; prompt = prefill input"),
  followupText: z.string().nullable().describe("For type=direct: full message to send when clicked; null for prompt type"),
  prefill: z.string().nullable().describe("For type=prompt: text to prefill the input; null for direct type"),
});

const suggestionsSchema = z.object({
  suggestions: z
    .array(suggestionItemSchema)
    .min(1)
    .max(6)
    .describe("3-5 follow-up suggestions based on the conversation"),
});

const SYSTEM_PROMPT = `You generate follow-up suggestions for a chat user based on their conversation.

Rules:
- Return 3-5 suggestions. Mix of "direct" (one-click send) and "prompt" (prefill for user to edit).
- Labels must be short: 2-5 words (e.g. "Find collaborators", "Add more details").
- For type=direct: provide followupText as the exact message to send (complete sentence).
- For type=prompt: provide prefill as the start of a sentence the user can complete (e.g. "I need help with ").
- Suggestions must be relevant to the last exchange and natural next steps.
- Do not repeat what the user or assistant just said; suggest logical follow-ups.
- Voice: Calm, direct; no hype or networking clichés. Prefer words like opportunity, overlap, signal, pattern, relevant. Avoid: search, leverage, networking, match, optimize, scale.`;

export interface SuggestionGeneratorInput {
  /** Last few messages (user and assistant) to derive context */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Optional index/community context to tailor suggestions */
  indexContext?: string;
}

/**
 * Lightweight generator for context-aware chat follow-up suggestions.
 * Uses a fast model and structured output to return 3-5 suggestions per call.
 */
export class SuggestionGenerator {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const llm = createModel("suggestionGenerator");
    this.model = llm.withStructuredOutput(suggestionsSchema, { name: "chat_suggestions" });
  }

  /**
   * Generate follow-up suggestions from the last exchange.
   * Returns empty array on failure (graceful degradation).
   */
  @Timed()
  async generate(input: SuggestionGeneratorInput): Promise<ChatSuggestion[]> {
    const { messages, indexContext } = input;
    if (messages.length === 0) return [];

    const excerpt = messages
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
      .join("\n\n");

    const userContent = indexContext
      ? `Conversation (community context: ${indexContext}):\n\n${excerpt}\n\nGenerate 3-5 follow-up suggestions.`
      : `Conversation:\n\n${excerpt}\n\nGenerate 3-5 follow-up suggestions.`;

    try {
      const result = await invokeWithAbortSignal(this.model, [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(userContent),
      ]);
      const parsed = suggestionsSchema.safeParse(result);
      if (!parsed.success) {
        logger.warn("[SuggestionGenerator] Parse failed", { error: parsed.error.message });
        return [];
      }
      const out: ChatSuggestion[] = parsed.data.suggestions.map((s) => ({
        label: s.label,
        type: s.type,
        ...(s.type === "direct" && s.followupText != null && { followupText: s.followupText }),
        ...(s.type === "prompt" && s.prefill != null && { prefill: s.prefill }),
      }));
      logger.verbose("[SuggestionGenerator] Generated", { count: out.length });
      return out;
    } catch (error) {
      logger.warn("[SuggestionGenerator] Failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
