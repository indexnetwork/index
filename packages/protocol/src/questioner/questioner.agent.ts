/**
 * QuestionerAgent — stateless, mode-driven agent that generates structured
 * decision questions from arbitrary protocol contexts.
 *
 * Follows the IndexNegotiator pattern: constructor takes optional config,
 * single public `invoke()` method receives the full context per call.
 * The LLM model is bound once at construction; the preset (system prompt +
 * builder) is selected per invocation based on `input.mode`.
 */
import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  QuestionGeneratorResponseSchema,
  type Question,
  type QuestionGenerationResult,
  type QuestionStrategy,
  type QuestionWithStrategy,
} from "../shared/schemas/question.schema.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { getPreset } from "./questioner.presets.js";
import type { QuestionerInput } from "./questioner.types.js";

const logger = protocolLogger("QuestionerAgent");

/** Maximum same-strategy questions allowed in a single emission. */
const MAX_SAME_STRATEGY = 2;

export interface QuestionerAgentConfig {
  /** Optional model config override. */
  modelConfig?: Parameters<typeof createModel>[1];
}

/**
 * Stateless question-generation agent. Accepts a `QuestionerInput` envelope,
 * selects the preset for the given mode, invokes the LLM, and applies
 * guardrails (dedup + strategy diversity).
 */
export class QuestionerAgent {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor(config?: QuestionerAgentConfig) {
    const llm = createModel("questioner", config?.modelConfig);
    this.model = llm.withStructuredOutput(QuestionGeneratorResponseSchema, {
      name: "clarifying_questions",
    });
  }

  /**
   * Generate up to 3 decision questions from the given input.
   *
   * @param input  Envelope with mode, userId, source info, and mode-specific context.
   * @param options.signal  Optional AbortSignal to cancel the in-flight LLM call.
   * @returns A result with parallel questions[] and strategies[] arrays,
   *   or null when generation failed, guardrails dropped all candidates,
   *   the LLM threw, or the call was aborted.
   */
  @Timed()
  async invoke(
    input: QuestionerInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null> {
    const preset = getPreset(input.mode);
    const userMessage = preset.buildPrompt(input.context);

    let raw: unknown;
    try {
      raw = await invokeWithAbortSignal(
        this.model,
        [new SystemMessage(preset.systemPrompt), new HumanMessage(userMessage)],
        options?.signal,
      );
    } catch (err) {
      const aborted = options?.signal?.aborted ?? false;
      if (aborted) {
        logger.info("QuestionerAgent aborted by signal", {
          mode: input.mode,
          reason: options?.signal?.reason instanceof Error
            ? options.signal.reason.message
            : String(options?.signal?.reason ?? "unknown"),
        });
      } else {
        logger.warn("QuestionerAgent LLM call failed", {
          mode: input.mode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }

    const parsed = QuestionGeneratorResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("QuestionerAgent parse failed", {
        mode: input.mode,
        error: parsed.error.message,
      });
      return null;
    }

    const filtered = applyGuardrails(parsed.data.questions);
    if (filtered.length === 0) return null;

    return {
      questions: filtered.map(stripStrategy),
      strategies: filtered.map((q) => q.strategy),
    };
  }
}

// --- Guardrails (migrated from question.generator.ts) -------------------------

function applyGuardrails(questions: QuestionWithStrategy[]): QuestionWithStrategy[] {
  const dedupedByTitle = dedupByTitle(questions);
  return enforceStrategyDiversity(dedupedByTitle);
}

function dedupByTitle(questions: QuestionWithStrategy[]): QuestionWithStrategy[] {
  const seen = new Set<string>();
  const out: QuestionWithStrategy[] = [];
  for (const q of questions) {
    if (seen.has(q.title)) continue;
    seen.add(q.title);
    out.push(q);
  }
  return out;
}

function enforceStrategyDiversity(
  questions: QuestionWithStrategy[],
): QuestionWithStrategy[] {
  const counts = new Map<QuestionStrategy, number>();
  const out: QuestionWithStrategy[] = [];
  for (const q of questions) {
    const n = counts.get(q.strategy) ?? 0;
    if (n >= MAX_SAME_STRATEGY) continue;
    counts.set(q.strategy, n + 1);
    out.push(q);
  }
  return out;
}

function stripStrategy(q: QuestionWithStrategy): Question {
  const { strategy: _strategy, ...publicShape } = q;
  return publicShape;
}
