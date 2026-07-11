import { ChatOpenAI } from "@langchain/openai";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { BaseLanguageModelInput, StructuredOutputMethodOptions } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type { InteropZodType } from "@langchain/core/utils/types";

/** Settings that can be configured per agent. */
export interface ModelSettings {
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; exclude?: boolean };
}

/**
 * Runtime configuration for the protocol package.
 * When passed via `ToolContext.modelConfig`, all fields (`apiKey`, `baseURL`, `chatModel`,
 * `chatReasoningEffort`) are honored by `ChatAgent` when the chat graph runs.
 * Other protocol agents don't read from `ToolContext` but may accept an explicit `ModelConfig`
 * as a direct parameter to `createModel()`.
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

function getModelConfig(config?: ModelConfig) {
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
    negotiationScreener:  { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 1024 },
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
    networkRecommender:   { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 512 },
    interruptClassifier:  { model: "google/gemini-2.5-flash", temperature: 0.0, maxTokens: 16 },
    chat: {
      model: config?.chatModel ?? process.env.CHAT_MODEL ?? "google/gemini-3-pro-preview",
      maxTokens: 8192,
      reasoning: {
        effort: (config?.chatReasoningEffort ?? process.env.CHAT_REASONING_EFFORT ?? "low") as NonNullable<ModelSettings["reasoning"]>["effort"],
        exclude: true,
      },
    },
  } as const;
}

/** Key identifying one of the per-agent model configurations. */
export type ModelAgent = keyof ReturnType<typeof getModelConfig>;

/**
 * Returns the model name string for the given agent key.
 * @param agent - Key from MODEL_CONFIG identifying which agent's settings to use.
 * @param config - Optional runtime config overrides.
 */
export function getModelName(agent: ModelAgent, config?: ModelConfig): string {
  return getModelConfig(config)[agent].model;
}

/**
 * Creates a ChatOpenAI instance configured for OpenRouter.
 * @param agent - Key identifying which agent's model settings to use.
 * @param config - Optional runtime config overrides.
 */
export function createModel(agent: ModelAgent, config?: ModelConfig): ChatOpenAI {
  const cfg = getModelConfig(config)[agent] as ModelSettings;
  return instantiateModel(agent, cfg, config);
}

/** Instantiates a ChatOpenAI from explicit settings (shared by primary + fallback creation). */
function instantiateModel(agent: string, cfg: ModelSettings, config?: ModelConfig): ChatOpenAI {
  const apiKey = config?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error(`createModel(${agent}): OPENROUTER_API_KEY is required. Pass via the config argument, ToolContext.modelConfig.apiKey, or set the OPENROUTER_API_KEY environment variable.`);
  }
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
      baseURL: config?.baseURL ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      apiKey,
    },
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeout,
    maxRetries,
    ...(cfg.reasoning && { modelKwargs: { reasoning: cfg.reasoning } }),
  });
}

/**
 * Default cross-vendor fallback model. The per-agent primaries run on Google's
 * provider lane (gemini-2.5-flash); a same-key OpenRouter fallback on a
 * different vendor survives Google-side outages.
 * Override via OPENROUTER_FALLBACK_MODEL; set it to "none" (or "off") to disable.
 */
const DEFAULT_FALLBACK_MODEL = "openai/gpt-4o-mini";

function getFallbackModelName(): string | undefined {
  const raw = process.env.OPENROUTER_FALLBACK_MODEL;
  if (raw === undefined) return DEFAULT_FALLBACK_MODEL;
  const value = raw.trim();
  if (!value || value.toLowerCase() === "none" || value.toLowerCase() === "off") return undefined;
  return value;
}

/**
 * Creates the fallback ChatOpenAI for an agent, or undefined when fallbacks
 * are disabled or the fallback would be the same model as the primary.
 * Reuses the agent's sampling settings but drops `reasoning` kwargs, which are
 * primary-model specific.
 */
