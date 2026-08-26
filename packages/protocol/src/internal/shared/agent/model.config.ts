import { ChatOpenAI } from "@langchain/openai";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { BaseLanguageModelInput, StructuredOutputMethodOptions } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type { InteropZodType } from "@langchain/core/utils/types";

import { resolveCanonicalAllAgentModels } from "./model.resolver.js";

const GEMINI_3_7_FLASH_MODEL = "google/gemini-3.7-flash";

/** Settings that can be configured per agent. */
export interface ModelSettings {
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort?: 'low' | 'medium' | 'high'; exclude?: boolean };
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
  /** OpenRouter base URL. Defaults to {@link OPENROUTER_BASE_URL}. */
  baseURL?: string;
  /** Override the chat agent model. Falls back to CHAT_MODEL env var. */
  chatModel?: string;
  /** Override the chat reasoning effort. Falls back to CHAT_REASONING_EFFORT env var. */
  chatReasoningEffort?: 'low' | 'medium' | 'high';
}

/** Per-agent model settings before canonical assignments are applied. */
function getBaseModelConfig(config?: ModelConfig) {
  const settings = {
    intentInferrer:       { model: "google/gemini-3.7-flash" },
    intentIndexer:        { model: "google/gemini-3.7-flash" },
    intentVerifier:       { model: "google/gemini-3.7-flash" },
    intentReconciler:     { model: "google/gemini-3.7-flash" },
    intentClarifier:      { model: "google/gemini-3.7-flash" },
    profileGenerator:     { model: "google/gemini-3.7-flash" },
    hydeGenerator:        { model: "google/gemini-3.7-flash" },
    hydeValidator:        { model: "google/gemini-3.7-flash", temperature: 0.0, maxTokens: 2048 },
    lensInferrer:         { model: "google/gemini-3.7-flash" },
    opportunityEvaluator: { model: "google/gemini-3.7-flash" },
    opportunityPresenter: { model: "google/gemini-3.7-flash" },
    negotiator:           { model: "google/gemini-3.7-flash" },
    negotiationReflector: { model: "google/gemini-3.7-flash", temperature: 0.3, maxTokens: 2048 },
    homeCategorizer:      { model: "google/gemini-3.7-flash" },
    suggestionGenerator:  { model: "google/gemini-3.7-flash", temperature: 0.4, maxTokens: 512 },
    chatTitleGenerator:   { model: "google/gemini-3.7-flash", temperature: 0.3, maxTokens: 32 },
    negotiationInsights:  { model: "google/gemini-3.7-flash", temperature: 0.4, maxTokens: 512 },
    chatContextSummarizer: { model: "google/gemini-3.7-flash", temperature: 0.2, maxTokens: 512 },
    signalIntakePack: { model: "google/gemini-3.7-flash", temperature: 0.3, maxTokens: 1024 },
    negotiationSummarizer:      { model: "google/gemini-3.7-flash", temperature: 0.2, maxTokens: 256 },
    poolDiscriminatorMiner:        { model: "google/gemini-3.7-flash", temperature: 0.2, maxTokens: 4096 },
    poolDiscriminatorAssigner:     { model: "google/gemini-3.7-flash", temperature: 0.1, maxTokens: 16384 },
    negotiationEvidenceMiner:      { model: "google/gemini-3.7-flash", temperature: 0.2, maxTokens: 4096 },
    inviteGenerator:      { model: "google/gemini-3.7-flash", temperature: 0.3, maxTokens: 512 },
    premiseAnalyzer:      { model: "google/gemini-3.7-flash" },
    premiseDecomposer:    { model: "google/gemini-3.7-flash" },
    premiseIndexer:       { model: "google/gemini-3.7-flash" },
    userContextGenerator: { model: "google/gemini-3.7-flash", temperature: 0.3, maxTokens: 512 },
    networkRecommender:   { model: "google/gemini-3.7-flash", temperature: 0.2, maxTokens: 512 },
    interruptClassifier:  { model: "google/gemini-3.7-flash", temperature: 0.0, maxTokens: 16 },
    chat: {
      model: "google/gemini-3.7-flash",
      maxTokens: 8192,
      reasoning: {
        effort: (config?.chatReasoningEffort ?? process.env.CHAT_REASONING_EFFORT ?? "low") as NonNullable<ModelSettings["reasoning"]>["effort"],
        exclude: true,
      },
    },
  } as const;
  const assignments = resolveCanonicalAllAgentModels({
    CHAT_MODEL: config?.chatModel ?? process.env.CHAT_MODEL,
    EVAL_MODEL_OVERRIDES: process.env.EVAL_MODEL_OVERRIDES,
  }, { applyEvalOverrides: process.env.NODE_ENV !== "production" });
  return Object.fromEntries(
    Object.entries(settings).map(([agent, value]) => {
      const model = assignments[agent as keyof typeof assignments];
      return [agent, {
        ...value,
        model,
        reasoning: model === GEMINI_3_7_FLASH_MODEL
          ? ("reasoning" in value ? value.reasoning : { effort: "low" })
          : undefined,
      }];
    }),
  ) as unknown as { [Agent in keyof typeof settings]: Omit<(typeof settings)[Agent], "model"> & { model: string } };
}

