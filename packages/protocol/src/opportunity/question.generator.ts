/**
 * @deprecated Use QuestionerAgent instead. Will be removed in a future version.
 *
 * QuestionGenerator — pure LLM pass that turns a structured DiscoveryQuestionInput
 * into 0–3 decision questions. No DB, no events, no caller wired here; Slice 3
 * (opportunity.discover.ts) is the first consumer.
 *
 * Flow:
 *   1. buildQuestionPrompt(input) → user message string.
 *   2. model.invoke([system, user]) returns a structured payload.
 *   3. safeParse via QuestionGeneratorResponseSchema → null on failure.
 *   4. Guardrails: dedup by title, then strategy-diversity (never 3 same).
 *   5. If empty, return null. Otherwise split into public Question[] + parallel
 *      QuestionStrategy[] (debug-only; strategy is NEVER on the public shape).
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
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import {
  SYSTEM_PROMPT,
  buildQuestionPrompt,
  type DiscoveryQuestionInput,
} from "./question.prompt.js";

const logger = protocolLogger("QuestionGenerator");

/** Maximum same-strategy questions allowed in a single emission. */
const MAX_SAME_STRATEGY = 2;

/** @deprecated Use QuestionerAgent instead. Will be removed in a future version. */
export class QuestionGenerator {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const llm = createModel("discoveryQuestionGenerator");
    this.model = llm.withStructuredOutput(QuestionGeneratorResponseSchema, {
      name: "clarifying_questions",
    });
  }

  /**
   * Generate up to 3 decision questions from the given discovery turn.
   *
   * @param input  Discovery turn payload.
   * @param options.signal  Optional AbortSignal. Passed to LangChain so an
   *   aborted call cancels the underlying HTTP fetch instead of leaving a
   *   floating promise burning OpenRouter capacity.
   * @returns A result with parallel questions[] and strategies[] arrays,
   *   or null when the LLM fails, the output is malformed, the call was
   *   aborted, or the guardrails leave zero questions standing.
   */
  @Timed()
  async generate(
    input: DiscoveryQuestionInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null> {
    const user = buildQuestionPrompt(input);

    let raw: unknown;
    try {
      raw = await this.model.invoke(
        [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(user)],
        options?.signal ? { signal: options.signal } : undefined,
      );
    } catch (err) {
      // AbortError is the expected outcome under deadline pressure — caller
      // already wants to skip questions in that case, so log at info rather
      // than warn to keep dashboards clean.
      const aborted = options?.signal?.aborted ?? false;
      if (aborted) {
        logger.info("QuestionGenerator aborted by signal", {
          reason: options?.signal?.reason instanceof Error ? options.signal.reason.message : String(options?.signal?.reason ?? "unknown"),
        });
      } else {
        logger.warn("QuestionGenerator LLM call failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }

    const parsed = QuestionGeneratorResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("QuestionGenerator parse failed", { error: parsed.error.message });
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

/**
 * Guardrail pipeline. Order matters:
 *   1. Dedup by title (keep first occurrence). Title uniqueness is a hard UX
 *      requirement for the renderer — two questions cannot share a chip label.
 *   2. Strategy diversity: cap same-strategy entries at MAX_SAME_STRATEGY,
 *      dropping overflow unconditionally (does NOT depend on whether a
 *      distinct-strategy alternative exists in the batch). The cap exists to
 *      enforce the "never 3 of the same kind" guidance from the spec.
 */
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

/**
 * Enforce the "never 3 same-strategy" rule. Walks the array in order; once a
 * given strategy has appeared MAX_SAME_STRATEGY times, subsequent entries with
 * the same strategy are dropped. Distinct-strategy entries are always kept
 * (subject to the schema's overall 3-question cap, which has already applied).
 */
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
