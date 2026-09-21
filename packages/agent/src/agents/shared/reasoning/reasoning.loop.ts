import type { Execute } from "./reasoning.execution.js";
import type { Tool } from "./reasoning.tool.js";

/** One function call requested by a model response. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message in a direct run's temporary model transcript. */
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Set on assistant messages that called tools. */
  tool_calls?: ToolCall[];
  /** Set on tool messages, identifying the call they answer. */
  tool_call_id?: string;
}

/** Model-visible tool metadata, without the local handler. */
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A single-response model dependency for direct execution, not for native executors. */
export interface Model {
  /**
   * @param messages - This run's transcript so far.
   * @param tools - The agent's permitted tool definitions.
   * @param abortSignal - Cooperative cancellation for this request.
   * @returns The assistant's text or requested tool calls.
   * @throws On model failure or cancellation.
   */
  complete(messages: ModelMessage[], tools: ToolDefinition[], abortSignal: AbortSignal): Promise<ModelMessage>;
}

/**
 * Binds a model to the whole-run execution contract without starting any work.
 * Each invocation owns its transcript; only the supplied tool handlers collect
 * domain outputs. Prepared instructions and prompts pass through unchanged.
 *
 * @param model - Configured model access, with credentials and transport owned by its implementation.
 * @returns An executor that stops after a successful terminal tool, no calls, or the supplied step cap.
 */
export function createExecute(model: Model): Execute {
  return async (input) => {
    const { abortSignal } = input;
    abortSignal.throwIfAborted();

    const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
    const definitions: ToolDefinition[] = input.tools.map(({ name, description, parameters }) => ({
      type: "function",
      function: { name, description, parameters },
    }));
    const messages: ModelMessage[] = [
      { role: "system", content: input.instructions },
      { role: "user", content: input.prompt },
    ];

    for (let step = 0; step < input.maxSteps; step++) {
      abortSignal.throwIfAborted();
      const assistant = await model.complete(messages, definitions, abortSignal);
      abortSignal.throwIfAborted();
      messages.push(assistant);

      const calls = assistant.tool_calls ?? [];
      if (!calls.length) return;

      for (const call of calls) {
        abortSignal.throwIfAborted();
        const result = await toolResult(call, tools, abortSignal);
        abortSignal.throwIfAborted();
        if (result.terminal) return;
        messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
      }
    }
  };
}

async function toolResult(call: ToolCall, tools: Map<string, Tool>, abortSignal: AbortSignal): Promise<{ content: string; terminal?: true }> {
  const tool = tools.get(call.function.name);
  if (!tool) {
    return { content: `No tool named "${call.function.name}". Available: ${[...tools.keys()].join(", ") || "none"}.` };
  }

  let argument: unknown;
  try {
    argument = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { content: `Arguments for "${call.function.name}" were not valid JSON: ${call.function.arguments}` };
  }

  try {
    const output = await tool.run(argument);
    abortSignal.throwIfAborted();
    return { content: typeof output === "string" ? output : JSON.stringify(output ?? null), terminal: tool.terminal };
  } catch (cause) {
    abortSignal.throwIfAborted();
    return { content: `Error: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}
