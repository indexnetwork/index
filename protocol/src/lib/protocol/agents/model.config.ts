import { ChatOpenAI } from "@langchain/openai";

/** Settings that can be configured per agent. */
export interface ModelSettings {
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; exclude?: boolean };
}

/**
 * Per-agent model configuration.
 * Single source of truth for all LLM model settings across agents.
 */
export const MODEL_CONFIG = {
  intentInferrer:       { model: "google/gemini-2.5-flash" },
  intentIndexer:        { model: "google/gemini-2.5-flash" },
  intentVerifier:       { model: "google/gemini-2.5-flash" },
  intentReconciler:     { model: "google/gemini-2.5-flash" },
  intentClarifier:      { model: "google/gemini-2.5-flash" },
  profileGenerator:     { model: "google/gemini-2.5-flash" },
  profileHydeGenerator: { model: "google/gemini-2.5-flash" },
  hydeGenerator:        { model: "google/gemini-2.5-flash" },
  lensInferrer:         { model: "google/gemini-2.5-flash" },
  opportunityEvaluator: { model: "google/gemini-2.5-flash" },
  opportunityPresenter: { model: "google/gemini-2.5-flash" },
  negotiationProposer:  { model: "google/gemini-2.5-flash" },
  negotiationResponder: { model: "google/gemini-2.5-flash" },
  homeCategorizer:      { model: "google/gemini-2.5-flash" },
  suggestionGenerator:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
  chatTitleGenerator:   { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 32 },
  negotiationInsights:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
  inviteGenerator:      { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
  chat:                 { model: process.env.CHAT_MODEL ?? "google/gemini-3-pro-preview", maxTokens: 8192, reasoning: { effort: (process.env.CHAT_REASONING_EFFORT ?? "low") as NonNullable<ModelSettings["reasoning"]>["effort"], exclude: true } },
} as const satisfies Record<string, ModelSettings>;

/**
 * Creates a ChatOpenAI instance configured for OpenRouter.
 * @param agent - Key from MODEL_CONFIG identifying which agent's settings to use.
 * @returns A ChatOpenAI instance ready for use (call .withStructuredOutput() as needed).
 */
/**
 * Returns the model name string for the given agent key.
 * @param agent - Key from MODEL_CONFIG identifying which agent's settings to use.
 * @returns The model identifier string (e.g. "google/gemini-2.5-flash").
 */
export function getModelName(agent: keyof typeof MODEL_CONFIG): string {
  return MODEL_CONFIG[agent].model;
}

export function createModel(agent: keyof typeof MODEL_CONFIG): ChatOpenAI {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error(`createModel(${agent}): OPENROUTER_API_KEY is required.`);
  }
  const cfg: ModelSettings = MODEL_CONFIG[agent];
  return new ChatOpenAI({
    model: cfg.model,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    ...(cfg.reasoning && { modelKwargs: { reasoning: cfg.reasoning } }),
  });
}