/** Canonical assignments preserve sampling, token, and reasoning settings. */
function getModelConfig(config?: ModelConfig): ReturnType<typeof getBaseModelConfig> {
  return getBaseModelConfig(config);
}

/** Key identifying one of the per-agent model configurations. */
export type ModelAgent = keyof ReturnType<typeof getBaseModelConfig>;

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
/** OpenRouter API root. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function instantiateModel(agent: string, cfg: ModelSettings, config?: ModelConfig): ChatOpenAI {
  const apiKey = config?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error(`createModel(${agent}): OPENROUTER_API_KEY is required. Pass via the config argument, ToolContext.modelConfig.apiKey, or set the OPENROUTER_API_KEY environment variable.`);
  }
  // Hard upper bound on a single LLM call. Without this, langchain's HTTP
  // client waits until the upstream cuts the socket (~3 minutes via
  // OpenRouter), blocking the entire chat response. 60 s is generous enough
  // for slow providers but bounds the worst case.
  const timeout = 60_000;
  // ChatOpenAI defaults to maxRetries=2. That means a single hung upstream
  // provider gets retried up to 2 more times, each waiting `timeout` before
  // failing — so worst-case latency becomes timeout * 3. Cap retries at 1
  // so the worst case stays bounded at ~2 * timeout.
  const maxRetries = 1;
  return new ChatOpenAI({
    model: cfg.model,
    configuration: {
      baseURL: config?.baseURL ?? OPENROUTER_BASE_URL,
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
 * Same-tier, previous-generation fallback: a "pro" primary falls back to the
 * previous pro model, a "flash" primary to the previous flash model — the
 * fallback is meant to survive a provider-side outage or rate limit on the
 * exact primary, not to trade away the tier's capability. Every current
 * primary is a flash model, but this stays tier-aware for when a pro model
 * is added.
 */
const FALLBACK_MODEL_BY_TIER: Record<"pro" | "flash", string> = {
  pro: "google/gemini-2.5-pro",
  flash: "google/gemini-2.5-flash",
};

function fallbackModelFor(primaryModel: string): string {
  return primaryModel.includes("pro") ? FALLBACK_MODEL_BY_TIER.pro : FALLBACK_MODEL_BY_TIER.flash;
}

/**
 * Creates the fallback ChatOpenAI for an agent, or undefined when fallbacks
 * are disabled or the fallback would be the same model as the primary.
 * Reuses the agent's sampling settings but drops `reasoning` kwargs, which are
 * primary-model specific.
 */
export function createFallbackModel(agent: ModelAgent, config?: ModelConfig): ChatOpenAI | undefined {
  const cfg = getModelConfig(config)[agent] as ModelSettings;
  const fallbackModel = fallbackModelFor(cfg.model);
  if (cfg.model === fallbackModel) return undefined;
  return instantiateModel(agent, { ...cfg, model: fallbackModel, reasoning: undefined }, config);
}

/**
 * Number of attempts (1 = no retry) for runnable-level retries added by
 * `createStructuredModel` / `createResilientModel`. These wrap ChatOpenAI's
 * own HTTP-level `maxRetries` and additionally cover structured-output
 * parse/validation failures.
 */
const RUNNABLE_MAX_ATTEMPTS = 2;

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
  const attempts = RUNNABLE_MAX_ATTEMPTS;
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
 * failures; the fallback model (see FALLBACK_MODEL_BY_TIER) is bound to the
 * same schema so a provider outage or rate limit degrades to the previous
 * generation of the same tier instead of failing the call. Abort signals
 * pass through: aborts are never retried and
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
