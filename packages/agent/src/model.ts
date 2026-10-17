import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/** Ordered defaults; OpenRouter handles provider and model failover. */
const DEFAULT_MODELS: readonly string[] = Object.freeze([
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-4.5",
]);

/** Gemini 3 requires reasoning. Low matches the protocol agents, and the text stays out of the transcript. */
const REASONING = { effort: "low", exclude: true } as const;

/** The model capability the caller supplies: any AI SDK language model. */
export type Model = LanguageModel;

export interface ModelClientOptions {
  apiKey?: string;
  /** One to three ordered OpenRouter models. Replaces the defaults. */
  models?: readonly string[];
}

/**
 * An OpenRouter model with tool calling.
 *
 * @param options - Credential and model list. Env fills the key.
 * @returns The model every run takes.
 * @throws When no API key is available or the model list is unusable.
 */
export function createModel(options: ModelClientOptions = {}): Model {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.");
  const models = [...(options.models ?? DEFAULT_MODELS)];
  if (!models.length || models.length > 3 || models.some((model) => !model.trim())) {
    throw new Error("Provide one to three nonempty OpenRouter model IDs.");
  }
  return createOpenRouter({ apiKey }).chat(models[0]!, { models, reasoning: REASONING, provider: { require_parameters: true } });
}
