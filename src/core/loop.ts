import type { ModelClient, ModelMessage, ToolCall } from "./model.ts";
import { toolDefinition, type Tool, type ToolContext } from "./tools.ts";
import type { PendingQuestion, RunResult, Step } from "./types.ts";

export interface LoopOptions {
  model: ModelClient;
  systemPrompt: string;
  tools: Tool<never>[];
  /** The conversation so far, excluding the system message. */
  messages: ModelMessage[];
  /**
   * The user's input. Normally a new instruction; when the transcript ends
   * on an unanswered suspending tool call, it's the answer to that
   * question instead, and is recorded as the tool's result rather than as
   * a new message.
   */
  input: string;
  maxSteps: number;
  context: ToolContext;
  onStep?: (step: Step) => void;
  signal?: AbortSignal;
}

/**
 * The agent loop: ask the model, run whatever tools it calls, feed the
 * results back, repeat until it answers with text instead of a tool call.
 *
 * Two things end a run early. A suspending tool (`ask_user`) stops the loop
 * and hands the question back, to be resumed once the answer arrives. And
 * `maxSteps` caps it.
 *
 * A tool that *throws* does neither. The error goes back to the model as
 * that tool's result, so it can retry, try another approach, or explain
 * what went wrong — the same way a failed command doesn't end a session.
 */
export async function runLoop(options: LoopOptions): Promise<RunResult> {
  const { model, tools, context, onStep, signal } = options;
  const definitions = tools.map(toolDefinition);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const messages: ModelMessage[] = [
    { role: "system", content: options.systemPrompt },
    ...options.messages.filter((message) => message.role !== "system"),
  ];

  const steps: Step[] = [];
  const record = (step: Step) => {
    steps.push(step);
    onStep?.(step);
  };

  // Resuming: the transcript ends on a question the model asked and nobody
  // answered, so this input is that answer, not a new instruction.
  const awaiting = unansweredCall(messages);
  if (awaiting) {
    messages.push({ role: "tool", tool_call_id: awaiting.id, content: options.input });
  } else {
    messages.push({ role: "user", content: options.input });
  }

  const open = () => [...context.negotiations.values()];
  let lastText = "";

  for (let step = 0; step < options.maxSteps; step++) {
    const assistant = await model.complete(messages, definitions, signal);
    messages.push(assistant);

    if (assistant.content) lastText = assistant.content;

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) {
      record({ kind: "message", content: lastText });
      return { output: lastText, steps, end: "done", messages, negotiations: open() };
    }

    let pending: PendingQuestion | undefined;

    // Every call in this message needs a result before the model runs
    // again — except the one we're suspending on, which the host fills in
    // when it resumes us.
    for (const call of calls) {
      const tool = byName.get(call.function.name);

      if (tool?.suspends && !pending) {
        const parsed = parseArguments(call);
        if ("error" in parsed) {
          record({ kind: "tool", name: call.function.name, input: null, error: parsed.error });
          messages.push({ role: "tool", tool_call_id: call.id, content: parsed.error });
          continue;
        }
        const input = parsed.value as { question?: string; options?: string[] };
        pending = {
          question: String(input.question ?? ""),
          ...(input.options ? { options: input.options } : {}),
        };
        record({ kind: "ask", ...pending });
        continue;
      }

      const result = await runToolCall(call, byName, context, Boolean(pending));
      record(result.step);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
    }

    if (pending) {
      return {
        output: lastText,
        steps,
        end: "needs-input",
        pending,
        messages,
        negotiations: open(),
      };
    }
  }

  return { output: lastText, steps, end: "max-steps", messages, negotiations: open() };
}

/**
 * Finds a tool call left without a result — the question a suspended run
 * stopped on. Scans back from the end so it sees the most recent assistant
 * turn only.
 */
function unansweredCall(messages: ModelMessage[]): ToolCall | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    if (!message.tool_calls?.length) return undefined;

    const answered = new Set(
      messages
        .slice(i + 1)
        .filter((later) => later.role === "tool")
        .map((later) => later.tool_call_id),
    );
    return message.tool_calls.find((call) => !answered.has(call.id));
  }
  return undefined;
}

function parseArguments(call: ToolCall): { value: unknown } | { error: string } {
  try {
    return { value: call.function.arguments ? JSON.parse(call.function.arguments) : {} };
  } catch {
    return {
      error: `Arguments for "${call.function.name}" were not valid JSON: ${call.function.arguments}`,
    };
  }
}

async function runToolCall(
  call: ToolCall,
  tools: Map<string, Tool<never>>,
  context: ToolContext,
  alreadySuspending: boolean,
): Promise<{ step: Step; content: string }> {
  const name = call.function.name;
  const tool = tools.get(name);

  if (!tool) {
    const error = `No tool named "${name}". Available: ${[...tools.keys()].join(", ") || "none"}.`;
    return { step: { kind: "tool", name, input: null, error }, content: error };
  }

  // A second question in the same turn: the host can only carry one back to
  // the user, so tell the model to ask again once this one is answered.
  if (tool.suspends || !tool.run) {
    const error = alreadySuspending
      ? `Only one question at a time — ask "${name}" again after this one is answered.`
      : `Tool "${name}" cannot be run directly.`;
    return { step: { kind: "tool", name, input: null, error }, content: error };
  }

  const parsed = parseArguments(call);
  if ("error" in parsed) {
    return {
      step: { kind: "tool", name, input: call.function.arguments, error: parsed.error },
      content: parsed.error,
    };
  }

  try {
    const output = await tool.run(parsed.value as never, context);
    return {
      step: { kind: "tool", name, input: parsed.value, output },
      content: typeof output === "string" ? output : JSON.stringify(output ?? null),
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return {
      step: { kind: "tool", name, input: parsed.value, error },
      content: `Error: ${error}`,
    };
  }
}
