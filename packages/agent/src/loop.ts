import { generateText, isStepCount, jsonSchema, tool as defineTool, ToolChoiceViolationError, type JSONSchema7, type ToolSet } from "ai";

import type { Model } from "./model.ts";
import type { Tool } from "./tool.ts";
import type { Intent } from "./types.ts";

/** One tool call fits. Reasoning bills as output, up to 65,536 tokens otherwise. */
const MAX_TOKENS = 2048;
/** Long enough for a slow model, short enough to notice a hang. */
const STEP_TIMEOUT = 120_000;

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
  /** The first step must call a tool. Later steps may answer with text and end the run. */
  requireTool?: boolean;
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
  const tools: ToolSet = Object.fromEntries(input.tools.map((entry) => [entry.name, defineTool({
    description: entry.description,
    inputSchema: jsonSchema(entry.parameters as JSONSchema7),
    execute: async (argument: unknown) => {
      const output = await entry.run(argument as never);
      return typeof output === "string" ? output : JSON.stringify(output ?? null);
    },
  })]));

  try {
    await generateText({
      model: input.model,
      instructions: systemPrompt(input),
      prompt: input.prompt,
      tools,
      stopWhen: isStepCount(input.maxSteps),
      prepareStep: ({ stepNumber }) => (stepNumber === 0 && input.requireTool ? { toolChoice: "required" } : undefined),
      // Tools share the run's state: a note must land before the question after it.
      toolCallConcurrency: 1,
      maxOutputTokens: MAX_TOKENS,
      maxRetries: 0,
      timeout: { stepMs: STEP_TIMEOUT },
      ...(input.signal ? { abortSignal: input.signal } : {}),
    });
  } catch (error) {
    // A model that skips the required tool ends the run like a text answer; callers judge what it recorded.
    if (!ToolChoiceViolationError.isInstance(error)) throw error;
  }
}