export function createFallbackModel(agent: ModelAgent, config?: ModelConfig): ChatOpenAI | undefined {
  const fallbackName = getFallbackModelName();
  if (!fallbackName) return undefined;
  const cfg = getModelConfig(config)[agent] as ModelSettings;
  if (cfg.model === fallbackName) return undefined;
  return instantiateModel(agent, { ...cfg, model: fallbackName, reasoning: undefined }, config);
}

/**
 * Number of attempts (1 = no retry) for runnable-level retries added by
 * `createStructuredModel` / `createResilientModel`. These wrap ChatOpenAI's
 * own HTTP-level `maxRetries` and additionally cover structured-output
 * parse/validation failures. Configurable via OPENROUTER_RUNNABLE_MAX_ATTEMPTS.
 */
function getRunnableMaxAttempts(): number {
  const env = Number.parseInt(process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(env) && env >= 1 ? env : 2;
}

/**
 * Stops runnable-level retries when the failure was a caller abort —
 * retrying a cancelled request only delays cancellation. Thrown errors from
 * `onFailedAttempt` abort the retry loop.
 */
function abortAwareFailedAttemptHandler(error: Error): void {
  if (error?.name === "AbortError" || error?.name === "APIUserAbortError") throw error;
}

function withResilience<RunOutput>(
  primary: Runnable<BaseLanguageModelInput, RunOutput>,
  fallback: Runnable<BaseLanguageModelInput, RunOutput> | undefined,
): Runnable<BaseLanguageModelInput, RunOutput> {
  const attempts = getRunnableMaxAttempts();
  let runnable: Runnable<BaseLanguageModelInput, RunOutput> = attempts > 1
    ? primary.withRetry({ stopAfterAttempt: attempts, onFailedAttempt: abortAwareFailedAttemptHandler })
    : primary;
  if (fallback) runnable = runnable.withFallbacks([fallback]);
  return runnable;
}

/**
 * Creates a structured-output model with runnable-level retry and cross-model
 * fallback. Equivalent to `createModel(agent).withStructuredOutput(schema, options)`
 * plus `.withRetry(...)` and `.withFallbacks([...])`.
 *
 * Retry covers transient provider errors *and* schema parse/validation
 * failures; the fallback model (see OPENROUTER_FALLBACK_MODEL) is bound to the
 * same schema so a provider outage degrades to a different vendor instead of
 * failing the call. Abort signals pass through: aborts are never retried and
 * skip the fallback.
 *
 * @param agent - Key identifying which agent's model settings to use.
 * @param outputSchema - Zod schema or JSON-schema response format.
 * @param options - Same options as `withStructuredOutput` (e.g. `{ name }`).
 * @param config - Optional runtime model config overrides.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors ChatOpenAI.withStructuredOutput's constraint; `unknown` rejects zod-inferred interface types
export function createStructuredModel<RunOutput extends Record<string, any> = Record<string, any>>(
  agent: ModelAgent,
  outputSchema: InteropZodType<RunOutput> | Record<string, unknown>,
  options?: StructuredOutputMethodOptions<false>,
  config?: ModelConfig,
): Runnable<BaseLanguageModelInput, RunOutput> {
  const primary = createModel(agent, config).withStructuredOutput<RunOutput>(outputSchema, options);
  const fallbackModel = createFallbackModel(agent, config);
  const fallback = fallbackModel?.withStructuredOutput<RunOutput>(outputSchema, options);
  return withResilience(primary, fallback);
}

/**
 * Creates a plain-completion model with runnable-level retry and cross-model
 * fallback, for call sites that `invoke()` the model directly (no
 * `withStructuredOutput`/`bindTools`/`stream` chaining).
 *
 * @param agent - Key identifying which agent's model settings to use.
 * @param config - Optional runtime model config overrides.
 */
export function createResilientModel(
  agent: ModelAgent,
  config?: ModelConfig,
): Runnable<BaseLanguageModelInput, AIMessageChunk> {
  return withResilience(createModel(agent, config), createFallbackModel(agent, config));
}
