import { ChatOpenAI } from "@langchain/openai";

/** Settings that can be configured per agent. */
export interface ModelSettings {
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; exclude?: boolean };
}

/**
 * Runtime configuration for the protocol package.
 * Set once via configureProtocol() at application startup.
 * All fields fall back to environment variables if not provided.
 */
export interface ModelConfig {
  /** OpenRouter API key. Falls back to OPENROUTER_API_KEY env var. */
  apiKey?: string;
  /** OpenRouter base URL. Falls back to OPENROUTER_BASE_URL env var. */
  baseURL?: string;
  /** Override the chat agent model. Falls back to CHAT_MODEL env var. */
  chatModel?: string;
  /** Override the chat reasoning effort. Falls back to CHAT_REASONING_EFFORT env var. */
  chatReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

/** Module-level config set by configureProtocol(). Merged with per-call overrides. */
let _activeConfig: ModelConfig = {};

/**
 * Configure the protocol package with runtime credentials and settings.
 * Call once at application startup before any agents are used.
 * Falls back to environment variables for any field not provided.
 *
 * @param config - Runtime configuration overrides
 */
export function configureProtocol(config: ModelConfig): void {
  _activeConfig = config;
}

function getModelConfig(config?: ModelConfig) {
  const merged: ModelConfig = { ..._activeConfig, ...config };
  return {
    intentInferrer:       { model: "google/gemini-2.5-flash" },
    intentIndexer:        { model: "google/gemini-2.5-flash" },
    intentVerifier:       { model: "google/gemini-2.5-flash" },
    intentReconciler:     { model: "google/gemini-2.5-flash" },
    intentClarifier:      { model: "google/gemini-2.5-flash" },
    profileGenerator:     { model: "google/gemini-2.5-flash" },
    hydeGenerator:        { model: "google/gemini-2.5-flash" },
    lensInferrer:         { model: "google/gemini-2.5-flash" },
    opportunityEvaluator: { model: "google/gemini-2.5-flash" },
    opportunityPresenter: { model: "google/gemini-2.5-flash" },
    negotiator:           { model: "google/gemini-2.5-flash" },
    homeCategorizer:      { model: "google/gemini-2.5-flash" },
    suggestionGenerator:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
    chatTitleGenerator:   { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 32 },
    negotiationInsights:  { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 512 },
    chatContextSummarizer: { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 512 },
    discoveryQuestionGenerator: { model: "google/gemini-2.5-flash", temperature: 0.5, maxTokens: 1024 },
    questioner: { model: "google/gemini-2.5-flash", temperature: 0.5, maxTokens: 1024 },
    negotiationSummarizer:      { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 256 },
    inviteGenerator:      { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
    premiseAnalyzer:      { model: "google/gemini-2.5-flash" },
    premiseDecomposer:    { model: "google/gemini-2.5-flash" },
    premiseIndexer:       { model: "google/gemini-2.5-flash" },
    userContextGenerator: { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
    chat: {
      model: merged.chatModel ?? process.env.CHAT_MODEL ?? "google/gemini-3-pro-preview",
      maxTokens: 8192,
      reasoning: {
        effort: (merged.chatReasoningEffort ?? process.env.CHAT_REASONING_EFFORT ?? "low") as NonNullable<ModelSettings["reasoning"]>["effort"],
        exclude: true,
      },
    },
  } as const;
}

/**
 * Returns the model name string for the given agent key.
 * @param agent - Key from MODEL_CONFIG identifying which agent's settings to use.
 * @param config - Optional runtime config overrides (merged with module-level config).
 */
export function getModelName(agent: keyof ReturnType<typeof getModelConfig>, config?: ModelConfig): string {
  return getModelConfig(config)[agent].model;
}

/**
 * Creates a ChatOpenAI instance configured for OpenRouter.
 * @param agent - Key identifying which agent's model settings to use.
 * @param config - Optional runtime config overrides (merged with module-level config).
 */
export function createModel(agent: keyof ReturnType<typeof getModelConfig>, config?: ModelConfig): ChatOpenAI {
  const merged: ModelConfig = { ..._activeConfig, ...config };
  const apiKey = merged.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error(`createModel(${agent}): OPENROUTER_API_KEY is required. Pass via configureProtocol({ apiKey }) or set the OPENROUTER_API_KEY environment variable.`);
  }
  const cfg = getModelConfig(merged)[agent] as ModelSettings;
  // Hard upper bound on a single LLM call. Without this, langchain's HTTP
  // client waits until the upstream cuts the socket (~3 minutes via
  // OpenRouter), blocking the entire chat response. 60 s is generous enough
  // for slow providers but bounds the worst case.
  const timeoutEnv = Number.parseInt(process.env.OPENROUTER_REQUEST_TIMEOUT_MS ?? "", 10);
  const timeout = Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 60_000;
  // ChatOpenAI defaults to maxRetries=2. That means a single hung upstream
  // provider gets retried up to 2 more times, each waiting `timeout` before
  // failing — so worst-case latency becomes timeout * 3. Cap retries at 1
  // so the worst case stays bounded at ~2 * timeout. Configurable via
  // OPENROUTER_MAX_RETRIES.
  const retriesEnv = Number.parseInt(process.env.OPENROUTER_MAX_RETRIES ?? "", 10);
  const maxRetries = Number.isFinite(retriesEnv) && retriesEnv >= 0 ? retriesEnv : 1;
  return new ChatOpenAI({
    model: cfg.model,
    configuration: {
      baseURL: merged.baseURL ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      apiKey,
    },
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeout,
    maxRetries,
    ...(cfg.reasoning && { modelKwargs: { reasoning: cfg.reasoning } }),
  });
}
