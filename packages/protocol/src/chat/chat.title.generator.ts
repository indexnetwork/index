import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";

import { createResilientModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = log.lib.from("ChatTitleGenerator");

const SYSTEM_PROMPT = `You suggest a very short title for a chat conversation.

Rules:
- Reply with ONLY the title, no quotes or punctuation.
- Maximum 6 words.
- If the conversation is just greetings (hi, hello, hey, thanks) or has no clear topic yet, reply with exactly: New chat
- Otherwise summarize the main topic or intent in a few words.`;

export interface TitleGeneratorInput {
  messages: Array<{ role: string; content: string }>;
}

/**
 * Generates a short, descriptive title for a chat session using the first exchange.
 * Only meaningful when there is at least one user message and one assistant message.
 */
export class ChatTitleGenerator {
  private model: ReturnType<typeof createResilientModel>;

  constructor() {
    this.model = createResilientModel("chatTitleGenerator");
  }

  /**
   * Suggests a title from the conversation excerpt.
   * Call only when there is at least one user and one assistant message.
   */
  @Timed()
  async invoke(input: TitleGeneratorInput): Promise<string> {
    const { messages } = input;
    if (messages.length === 0) return "New chat";

    const excerpt = messages
      .slice(0, 6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}`)
      .join("\n");

    try {
      const response = await invokeWithAbortSignal(this.model, [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(`Conversation:\n${excerpt}\n\nSuggested title:`),
      ]);

      const text = typeof response.content === "string" ? response.content : String(response.content ?? "").trim();
      const title = text.slice(0, 80).trim() || "New chat";
      logger.verbose("[ChatTitleGenerator.invoke] Title generated", { titleLength: title.length });
      return title;
    } catch (error) {
      logger.warn("[ChatTitleGenerator.invoke] Failed to generate title", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "New chat";
    }
  }
}
