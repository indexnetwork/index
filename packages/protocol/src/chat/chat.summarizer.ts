/**
 * ChatSummarizer — rolling, incremental digest of a chat session. Takes the
 * previous persisted digest (if any) plus messages added since, returns a
 * structured ChatContextDigest. Pure: no DB, no events. Persistence is the
 * caller's responsibility (see backend ChatSummaryService).
 *
 * The model is instructed to drop entries in the previous digest that newer
 * messages override, keeping the digest bounded as the session grows.
 */
import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  ChatContextDigestSchema,
  type ChatContextDigest,
} from "../shared/schemas/chat-context.schema.js";
import { createModel } from "../shared/agent/model.config.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";

const logger = protocolLogger("ChatSummarizer");

const MESSAGE_CONTENT_CAP = 240;

const SYSTEM_PROMPT = `You distill chat sessions into a compact structured digest used to keep an assistant from asking obvious questions.

Output four arrays:
- statedFacts: facts the user volunteered (stage, location, role, timing, scope, budget, …).
- openQuestions: questions the assistant asked that the user has not yet answered.
- rejectionReasons: pushback the user gave on prior assistant proposals (e.g. "none of these fit — all US-based").
- surfacedFindings: facts the assistant has already shared with the user from prior negotiation results.

Rules:
- Drop entries from the previous digest that newer messages override or contradict.
- Keep each entry short (≤140 chars), specific, and standalone.
- Bound the digest: at most 20 statedFacts, 10 openQuestions, 10 rejectionReasons, 20 surfacedFindings. Drop the least relevant when over.
- Never invent facts. If the digest is empty for a category, output an empty array.`;

export interface ChatSummarizerMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSummarizerInput {
  previousDigest: ChatContextDigest | null;
  newMessages: ChatSummarizerMessage[];
}

/** Pure LLM summarizer; no DB, no events. */
export class ChatSummarizer {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const llm = createModel("chatContextSummarizer");
    this.model = llm.withStructuredOutput(ChatContextDigestSchema, {
      name: "chat_context_digest",
    });
  }

  /**
   * Summarize a chat session into a bounded structured digest.
   * @param input - Previous digest (or null) and any messages added since.
   * @returns Updated digest, or null on LLM failure / first-time empty input.
   */
  @Timed()
  async summarize(input: ChatSummarizerInput): Promise<ChatContextDigest | null> {
    if (input.newMessages.length === 0) {
      return input.previousDigest;
    }

    const truncated = input.newMessages.map((m) => ({
      role: m.role,
      content: m.content.length > MESSAGE_CONTENT_CAP
        ? m.content.slice(0, MESSAGE_CONTENT_CAP)
        : m.content,
    }));

    const user = [
      input.previousDigest
        ? `Previous digest:\n${JSON.stringify(input.previousDigest, null, 2)}`
        : "Previous digest: (none — this is the first summarization for this session)",
      "",
      "New messages (since previous digest):",
      ...truncated.map((m) => `  [${m.role}] ${m.content}`),
      "",
      "Produce the updated digest now.",
    ].join("\n");

    try {
      const response = await this.model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(user),
      ]);
      const parsed = ChatContextDigestSchema.safeParse(response);
      if (!parsed.success) {
        logger.warn("ChatSummarizer parse failed", { error: parsed.error.message });
        return null;
      }
      return parsed.data;
    } catch (err) {
      logger.warn("ChatSummarizer LLM call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
