import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = log.lib.from("ChatInterruptClassifier");

const SYSTEM_PROMPT = `You decide whether a new user message sent during an active AI process should STEER or QUEUE.

Rules:
- Reply with ONLY one word: steer or queue (lowercase).
- STEER: the message redirects, corrects, stops, contradicts, or changes what the AI is doing. Keywords: "wait", "stop", "actually", "ignore that", "instead", "no", "cancel".
- QUEUE: the message adds context, asks a follow-up, or complements what the AI is doing. Keywords: "also", "and", "when done", "additionally", "plus".
- When ambiguous, default to steer.`;

export interface ClassifyInterruptInput {
  /** The new user message sent while the agent is running. */
  message: string;
  /**
   * Current agent activity summary derived from the last few SSE trace event names
   * (e.g. "tool_start: discover_opportunities, graph_start: opportunity").
   */
  agentState: string;
}

/**
 * Binary classifier that decides whether a mid-stream user message should steer
 * (interrupt the current run) or queue (buffer until the run completes).
 * Uses a low-temperature, minimal-token model for sub-1 s latency.
 */
export class ChatInterruptClassifier {
  private model: ChatOpenAI;

  constructor() {
    this.model = createModel("interruptClassifier");
  }

  /**
   * Classify a mid-stream interrupt as steer or queue.
   *
   * @param input - The new message and current agent state context
   * @returns "steer" to interrupt the current run; "queue" to buffer
   */
  @Timed()
  async classify(input: ClassifyInterruptInput): Promise<"steer" | "queue"> {
    const { message, agentState } = input;

    try {
      const response = await invokeWithAbortSignal(this.model, [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(
          `Current agent activity: ${agentState || "idle"}\n\nNew user message: "${message.slice(0, 500)}"\n\nDecision:`,
        ),
      ]);

      const text = String(response.content ?? "").trim().toLowerCase();

      if (text.startsWith("queue")) return "queue";
      // Default to steer on any ambiguity or unexpected output
      return "steer";
    } catch (error) {
      logger.warn("[ChatInterruptClassifier.classify] Classification failed, defaulting to steer", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "steer";
    }
  }
}
