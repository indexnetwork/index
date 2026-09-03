/**
 * The seat `@indexnetwork/a2a` and `@indexnetwork/agent` plug into.
 *
 * Both packages ship their own OpenRouter client so they run standalone. This
 * host does not want a second model stack: model choice, the same-tier
 * fallback, runnable-level retry, the timing wrapper and the trace emitter all
 * live behind {@link createModel}, and a call that bypasses them is a call
 * nobody can see or configure. So the two libraries take a `ModelPort` and
 * this is the implementation of it.
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type { ChatOpenAI, ChatOpenAICallOptions } from "@langchain/openai";
import type { ModelCompletionOptions, ModelMessage, ModelPort } from "@indexnetwork/a2a/negotiator";

import { traceAgent } from "../observability/trace.js";
import { timed } from "../observability/performance.js";

import { createFallbackModel, createModel, hasFallbackModel, withModelResilience, type ModelAgent, type ModelConfig } from "./model.config.js";

/** A model with this turn's tools and response format already bound. */
type BoundModel = Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions>;

/** Renders a LangChain reply's content, which is a string or a parts array. */
function contentOf(reply: AIMessageChunk): string {
  const { content } = reply;
  if (typeof content === "string") return content;
  // A reasoning model can answer with structured parts. Stringifying the
  // array puts "[object Object]" into whatever parses this next, which
  // surfaces as "the model returned nonsense" three layers away.
  return content
    .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
    .join("");
}

function toLangChain(messages: ModelMessage[]): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return new SystemMessage(message.content ?? "");
      case "user":
        return new HumanMessage(message.content ?? "");
      case "tool":
        return new ToolMessage({
          content: message.content ?? "",
          tool_call_id: message.tool_call_id ?? "",
        });
      case "assistant":
        return new AIMessage({
          content: message.content ?? "",
          ...(message.tool_calls?.length
            ? {
              tool_calls: message.tool_calls.map((call) => ({
                id: call.id,
                name: call.function.name,
                args: parseToolArguments(call.function.name, call.function.arguments),
              })),
            }
            : {}),
        });
    }
  });
}

/** Tool arguments cross the wire as a JSON string; name the value on failure. */
function parseToolArguments(name: string, raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`ProtocolModelClient: tool call ${name} had unparseable arguments: ${raw}`);
  }
}

function fromLangChain(reply: AIMessageChunk): ModelMessage {
  const content = contentOf(reply);
  const toolCalls = (reply.tool_calls ?? []).map((call) => ({
    id: call.id ?? crypto.randomUUID(),
    type: "function" as const,
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
  return {
    role: "assistant",
    content: content || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

/** A {@link ModelPort} backed by this package's own model configuration. */
export class ProtocolModelClient implements ModelPort {
  constructor(
    private readonly agent: ModelAgent,
    private readonly config?: ModelConfig,
  ) {}

  /**
   * Read from the model tables rather than by building the fallback:
   * instantiating one requires an API key, and a port is constructed in
   * places — a spec runner with the key stripped, a composition root that
   * runs before configuration — where merely existing must not throw.
   */
  get hasFallback(): boolean {
    return hasFallbackModel(this.agent, this.config);
  }

  async complete(messages: ModelMessage[], options: ModelCompletionOptions = {}): Promise<ModelMessage> {
    // The tools arrive already in OpenAI's shape, so `bindTools` has nothing
    // to convert; `withConfig` is this LangChain version's `.bind`.
    const bind = (model: ChatOpenAI): BoundModel => {
      const base = (options.tools?.length
        ? model.bindTools(options.tools)
        : model) as BoundModel;
      return options.jsonResponse
        ? base.withConfig({ response_format: { type: "json_object" } })
        : base;
    };

    const fallback = createFallbackModel(this.agent, this.config);
    // `preferFallback` means the primary already answered unusably this turn
    // — an empty 200, or a body the caller could not parse. Retrying it is
    // what the caller is explicitly trying to avoid.
    const runnable = options.preferFallback && fallback
      ? bind(fallback)
      : withModelResilience(bind(createModel(this.agent, this.config)), fallback && bind(fallback));

    const deadline = options.timeoutMs && options.timeoutMs > 0
      ? AbortSignal.timeout(options.timeoutMs)
      : undefined;
    const signal = options.signal && deadline
      ? AbortSignal.any([options.signal, deadline])
      : options.signal ?? deadline;

    // `timed` explicitly rather than the @Timed() decorator, which labels by
    // ClassName.methodName and would collapse every seat into one bucket.
    // `traceAgent` reads its emitter from requestContext, which the awaited
    // call chain preserves.
    return traceAgent(
      `model:${this.agent}`,
      () => timed(
        `ProtocolModelClient.complete:${this.agent}`,
        async () => fromLangChain(await runnable.invoke(toLangChain(messages), { signal })),
      ),
      (reply) => (reply.tool_calls?.length
        ? `${reply.tool_calls.length} tool call(s)`
        : reply.content?.slice(0, 80)),
    );
  }
}

/**
 * Builds the model seat for one agent. Constructing it does not touch
 * credentials; the first {@link ProtocolModelClient.complete} does.
 */
export function createModelPort(agent: ModelAgent, config?: ModelConfig): ModelPort {
  return new ProtocolModelClient(agent, config);
}
