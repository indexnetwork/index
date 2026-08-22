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

/**
 * Everything synthesis needs to write the signal.
 *
 * Deliberately has no brief: an intent derives only from what the person
 * answered. The brief sources questions and answer options upstream, but
 * nothing it says may reach the synthesized signal unless the person said it.
 */
export interface SynthesisInput {
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

const optionSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
});

const answerFirstQuestionSchema = z.object({
  missingAxis: z
    .enum(["purpose", "desired_attributes", "exchange", "constraint"])
    .describe("The unanswered decision axis selected only from the answered intake rounds."),
  title: z.string(),
  prompt: z.string().min(1),
  answerGroundedOptions: z
    .array(optionSchema)
    .min(2)
    .max(3)
    .describe("Two or three distinct choices derived only from the answered intake rounds."),
  multiSelect: z.boolean(),
});

const followUpPlanSchema = z.object({
  questions: z.array(answerFirstQuestionSchema),
  plannedFollowUpCount: z.number().int().min(0),
});

const profileBridgePlanSchema = z.object({
  bridges: z.array(z.object({
    questionIndex: z.number().int().min(0),
    profileBridgeOption: optionSchema
      .nullable()
      .describe("One natural profile intersection, or null when the bridge would be forced."),
  })),
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

const PLAN_SYSTEM_PROMPT = `You plan and write answer-first follow-up intake questions for a networking product.

You receive ONLY the answered intake rounds. Use them to choose the next missing
axis, write a standalone prompt that names the newly stated person or domain, and
create 2-3 meaningfully distinct answerGroundedOptions. Choose the most useful
unanswered axis from: purpose, desired_attributes, exchange, or constraint. Never
re-ask an axis the rounds already answer. Do not infer a professional background,
industry, capability, or commercial goal that the rounds do not state.

Every answerGroundedOption must be visibly anchored to the stated person or domain
in its label or description and represent a concrete, distinct path. Generic labels
such as "Learn", "Share", "Collaborate", or "Networking" are invalid when they do
not say what the user would learn, share, collaborate on, or network about.
- Scuba divers: "Learn diving techniques", "Find dive buddies", "Share dive stories".
- Climate founders: "Compare climate sectors", "Find climate peers", "Discuss adaptation".

Each option needs a short label and a one-line description. Set multiSelect true
only when several options can genuinely apply together. Never expose raw JSON,
IDs, or internal vocabulary. plannedFollowUpCount is the TOTAL number of follow-up
questions the interview should contain, including any returned now; when the input
already fixes it, echo that value unchanged.`;

const PROFILE_BRIDGE_SYSTEM_PROMPT = `You may append one optional profile bridge to each already-written signal-intake question.

The question, missing axis, and answer-grounded options are immutable. For each
questionIndex, compare them with the profile brief and return either one genuinely
useful profileBridgeOption or null. A bridge is useful only when it creates a
natural additional path that is not already represented. Never rewrite, replace,
remove, or reclassify a core option. Never return more than one bridge per question.
When the profile theme is unrelated or the intersection would feel forced, return
null. Running club + investor may support one sponsorship bridge; scuba divers +
pianist should return null.`;

const SYNTHESIS_SYSTEM_PROMPT = `You write one clear signal for a networking product.

You receive ONLY the interview: each question the person was asked and the answer
they gave. Compose and normalize those answers into a specific description of who
they want to meet, what they bring or need, and any stated constraint. Write it in
the person's own voice, first person, 1-3 sentences, concrete and free of hype.
Also return short "lookingFor" and "youBring" summaries for the confirmation card.
When revision feedback is present, it is the person correcting a draft they
already read: apply it to the whole signal rather than treating it as a place or
community constraint.

Tighten the wording; never extend it. Do not weave in background, employer,
seniority, industry, capability, or commercial goal that the answers do not state.
Every claim in the output must trace back to something the person answered.`;

/**
 * Render an answer as a human-readable label.
 *
 * @param answer - Selected options plus optional free text
 * @returns Comma-joined non-empty parts
 */
export function answerLabel(answer: IntakeAnswer): string {
  return [...answer.selectedOptions, answer.freeText?.trim() ?? ""].filter(Boolean).join(", ");
}

function normalizeFollowUpQuestion(
  question: z.infer<typeof answerFirstQuestionSchema>,
  profileBridge: z.infer<typeof optionSchema> | null,
  brief: string,
): IntakePackQuestion {
  const seen = new Set<string>();
  const normalizeOption = (option: { label: string; description: string }) => {
    const label = option.label.trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) return null;
    seen.add(key);
    return { label, description: option.description.trim() };
  };

  const answerGroundedOptions = question.answerGroundedOptions
    .map(normalizeOption)
    .filter((option): option is NonNullable<typeof option> => option !== null)
    .slice(0, 3);
  if (answerGroundedOptions.length < 2) {
    throw new Error("Follow-up question needs at least two answer-grounded options.");
  }

  const profileBridgeOption = profileBridge ? normalizeOption(profileBridge) : null;
  return normalizeIntakePack({
    brief,
    question: {
      title: question.title,
      prompt: question.prompt,
      options: [
        ...answerGroundedOptions,
        ...(profileBridgeOption ? [profileBridgeOption] : []),
      ],
      multiSelect: question.multiSelect,
    },
  }).question;
}

/** Runs the two live stages of the fast intake funnel: follow-up planning and synthesis. */
export class SignalIntakeOrchestrator {
  private readonly plannerModel: Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
  private readonly profileBridgeModel: Runnable<BaseLanguageModelInput, z.infer<typeof profileBridgePlanSchema>>;
  private readonly synthesisModel: Runnable<BaseLanguageModelInput, SynthesisResult>;

  /**
   * @param models - Optional injected structured models. Tests pass stubs.
   */
  constructor(models?: {
    planner?: Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
    profileBridge?: Runnable<BaseLanguageModelInput, z.infer<typeof profileBridgePlanSchema>>;
    synthesis?: Runnable<BaseLanguageModelInput, SynthesisResult>;
  }) {
    this.plannerModel = models?.planner
      ?? createStructuredModel("signalIntakePack", followUpPlanSchema) as unknown as Runnable<BaseLanguageModelInput, z.infer<typeof followUpPlanSchema>>;
    this.profileBridgeModel = models?.profileBridge
      ?? createStructuredModel("signalIntakePack", profileBridgePlanSchema, { name: "signal_intake_profile_bridges" }) as unknown as Runnable<BaseLanguageModelInput, z.infer<typeof profileBridgePlanSchema>>;
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
          `ANSWERED ROUNDS:\n${roundsText}\n\nWrite up to ${input.maxFollowUps} follow-up question(s).${lockedLine}`,
        ),
      ]);
      const coreQuestions = raw.questions.slice(0, input.maxFollowUps);
      const bridgeByQuestion = new Map<number, z.infer<typeof optionSchema> | null>();
      if (coreQuestions.length > 0 && input.brief.trim()) {
        try {
          const bridgePlan = await this.profileBridgeModel.invoke([
            new SystemMessage(PROFILE_BRIDGE_SYSTEM_PROMPT),
            new HumanMessage(
              `ANSWERED ROUNDS:\n${roundsText}\n\nPROFILE BRIEF:\n${input.brief}\n\nIMMUTABLE CORE QUESTIONS:\n${JSON.stringify(coreQuestions, null, 2)}\n\nReturn one bridge decision for each questionIndex.`,
            ),
          ]);
          for (const bridge of bridgePlan.bridges) {
            if (
              bridge.questionIndex < coreQuestions.length
              && !bridgeByQuestion.has(bridge.questionIndex)
            ) {
              bridgeByQuestion.set(bridge.questionIndex, bridge.profileBridgeOption);
            }
          }
        } catch {
          // Profile personalization is optional. A bridge-model failure must not
          // discard valid answer-grounded questions from the primary model.
        }
      }
      const questions = coreQuestions.map((question, index) =>
        normalizeFollowUpQuestion(question, bridgeByQuestion.get(index) ?? null, input.brief));
      // Backstop: while budget remains, a successful empty plan must not
      // silently shrink the interview; serve the static fallback instead.
      if (questions.length === 0 && input.maxFollowUps > 0) {
        return {
          questions: [FALLBACK_BRING_QUESTION],
          plannedFollowUpCount: input.plannedFollowUpCount ?? 1,
        };
      }
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
   * @param input - Ordered rounds, optional where constraint, optional feedback
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
        `INTERVIEW:\n${roundsText}${whereLine}${feedbackLine}\n\nWrite the signal.`,
      ),
    ]);
    return {
      description: result.description.trim(),
      lookingFor: result.lookingFor.trim(),
      youBring: result.youBring.trim(),
    };
  }
}
