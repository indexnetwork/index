import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { experimental_decide, generateText, Output, type Experimental_DecisionModel, type JSONValue } from "ai";

import type { Model } from "./model.ts";

/**
 * A decision model: picks the one option that fits a state best. It classifies
 * and writes nothing, so any backend can supply it.
 */
export type Decide = (input: {
  state: unknown;
  question: string;
  /** Each option's key, with what choosing it means. */
  options: Record<string, string>;
  signal?: AbortSignal;
}) => Promise<{ choice: string; /** Each option's probability, when the backend reports it. */ probabilities?: Record<string, number> }>;

export interface DecideClientOptions {
  apiKey?: string;
  /** A decision model on OpenRouter. Pinned, so it cannot change under the caller. */
  model?: string;
  /** Sent on every request, e.g. `HTTP-Referer` and `X-Title` so OpenRouter attributes spend to this caller. */
  headers?: Record<string, string>;
}

const DEFAULT_MODEL = "typesafe/jev-1.14";
/** A decision is one short call; a slow one is a failed one, and callers have a fallback. */
const TIMEOUT_MS = 15_000;

/** @returns The signal that ends a decision: the caller's, or the timeout. */
const timeout = (signal?: AbortSignal) => AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]);

/**
 * OpenRouter's Decisions API: a dedicated decision model at a fraction of a chat model's cost.
 *
 * @param options - Credential, model and headers. Env fills the key.
 * @returns The decision model.
 * @throws When no API key is available.
 */
export function createDecide(options: DecideClientOptions = {}): Decide {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.");
  const model = createOpenRouter({ apiKey, ...(options.headers ? { headers: options.headers } : {}) }).evaluationModel(options.model ?? DEFAULT_MODEL) as unknown as Experimental_DecisionModel; // The provider still types its input as the older evaluation model.
  return async ({ state, question, options: criteria, signal }) => {
    const { answers } = await experimental_decide({
      model,
      state: [{ type: "json", value: state as JSONValue }],
      questions: { choice: { type: "choice", instructions: question, criteria } },
      maxRetries: 1,
      abortSignal: timeout(signal),
    });
    const { choice, probabilities } = answers.choice;
    return { choice, ...(probabilities ? { probabilities } : {}) };
  };
}

/**
 * Any chat model as the decision model, for providers with no decision endpoint.
 *
 * @param model - The chat model that picks the option.
 * @returns The decision model.
 */
export function decideWith(model: Model): Decide {
  return async ({ state, question, options, signal }) => {
    const choices = Object.entries(options).map(([key, meaning]) => `- ${key}: ${meaning}`).join("\n");
    const { output } = await generateText({
      model,
      output: Output.choice({ options: Object.keys(options) }),
      prompt: `${question}\n\nOptions:\n${choices}\n\nState:\n${JSON.stringify(state)}`,
      maxRetries: 1,
      abortSignal: timeout(signal),
    });
    return { choice: output };
  };
}
