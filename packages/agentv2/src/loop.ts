import type { Model, ModelMessage, ToolCall } from "./model.ts";
import { toolDefinition, type Tool } from "./tool.ts";
import type { Intent } from "./types.ts";

export interface RunInput {
  model: Model;
  /** Who this run speaks as. */
  identity: { id: string; name: string };
  intent: Intent;
  /** Standing instructions for this runtime, before identity, date, and intent. */
  instructions: string;
  /** This run's task, with whatever context it reads. */
  prompt: string;
  tools: Tool<never>[];
  maxSteps: number;
  now?: () => Date;
  signal?: AbortSignal;
}

function formatDate(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function systemPrompt(input: RunInput): string {
  return [
    input.instructions,
    "Write everything in English: every message, question, brief and turn, whatever language the principal, counterpart or anything you read uses.",
    `You are ${input.identity.name}, acting on behalf of ${input.identity.id}.`,
    // Without this the run has no clock, and "next Tuesday" can only be
    // repeated, never resolved.
    `Today is ${formatDate((input.now ?? (() => new Date()))())}. When you agree a date, record the actual date rather than a relative one like "next Tuesday", so the terms still mean the same thing when someone reads them later.`,
    `Current intent: ${input.intent.statement}\nIntent id: ${input.intent.id}\nEverything you do in this run serves that intent. If something falls outside it, say so rather than acting.`,
  ].join("\n\n");
}

/**
 * Ask the model, run whatever tools it calls, feed the results back, until it
 * answers with text instead of a tool call or `maxSteps` is spent.
 *
 * A tool that throws does not end the run: the error goes back as that tool's
 * result, so the model can correct itself. The run's product is whatever its
 * tools recorded, so nothing is returned.
 *
 * @param input - Model, identity, instructions, prompt, tools, and step cap.
 * @throws When the model call fails or the run is cancelled.
 */
export async function run(input: RunInput): Promise<void> {
  const tools = new Map(input.tools.map((entry) => [entry.name, entry]));
  const definitions = input.tools.map(toolDefinition);
  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt(input) },
    { role: "user", content: input.prompt },
  ];

  for (let step = 0; step < input.maxSteps; step++) {
    const assistant = await input.model.complete(messages, definitions, input.signal);
    messages.push(assistant);

    const calls = assistant.tool_calls ?? [];
    if (!calls.length) return;

    for (const call of calls) {
      messages.push({ role: "tool", tool_call_id: call.id, content: await result(call, tools) });
    }
  }
}

/** @param call - One tool call. @param tools - Tools by name. @returns What the model is told came back. */
async function result(call: ToolCall, tools: Map<string, Tool<never>>): Promise<string> {
  const tool = tools.get(call.function.name);
  if (!tool) {
    return `No tool named "${call.function.name}". Available: ${[...tools.keys()].join(", ") || "none"}.`;
  }

  let argument: unknown;
  try {
    argument = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return `Arguments for "${call.function.name}" were not valid JSON: ${call.function.arguments}`;
  }

  try {
    const output = await tool.run(argument as never);
    return typeof output === "string" ? output : JSON.stringify(output ?? null);
  } catch (cause) {
    return `Error: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}
