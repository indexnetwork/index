/**
 * IntentRefiner — pure LLM pass that rewrites an intent description to
 * naturally incorporate the user's answer to a clarifying question.
 *
 * Replaces the old mechanical `[Refined: ...]` addendum (IND-393): instead of
 * appending a bracketed marker, the model merges the answer into the
 * description so it reads as one coherent, user-authored intent.
 *
 * Flow:
 *   1. buildRefinerPrompt(input) → user message string.
 *   2. model.invoke([system, user]) returns { refinedDescription }.
 *   3. safeParse via IntentRefinerResponseSchema → null on failure.
 *   4. Guardrail: reject outputs that still contain refinement markers or
 *      are empty — caller falls back to a plain natural append.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";

const logger = protocolLogger("IntentRefiner");

const IntentRefinerResponseSchema = z.object({
  refinedDescription: z
    .string()
    .describe("The full rewritten intent description, incorporating the answer naturally"),
});

const SYSTEM_PROMPT = `
You are an expert Intent Editor. An intent is a short description of a goal the user is pursuing (e.g. "Find a senior React developer for my startup").

The user was asked a clarifying question about their intent and answered it. Your task is to REWRITE the intent description so it naturally incorporates the new information from the answer.

REWRITE RULES:
- PRESERVE every existing detail of the current description. Never drop information unless the answer explicitly contradicts it (in that case, the answer wins).
- INTEGRATE the answer's information where it fits naturally — do not just append it at the end.
- The result must read as ONE coherent intent written by the user in a single sitting. No seams, no meta commentary.
- NEVER include markers, labels, or brackets such as "[Refined: ...]", "Refined:", "Update:", "Answer:", or similar. Output plain prose only.
- Keep the user's voice, tense, and person exactly as in the current description.
- Keep it concise: similar length to the original plus the genuinely new information. Do not pad, embellish, or invent details that are in neither the description nor the answer.
- Keep it a SINGLE intent. Do not turn it into a list of multiple distinct goals.
- If the answer adds nothing new (e.g. it confirms what the description already says), return the current description unchanged.

Return the FULL rewritten description, not a diff or an addendum.
`.trim();

/** Input for one refinement pass. */
export interface IntentRefinerInput {
  /** The intent's current description text. */
  currentDescription: string;
  /** The clarifying question that was asked, when available. */
  question?: string;
  /** Options the user selected as their answer. */
  selectedOptions: string[];
  /** Free-text portion of the answer. */
  freeText?: string;
}

function buildRefinerPrompt(input: IntentRefinerInput): string {
  const answerParts: string[] = [];
  if (input.selectedOptions.length > 0) {
    answerParts.push(`Selected options: ${input.selectedOptions.join("; ")}`);
  }
  const freeText = input.freeText?.trim();
  if (freeText) {
    answerParts.push(`Free text: ${freeText}`);
  }

  return [
    `# Current Intent Description`,
    input.currentDescription,
    ``,
    `# Clarifying Question`,
    input.question?.trim() || "(question text unavailable)",
    ``,
    `# User's Answer`,
    answerParts.join("\n"),
    ``,
    `Rewrite the intent description so it naturally incorporates the answer.`,
  ].join("\n");
}

/** Matches leftover mechanical refinement markers the model must never emit. */
const MARKER_PATTERN = /\[\s*refined\s*:/i;

export class IntentRefiner {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("intentRefiner", IntentRefinerResponseSchema, {
      name: "intent_refiner",
    });
  }

  /**
   * Rewrite the intent description to incorporate the answer.
   *
   * @returns The rewritten description, or null when the LLM fails, the
   *   output is malformed, empty, or still contains refinement markers —
   *   callers should fall back to a non-LLM strategy.
   */
  @Timed()
  async refine(
    input: IntentRefinerInput,
    options?: { signal?: AbortSignal },
  ): Promise<string | null> {
    let raw: unknown;
    try {
      raw = await invokeWithAbortSignal(
        this.model,
        [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(buildRefinerPrompt(input))],
        options?.signal,
      );
    } catch (err) {
      logger.warn("IntentRefiner LLM call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const parsed = IntentRefinerResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("IntentRefiner parse failed", { error: parsed.error.message });
      return null;
    }

    const refined = parsed.data.refinedDescription.trim();
    if (!refined || MARKER_PATTERN.test(refined)) {
      logger.warn("IntentRefiner output rejected by guardrail", {
        empty: !refined,
        hasMarker: MARKER_PATTERN.test(refined),
      });
      return null;
    }

    return refined;
  }
}
