/**
 * Payload clarification for signal creation.
 *
 * One model call per round: given the payload someone typed — and, on a later
 * round, the answers they gave — return the payload as it should now read plus
 * the questions still worth asking. Nothing is stored: every call carries its
 * whole input, and answering is always optional.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";

const logger = protocolLogger("IntentClarifier");

/** One answer the person already gave, paired with the question it answers. */
export interface ClarifyAnswer {
  prompt: string;
  answer: string;
}

/** A payload to clarify, plus any answers gathered so far. */
export interface ClarifyInput {
  payload: string;
  answers?: ClarifyAnswer[];
}

/** One selectable choice on a clarifying question. */
export interface ClarifyQuestionOption {
  label: string;
  description: string;
}

/** One clarifying question, shaped for direct rendering. */
export interface ClarifyQuestion {
  prompt: string;
  options: ClarifyQuestionOption[];
  multiSelect: boolean;
}

/** The payload as it now reads, plus whatever is still worth asking. */
export interface ClarifyResult {
  payload: string;
  questions: ClarifyQuestion[];
}

/** Hard cap on questions returned by one round. */
const MAX_QUESTIONS = 3;
/** Hard cap on options per question. */
const MAX_OPTIONS = 4;

const clarifySchema = z.object({
  payload: z.string(),
  questions: z.array(z.object({
    prompt: z.string(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string(),
    })),
    multiSelect: z.boolean(),
  })),
});

const SYSTEM_PROMPT = `You clarify a signal — one person's statement of who they want to reach and why — before it goes out for discovery.

You receive the payload they wrote and, when they have answered before, those answers.

payload:
- With no answers, echo the payload back byte for byte. Do not rewrite it.
- With answers, rewrite the payload so every answer is stated in it, in the person's own voice, first person, 1-3 sentences, concrete and free of hype. Tighten; never pad. Every claim must trace to what they wrote or answered — never invent a background, employer, industry, budget, or goal.

questions: up to ${MAX_QUESTIONS}, fewer when the payload is already specific enough to search on, and none when it is.
- Ask only about something whose answer would change which people surface: the missing participant or outcome, an undecided ranking boundary (where, when, how, how much), or a choice between materially different readings.
- Never re-ask what the payload or an earlier answer already settles.
- Give each question 2-${MAX_OPTIONS} concrete, distinct options anchored to the person or domain the payload names, each with a short label and a one-line description. Generic labels such as "Learn", "Share", or "Collaborate" are invalid unless they say what about.
- Set multiSelect true only when several options can genuinely hold together.
- Never expose raw JSON, IDs, or internal vocabulary.`;

/**
 * Turns a typed payload plus optional answers into a clarified payload and the
 * next questions.
 */
export class IntentClarifier {
  private readonly model = createStructuredModel("intentClarifier", clarifySchema, {
    name: "intent_clarifier",
  });

  /**
   * Run one clarification round.
   *
   * @param input - The payload and any answers gathered so far.
   * @returns The payload as it now reads plus 0-{@link MAX_QUESTIONS} questions.
   *   A model failure degrades to the payload unchanged with no questions,
   *   because skipping clarification is always valid.
   */
  @Timed()
  public async invoke(input: ClarifyInput): Promise<ClarifyResult> {
    const answers = (input.answers ?? []).filter((a) => a.answer.trim().length > 0);
    const answerBlock = answers.length > 0
      ? answers.map((a) => `Q: ${a.prompt}\nA: ${a.answer.trim()}`).join("\n\n")
      : "none";

    try {
      const raw = await invokeWithAbortSignal(this.model, [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(`# Payload\n${input.payload}\n\n# Answers\n${answerBlock}`),
      ]);
      const parsed = clarifySchema.parse(raw);
      const payload = answers.length > 0
        ? (parsed.payload.trim() || input.payload)
        : input.payload;
      return { payload, questions: normalizeQuestions(parsed.questions) };
    } catch (error) {
      logger.warn("invoke: clarification failed", { error });
      return { payload: input.payload, questions: [] };
    }
  }
}

function normalizeQuestions(questions: z.infer<typeof clarifySchema>["questions"]): ClarifyQuestion[] {
  return questions
    .map((question) => {
      const seen = new Set<string>();
      const options: ClarifyQuestionOption[] = [];
      for (const option of question.options) {
        const label = option.label.trim().slice(0, 120);
        const key = label.toLocaleLowerCase();
        if (!label || seen.has(key)) continue;
        seen.add(key);
        options.push({ label, description: option.description.trim().slice(0, 280) });
        if (options.length === MAX_OPTIONS) break;
      }
      return {
        prompt: question.prompt.trim().slice(0, 400),
        options,
        multiSelect: question.multiSelect,
      };
    })
    .filter((question) => question.prompt.length > 0 && question.options.length >= 2)
    .slice(0, MAX_QUESTIONS);
}
