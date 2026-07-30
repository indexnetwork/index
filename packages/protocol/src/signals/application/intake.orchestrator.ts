/**
 * Deterministic signal-intake stage logic.
 *
 * The fast intake path is a fixed funnel, so stages are driven here rather than
 * by an agent loop: round 1 comes from the precomputed pack, round 2 is one
 * structured call, round 3 is a deterministic client-side picker, and synthesis
 * is one structured call. This module owns no I/O.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { normalizeIntakePack, type IntakePackQuestion } from "./intake.pack.generator.js";

/** One answered intake round. */
export interface IntakeAnswer {
  selectedOptions: string[];
  freeText?: string;
}

/** Everything synthesis needs to write the signal. */
export interface SynthesisInput {
  brief: string;
  whoAnswer: IntakeAnswer;
  bringAnswer: IntakeAnswer;
  /** Free-text place/community constraint from round 3. */
  whereText?: string;
  /**
   * Free-text correction the user typed against a draft they already saw.
   * Distinct from {@link SynthesisInput.whereText}: feedback rewrites the
   * signal, it does not constrain where to look.
   */
  feedback?: string;
}

/** Synthesized signal text plus its summary fields. */
export interface SynthesisResult {
  description: string;
  lookingFor: string;
  youBring: string;
}

const questionSchema = z.object({
  title: z.string(),
  prompt: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), description: z.string() })),
  multiSelect: z.boolean(),
});

const synthesisSchema = z.object({
  description: z.string().min(1),
  lookingFor: z.string().min(1),
  youBring: z.string().min(1),
});

/** Static round-1 question used only when pack generation fails outright. */
export const FALLBACK_WHO_QUESTION: IntakePackQuestion = {
  title: "Question 1",
  prompt: "Who do you want to meet right now?",
  options: [
    { label: "A collaborator", description: "Someone to build or work on something with" },
    { label: "A customer or user", description: "Someone who has the problem you solve" },
    { label: "An expert", description: "Someone who has done this before" },
    { label: "A peer", description: "Someone at a similar stage to compare notes with" },
  ],
  multiSelect: false,
};

/** Static round-2 question used when live generation fails. */
export const FALLBACK_BRING_QUESTION: IntakePackQuestion = {
  title: "Question 2",
  prompt: "What would you bring, and what gap should they fill?",
  options: [
    { label: "Hands-on expertise", description: "You can do the work with them" },
    { label: "Introductions and reach", description: "You can open doors for them" },
    { label: "Funding or resources", description: "You can back what they are doing" },
    { label: "A mutual exchange", description: "You each cover the other's gap" },
  ],
  multiSelect: false,
};

const QUESTION_SYSTEM_PROMPT = `You write one intake question for a networking product.

Given a brief about the person and who they said they want to meet, ask what they
would bring to that connection and what gap the other side should fill. Give 3-4
concrete options grounded in the brief, each with a short label and a one-line
description. Include an option for mutual exchange when both sides matter. Set
multiSelect false. Never expose raw JSON, IDs, or internal vocabulary.`;

const SYNTHESIS_SYSTEM_PROMPT = `You write one clear signal for a networking product.

Combine the brief and the person's answers into a specific description of who they
want to meet, what they bring or need, and any stated constraint. Write it in the
person's own voice, first person, 1-3 sentences, concrete and free of hype. Also
return short "lookingFor" and "youBring" summaries for the confirmation card.
When revision feedback is present, it is the person correcting a draft they
already read: apply it to the whole signal rather than treating it as a place or
community constraint. Never invent facts beyond the brief and the answers.`;

/**
 * Render an answer as a human-readable label.
 *
 * @param answer - Selected options plus optional free text
 * @returns Comma-joined non-empty parts
 */
export function answerLabel(answer: IntakeAnswer): string {
  return [...answer.selectedOptions, answer.freeText?.trim() ?? ""].filter(Boolean).join(", ");
}

/** Runs the two live stages of the fast intake funnel. */
export class SignalIntakeOrchestrator {
  private readonly questionModel: Runnable<BaseLanguageModelInput, IntakePackQuestion>;
  private readonly synthesisModel: Runnable<BaseLanguageModelInput, SynthesisResult>;

  /**
   * @param models - Optional injected structured models. Tests pass stubs.
   */
  constructor(models?: {
    question?: Runnable<BaseLanguageModelInput, IntakePackQuestion>;
    synthesis?: Runnable<BaseLanguageModelInput, SynthesisResult>;
  }) {
    this.questionModel = models?.question
      ?? createStructuredModel("signalIntakePack", questionSchema) as unknown as Runnable<BaseLanguageModelInput, IntakePackQuestion>;
    this.synthesisModel = models?.synthesis
      ?? createStructuredModel("signalIntakePack", synthesisSchema) as unknown as Runnable<BaseLanguageModelInput, SynthesisResult>;
  }

  /**
   * Generate round 2 from the brief and the round-1 answer.
   *
   * @param input - Brief plus the answered round-1 question
   * @returns A renderable question; the static fallback when generation fails
   */
  async nextQuestion(input: { brief: string; whoAnswer: IntakeAnswer }): Promise<IntakePackQuestion> {
    try {
      const raw = await this.questionModel.invoke([
        new SystemMessage(QUESTION_SYSTEM_PROMPT),
        new HumanMessage(
          `Brief:\n${input.brief}\n\nThey want to meet: ${answerLabel(input.whoAnswer)}\n\nWrite the question.`,
        ),
      ]);
      return normalizeIntakePack({ brief: input.brief, question: raw }).question;
    } catch {
      return FALLBACK_BRING_QUESTION;
    }
  }

  /**
   * Write the signal from both answers, any where-constraint, and any
   * revision feedback.
   *
   * @param input - Brief, both answers, optional where constraint, optional feedback
   * @returns Description plus card summary fields
   * @throws Propagates model failure so the caller can mark the run failed
   */
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const whereLine = input.whereText?.trim()
      ? `\n\nWhere constraint: ${input.whereText.trim()}`
      : "";
    const feedbackLine = input.feedback?.trim()
      ? `\n\nRevision feedback on the previous draft: ${input.feedback.trim()}`
      : "";
    const result = await this.synthesisModel.invoke([
      new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage(
        `Brief:\n${input.brief}\n\nThey want to meet: ${answerLabel(input.whoAnswer)}\n\nThey bring: ${answerLabel(input.bringAnswer)}${whereLine}${feedbackLine}\n\nWrite the signal.`,
      ),
    ]);
    return {
      description: result.description.trim(),
      lookingFor: result.lookingFor.trim(),
      youBring: result.youBring.trim(),
    };
  }
}
