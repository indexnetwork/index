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

/** One answered intake round, in order (round 1 first). */
export interface IntakeRound {
  prompt: string;
  answer: IntakeAnswer;
}

/** Everything synthesis needs to write the signal. */
export interface SynthesisInput {
  brief: string;
  rounds: IntakeRound[];
  /** Free-text place/community constraint from the where round. */
  whereText?: string;
  /**
   * Free-text correction the user typed against a draft they already saw.
   * Distinct from {@link SynthesisInput.whereText}: feedback rewrites the
   * signal, it does not constrain where to look.
   */
  feedback?: string;
}

/** Planning input for one follow-up generation call. */
export interface FollowUpPlanInput {
  brief: string;
  /** Answered rounds in order (round 1 first). */
  rounds: IntakeRound[];
  /** Hard cap on questions returned by THIS call. */
  maxFollowUps: number;
  /** Locked interview plan on continuation calls; echoed unchanged. */
  plannedFollowUpCount?: number;
}

/** The model's follow-up batch plus its total follow-up plan. */
export interface FollowUpPlan {
  questions: IntakePackQuestion[];
  plannedFollowUpCount: number;
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

const followUpPlanSchema = z.object({
  questions: z.array(questionSchema),
  plannedFollowUpCount: z.number().int().min(0),
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

const PLAN_SYSTEM_PROMPT = `You plan and write follow-up intake questions for a networking product.

Given a brief about the person and the intake rounds they already answered, decide
how many further questions (up to the stated maximum) would make their signal
specific enough to match on, and write them. Each question is one concise prompt
with 3-4 concrete options grounded in the brief and the previous answers; each
option has a short label and a one-line description. Set multiSelect true only
when several options can genuinely apply together. Never re-ask a dimension that
is already answered; skip a dimension the brief already covers. Never expose raw
JSON, IDs, or internal vocabulary. plannedFollowUpCount is the TOTAL number of
follow-up questions the interview should contain, including any returned now;
when the input already fixes it, echo that value unchanged.`;

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

/** Runs the two live stages of the fast intake funnel: follow-up planning and synthesis. */
export class SignalIntakeOrchestrator {
  private readonly plannerModel: Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
  private readonly synthesisModel: Runnable<BaseLanguageModelInput, SynthesisResult>;

  /**
   * @param models - Optional injected structured models. Tests pass stubs.
   */
  constructor(models?: {
    planner?: Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
    synthesis?: Runnable<BaseLanguageModelInput, SynthesisResult>;
  }) {
    this.plannerModel = models?.planner
      ?? createStructuredModel("signalIntakePack", followUpPlanSchema) as unknown as Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
    this.synthesisModel = models?.synthesis
      ?? createStructuredModel("signalIntakePack", synthesisSchema) as unknown as Runnable<BaseLanguageModelInput, SynthesisResult>;
  }

  /**
   * Plan and write follow-up questions from the brief and answered rounds.
   *
   * @param input - Brief, answered rounds, per-call cap, and any locked plan
   * @returns Up to `maxFollowUps` renderable questions plus the total plan;
   * the static fallback question with count 1 when generation fails
   */
  async generateFollowUps(input: FollowUpPlanInput): Promise<FollowUpPlan> {
    const roundsText = input.rounds
      .map((round, index) => `Round ${index + 1} — Q: ${round.prompt}\nA: ${answerLabel(round.answer)}`)
      .join("\n\n");
    const lockedLine = input.plannedFollowUpCount !== undefined
      ? `\n\nThe interview plan is fixed at ${input.plannedFollowUpCount} follow-up question(s) in total; ${input.rounds.length - 1} already asked. Echo that count unchanged.`
      : "";
    try {
      const raw = await this.plannerModel.invoke([
        new SystemMessage(PLAN_SYSTEM_PROMPT),
        new HumanMessage(
          `Brief:\n${input.brief}\n\n${roundsText}\n\nWrite up to ${input.maxFollowUps} follow-up question(s).${lockedLine}`,
        ),
      ]);
      const questions = raw.questions
        .slice(0, input.maxFollowUps)
        .map((q) => normalizeIntakePack({ brief: input.brief, question: q }).question);
      return {
        questions,
        plannedFollowUpCount: input.plannedFollowUpCount
          ?? Math.max(raw.plannedFollowUpCount, questions.length),
      };
    } catch {
      if (input.maxFollowUps <= 0) return { questions: [], plannedFollowUpCount: 0 };
      return {
        questions: [FALLBACK_BRING_QUESTION],
        plannedFollowUpCount: input.plannedFollowUpCount ?? 1,
      };
    }
  }

  /**
   * Write the signal from every answered round, any where-constraint, and any
   * revision feedback.
   *
   * @param input - Brief, ordered rounds, optional where constraint, optional feedback
   * @returns Description plus card summary fields
   * @throws Propagates model failure so the caller can mark the run failed
   */
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const roundsText = input.rounds
      .map((round) => `Q: ${round.prompt}\nA: ${answerLabel(round.answer)}`)
      .join("\n\n");
    const whereLine = input.whereText?.trim()
      ? `\n\nWhere constraint: ${input.whereText.trim()}`
      : "";
    const feedbackLine = input.feedback?.trim()
      ? `\n\nRevision feedback on the previous draft: ${input.feedback.trim()}`
      : "";
    const result = await this.synthesisModel.invoke([
      new SystemMessage(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage(
        `Brief:\n${input.brief}\n\n${roundsText}${whereLine}${feedbackLine}\n\nWrite the signal.`,
      ),
    ]);
    return {
      description: result.description.trim(),
      lookingFor: result.lookingFor.trim(),
      youBring: result.youBring.trim(),
    };
  }
}
