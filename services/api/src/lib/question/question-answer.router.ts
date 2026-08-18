/**
 * Question-answer router (conversational-questions answer wiring).
 *
 * One model call that maps a client's DM reply onto the questions of the open
 * question-message (docs/plans/2026-08-18-conversational-questions.md,
 * "Answers"). The model refers to questions strictly by index — it never sees
 * or emits a negotiation ref, so it cannot mint one the block would route to
 * the wrong negotiation. The caller maps indices back to the block's primary
 * `opportunityId` refs and feeds `consumeQuestionBlockAnswers`.
 *
 * Fail-closed contract, in the routing direction: routing is interpretive and
 * a misroute resumes the wrong negotiation with the wrong fact, so an invalid
 * mapping, out-of-range index, or duplicate index rejects the round trip.
 * There is no deterministic fallback — a reply the model cannot route resumes
 * NOTHING (the caller asks a clarifying follow-up or lets redelivery retry).
 */
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

import type { QuestionBlock, RoutedAnswer } from '@indexnetwork/protocol';

import { log } from '../log';

const logger = log.lib.from('question-answer.router');

/** Bound on reply text handed to the model; a longer reply is truncated. */
const MAX_REPLY_CHARS = 6000;

const RoutedOutputSchema = z.object({
  /**
   * False when the reply does not attempt to answer any of the questions —
   * greetings, unrelated requests, questions back to the agent. The caller
   * skips consumption entirely rather than sending a clarifying follow-up
   * for ordinary conversation.
   */
  addressesQuestions: z.boolean(),
  answers: z.array(z.object({
    question: z.number().int().min(0),
    answerText: z.string().min(1).max(4000),
  })).max(20),
});

export interface RoutedReply {
  /** Whether the reply attempted to answer any question at all. */
  addressesQuestions: boolean;
  /** Routed answers keyed by the block's primary refs; may be empty. */
  answers: RoutedAnswer[];
}

const SYSTEM_PROMPT = `You are the Index Negotiator. You previously sent your client one message containing numbered questions; the client has now replied in the same chat. Decide which questions the reply answers, and extract the answer content for each.

Rules:
- "addressesQuestions" is false when the reply does not attempt to answer any question (a greeting, small talk, an unrelated request, a question back to you). Then "answers" is empty.
- Each entry in "answers" names one question by its index and carries "answerText": what the client said in answer to that question, restated minimally so it stands alone (resolve "yes"/"the first one"/pronouns against the question's own wording). Use only what the client actually said — never add assumptions, preferences, or details the reply does not contain.
- One reply may answer several questions; split the content accordingly. Answer content that plausibly belongs to two questions goes to the one it fits best — never duplicate it.
- Route ONLY what is clearly an answer to a specific question. If you cannot tell which question a statement answers, leave it unrouted; answering the wrong negotiation with the wrong fact is worse than asking again.
- Each question index appears at most once.`;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export interface QuestionAnswerRouterConfig {
  /** Model override; defaults to the negotiator's model. */
  model?: string;
}

export class QuestionAnswerRouter {
  private readonly modelName: string;

  constructor(config?: QuestionAnswerRouterConfig) {
    this.modelName = config?.model ?? 'google/gemini-2.5-flash';
  }

  /**
   * Routes one reply against the block it answers. Validates → retries once →
   * throws: routing has no safe deterministic fallback, and the caller's
   * queue retry handles a transient model outage.
   */
  async route(input: { block: QuestionBlock; replyText: string }): Promise<RoutedReply> {
    const questionList = input.block.questions
      .map((question, index) => `${index}. ${question.prompt}`)
      .join('\n');
    const userMessage = [
      'The questions from your message:',
      questionList,
      '',
      `The client's reply:\n${truncate(input.replyText, MAX_REPLY_CHARS)}`,
      '',
      'Route the reply: which questions does it answer, and with what content?',
    ].join('\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.callModel([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ]);
      const routed = this.validate(raw, input.block);
      if (routed) return routed;
      logger.warn('Question-answer routing output rejected', { attempt: attempt + 1 });
    }
    throw new Error('Question-answer routing produced no valid mapping');
  }

  /** Schema + index-range + uniqueness validation of one model round trip. */
  private validate(raw: unknown, block: QuestionBlock): RoutedReply | null {
    const parsed = RoutedOutputSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (!parsed.data.addressesQuestions && parsed.data.answers.length > 0) return null;

    const seen = new Set<number>();
    for (const answer of parsed.data.answers) {
      if (answer.question >= block.questions.length || seen.has(answer.question)) return null;
      seen.add(answer.question);
    }
    return {
      addressesQuestions: parsed.data.addressesQuestions,
      answers: parsed.data.answers.map((answer) => ({
        ref: block.questions[answer.question].opportunityId,
        answerText: answer.answerText.trim(),
      })),
    };
  }

  /**
   * Raw structured-model round trip. A seam so tests drive the
   * validate → retry loop without a live provider — the model is constructed
   * here, not in the constructor, so tests never need a key.
   */
  protected async callModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error('QuestionAnswerRouter: OPENROUTER_API_KEY is required');
    const timeoutEnv = Number.parseInt(process.env.OPENROUTER_REQUEST_TIMEOUT_MS ?? '', 10);
    const model = new ChatOpenAI({
      model: this.modelName,
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey,
      },
      temperature: 0,
      maxTokens: 2048,
      timeout: Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 60_000,
      maxRetries: 1,
    });
    return model
      .withStructuredOutput(RoutedOutputSchema, { name: 'question_answer_routing' })
      .invoke(messages);
  }
}
