/**
 * The seat a model client sits in.
 *
 * This package and `@indexnetwork/agent` each ship a default implementation
 * over OpenRouter, so both run standalone with nothing but an API key. A host
 * that already owns a model stack — its own routing, fallbacks, tracing,
 * timing, request context — injects its own instead, and keeps every model
 * call in one place rather than acquiring a second stack it cannot see.
 *
 * One port covers both consumers deliberately. The two built-in clients
 * differ in what they *send*, not in what they *are*: this package's
 * negotiator asks for plain text (or one JSON object) and never calls tools,
 * while the agent loop sends `tools` and reads `tool_calls` back. The richer
 * shape is a strict superset of the plainer one, so a single interface serves
 * both without widening loss — and a host writes one adapter, not two.
 */
import type { DeadlineOptions } from "./deadline.ts";

/** An assistant's request to run one tool, in the OpenAI/OpenRouter shape. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A tool offered to the model, in the OpenAI/OpenRouter shape. */
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * One message in a transcript, in the shape the API expects back verbatim on
 * the next call.
 */
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Set on assistant messages that called tools. */
  tool_calls?: ToolCall[];
  /** Set on tool messages, pointing at the call they answer. */
  tool_call_id?: string;
}

export interface ModelCompletionOptions extends DeadlineOptions {
  /**
   * Tools this turn may call. Absent or empty asks for plain text.
   *
   * A port that cannot call tools must throw when this is non-empty rather
   * than quietly drop them: a dropped tool call comes back as an ordinary
   * text reply, which downstream reads as "the model chose not to act" — a
   * wrong answer that looks like a correct one.
   */
  tools?: ToolDefinition[];
  /** Ask for a single JSON object back. Best effort; the caller still parses. */
  jsonResponse?: boolean;
  /**
   * Skip whatever normally answers and go straight to the alternate, for a
   * failure the port's own routing does not classify as one — a 200 with
   * nothing in it, or a body the caller could not parse. No-op when
   * {@link ModelPort.hasFallback} is false.
   */
  preferFallback?: boolean;
}

/** Where a model call goes. */
export interface ModelPort {
  /** Whether a failed call has anywhere else to go. */
  readonly hasFallback: boolean;
  complete(messages: ModelMessage[], options?: ModelCompletionOptions): Promise<ModelMessage>;
}

/**
 * Reads the text of a reply, for a caller that asked for prose and cannot
 * proceed without it. `content` is nullable because an assistant message that
 * only calls tools carries none.
 */
export function modelMessageText(message: ModelMessage): string {
  if (!message.content) throw new Error("The model returned no text.");
  return message.content;
}
