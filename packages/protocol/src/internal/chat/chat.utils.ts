/**
 * Token utilities for context window management.
 * Estimates token counts and truncates message arrays to fit within model limits.
 * Uses a simple heuristic (~4 chars per token for English).
 */

import { BaseMessage } from "@langchain/core/messages";

/**
 * Default maximum tokens to allow for context.
 * Reserves space for system prompt and response generation.
 */
export const MAX_CONTEXT_TOKENS = 8000;

/** Minimum tokens to reserve for the model's response (internal use in truncateToTokenLimit). */
const RESERVED_RESPONSE_TOKENS = 2000;

/**
 * Estimate token count for a string using a simple heuristic.
 *
 * This uses a rough estimate of ~4 characters per token, which works
 * reasonably well for English text. For more accuracy with specific
 * models, use tiktoken or the model's native tokenizer.
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 characters per token for English
  // This tends to slightly overestimate, which is safer for truncation
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token count for a message, including role overhead.
 *
 * @param message - The LangChain message to estimate
 * @returns Estimated token count including message overhead
 */
export function estimateMessageTokens(message: BaseMessage): number {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  // Add ~4 tokens overhead per message for role and formatting
  return estimateTokenCount(content) + 4;
}

/**
 * Truncate messages to fit within token limit, keeping most recent messages.
 *
 * Messages are processed from newest to oldest, accumulating until the
 * token limit is reached. The first message (usually system) is always
 * kept if present.
 *
 * @param messages - Array of messages to truncate
 * @param maxTokens - Maximum total tokens allowed (default: MAX_CONTEXT_TOKENS)
 * @returns Array of messages that fit within the token limit
 */
export function truncateToTokenLimit(
  messages: BaseMessage[],
  maxTokens: number = MAX_CONTEXT_TOKENS
): BaseMessage[] {
  if (messages.length === 0) return [];

  // Calculate available tokens (reserve space for response)
  const availableTokens = maxTokens - RESERVED_RESPONSE_TOKENS;

  // If only one message, return it (truncation within message not supported)
  if (messages.length === 1) {
    return messages;
  }

  let totalTokens = 0;
  const result: BaseMessage[] = [];

  // Check if first message is a system message (should always be kept)
  const firstMessage = messages[0];
  const hasSystemMessage = firstMessage._getType() === "system";

  if (hasSystemMessage) {
    const systemTokens = estimateMessageTokens(firstMessage);
    totalTokens += systemTokens;
    result.push(firstMessage);
  }

  // Process remaining messages from newest to oldest
  const remainingMessages = hasSystemMessage ? messages.slice(1) : messages;
  const recentMessages: BaseMessage[] = [];

  for (let i = remainingMessages.length - 1; i >= 0; i--) {
    const msg = remainingMessages[i];
    const msgTokens = estimateMessageTokens(msg);

    if (totalTokens + msgTokens > availableTokens) {
      // Stop adding more messages
      break;
    }

    recentMessages.unshift(msg);
    totalTokens += msgTokens;
  }

  // Combine system message (if any) with recent messages
  return hasSystemMessage ? [firstMessage, ...recentMessages] : recentMessages;
}
