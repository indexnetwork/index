/**
 * Signal intake pack generator.
 *
 * Produces the offline half of the fast intake path: a prose brief written for
 * the intake task and a ready round-1 question. Both are stored per user and
 * refreshed in the background, so `/i/new` can render round 1 with no model call.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";

/** One selectable option on the round-1 question. */
export interface IntakePackQuestionOption {
  label: string;
  description: string;
}

/** Round-1 question, shaped exactly like the frontend `QuestionPayload`. */
export interface IntakePackQuestion {
  title: string;
  prompt: string;
  options: IntakePackQuestionOption[];
  multiSelect: boolean;
}

/** Everything the generator needs about a user. */
export interface IntakePackInput {
  premises: Array<{ text: string }>;
  networkTitles: string[];
  globalContext: string | null;
}

/** Stored artifact: the brief plus the ready round-1 question. */
export interface IntakePack {
  brief: string;
  question: IntakePackQuestion;
}

const packSchema = z.object({
  brief: z.string().min(1),
  question: z.object({
    title: z.string(),
    prompt: z.string().min(1),
    options: z.array(z.object({ label: z.string().min(1), description: z.string() })),
    multiSelect: z.boolean(),
  }),
});

const SYSTEM_PROMPT = `You prepare a person's signal-intake pack for a networking product.

Produce two things:

1. "brief": 4-8 sentences of prose, third person, written specifically to help a
   small model run an intake interview with this person. Cover who they are, what
   they plausibly need from a connection, what they can offer in return, and which
   communities they belong to. Be concrete. Never invent facts beyond the input.

2. "question": the opening intake question asking who they want to meet right now.
   Give 3-4 concrete, distinct recipient profiles grounded in the person's actual
   background (for example a design partner, a technical co-founder, an early
   customer, a specific expertise gap) — never generic choices like "anyone".
   Each option needs a short label and a one-line description. Set multiSelect false.

Never expose raw JSON, IDs, or internal vocabulary in either field.`;

/** Generates and normalizes the per-user intake pack. */
export class SignalIntakePackGenerator {
  private readonly model: Runnable<BaseLanguageModelInput, IntakePack>;

  /**
   * @param model - Optional injected structured model. Tests pass a stub.
   */
  constructor(model?: Runnable<BaseLanguageModelInput, IntakePack>) {
    this.model = model ?? createStructuredModel("signalIntakePack", packSchema) as unknown as Runnable<BaseLanguageModelInput, IntakePack>;
  }

  /**
   * Generate the intake pack for one user.
   *
   * @param input - Active premises, membership titles, and the global context paragraph
   * @returns Normalized brief and round-1 question
   */
  async generate(input: IntakePackInput): Promise<IntakePack> {
    const premiseBlock = input.premises.map((p) => `- ${p.text}`).join("\n");
    const networkBlock = input.networkTitles.length > 0
      ? input.networkTitles.join(", ")
      : "none";
    const contextBlock = input.globalContext?.trim() ? input.globalContext.trim() : "none";

    const raw = await this.model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Communities: ${networkBlock}\n\nGlobal context:\n${contextBlock}\n\nPremises:\n${premiseBlock}\n\nWrite the intake pack.`,
      ),
    ]);

    return normalizeIntakePack(raw);
  }
}

/**
 * Clamp a generated pack into the shape the frontend can render.
 *
 * @param pack - Raw model output
 * @returns Normalized pack
 * @throws When the question has fewer than 2 usable options
 */
export function normalizeIntakePack(pack: IntakePack): IntakePack {
  const options = pack.question.options
    .filter((option) => option.label.trim().length > 0)
    .slice(0, 4)
    .map((option) => ({
      label: option.label.trim().slice(0, 120),
      description: option.description.trim().slice(0, 280),
    }));

  if (options.length < 2) {
    throw new Error("Intake pack question needs at least 2 options.");
  }

  return {
    brief: pack.brief.trim(),
    question: {
      title: pack.question.title.trim() || "Question 1",
      prompt: pack.question.prompt.trim().slice(0, 400),
      options,
      multiSelect: pack.question.multiSelect,
    },
  };
}
