/**
 * Question-message author (conversational-questions delivery spine).
 *
 * One model call in the negotiator's voice that renders the current parked
 * set for one signal into the question-message: a short preamble plus one
 * conversational question per open gap, merging negotiations parked on the
 * same gap (docs/plans/2026-08-18-conversational-questions.md). Grounding is
 * exactly what park-time authoring uses (#1428 / #1430): the parked
 * negotiations' transcripts and park-time questions, plus the client's own
 * negotiator DM excerpt for the signal.
 *
 * Runs ONLY for the in-process system agent — the regeneration queue is the
 * sole caller. External seats never reach this module, which is why the DM
 * excerpt may appear in its prompt at all (see negotiation.client-dm.ts).
 *
 * Fail-open contract, in the delivery direction: a model failure, invalid
 * mapping, or unsafe output degrades to a deterministic composition of the
 * park-time questions (each already passed the identifier-aware safety gate
 * before it persisted) under fixed server-owned prose. Only a parked set with
 * no renderable question at all resolves to null — then there is no message.
 */
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

import type { QuestionBlockQuestion } from '@indexnetwork/protocol';
import { QuestionBlockSchema } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../adapters/parked-negotiation.reader.adapter';
import type { NegotiatorClientDmMessage } from '../../adapters/negotiator-client-dm.retrieval.adapter';
import { isSafeQuestionMessageProse, isSafeQuestionMessagePrompt } from './negotiation-question.contract';
import { log } from '../log';

const logger = log.lib.from('question-message.author');

/**
 * Server-owned preamble used when the model call fails or its output is
 * rejected. Fixed copy, never model text — the fallback path must not reopen
 * the surface the gates close.
 */
export const QUESTION_MESSAGE_FALLBACK_PROSE =
  'Some of the conversations I am running on this signal are waiting on details only you can provide. '
  + 'Answer here and I will pick them back up.';

/** Prompt budget per transcript: the tail is what says where it stuck. */
const MAX_TRANSCRIPT_TURNS = 8;
const MAX_TURN_CHARS = 600;
const MAX_DM_CHARS = 1200;

export interface QuestionMessageAuthorInput {
  /** The signal's own text (intent payload), for grounding only. */
  signalText?: string;
  /** The parked set, oldest park first. Must be non-empty. */
  parked: ParkedNegotiation[];
  /** Recent excerpt of the client's negotiator DM, most recent last. */
  clientDm: NegotiatorClientDmMessage[];
}

export interface AuthoredQuestionMessage {
  prose: string;
  questions: QuestionBlockQuestion[];
}

/**
 * Model output references parked negotiations by index; the author maps them
 * back to opportunity ids. The model never sees or emits an id, so it cannot
 * mint a ref the block would route to the wrong negotiation.
 */
const AuthoredOutputSchema = z.object({
  prose: z.string().min(1).max(2000),
  questions: z.array(z.object({
    prompt: z.string().min(1).max(2000),
    unblocks: z.array(z.number().int().min(0)).min(1).max(9),
  })).min(1).max(20),
});

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function renderParkedNegotiation(parked: ParkedNegotiation, index: number): string {
  const lines = [`Parked negotiation ${index}:`];
  if (parked.reason) lines.push(`- Pause category: ${parked.reason}`);
  if (parked.question) {
    const options = parked.question.options
      .map((option) => `${option.label} (${option.description})`)
      .join('; ');
    lines.push(`- Question authored at park time: [${parked.question.title}] ${parked.question.prompt}`);
    lines.push(`- Its decision options: ${options}`);
  } else {
    lines.push('- No question was authored at park time; derive the gap from the transcript.');
  }
  const tail = parked.transcript.slice(-MAX_TRANSCRIPT_TURNS);
  if (tail.length > 0) {
    lines.push('- Transcript tail:');
    tail.forEach((turn, turnIndex) => {
      const message = turn.message ? ` — message: ${truncate(turn.message, MAX_TURN_CHARS)}` : '';
      lines.push(`  ${turnIndex + 1}. ${turn.action}: ${truncate(turn.reasoning, MAX_TURN_CHARS)}${message}`);
    });
  }
  return lines.join('\n');
}

function renderClientDm(clientDm: NegotiatorClientDmMessage[]): string {
  if (clientDm.length === 0) return '';
  const lines = clientDm.map((message) =>
    `- ${message.role === 'client' ? 'Client' : 'You'}: ${truncate(message.content, MAX_DM_CHARS)}`);
  return `\n\nYour recent conversation with the client about this signal (most recent last):\n${lines.join('\n')}`;
}

const SYSTEM_PROMPT = `You are the Index Negotiator, an AI agent negotiating on behalf of your client. Several negotiations you are running for one of their signals are paused because they need information only your client holds. Write them ONE chat message that asks for all of it.

Rules:
- "prose" is a short preamble (2-3 sentences, second person, plain language): what you have been doing on this signal and why you are pausing to ask. No greetings, no sign-off, no bullet lists.
- "questions" are the asks. Merge negotiations parked on the same gap into one question; keep genuinely different gaps separate. Each question's "unblocks" lists the parked negotiation indices that one answer would resume — every index must appear in exactly one question.
- Each prompt is at most 2 sentences ending in a question mark, grounded in what actually stuck in that negotiation, in the client's own terms. Where a park-time question exists, preserve its substance; fold its decision options into the prompt when they help the client answer.
- Never name, quote, or describe any counterparty; the client can read the transcripts, but this message must stand on its own without their identity in it.
- Do not reference internal system details: ids, scores, pre-screens, evaluator or assessment reasoning.
- Do not ask anything the client already settled in your conversation with them below; if their own words settle a gap, drop it from that question.`;

export interface QuestionMessageAuthorConfig {
  /** Model override; defaults to the negotiator's model. */
  model?: string;
}

export class QuestionMessageAuthor {
  private readonly modelName: string;

  constructor(config?: QuestionMessageAuthorConfig) {
    this.modelName = config?.model ?? 'google/gemini-2.5-flash';
  }

  /**
   * Renders the parked set into prose + block questions. Never throws; falls
   * back to the deterministic composition on any model failure, and to null
   * only when nothing is renderable.
   */
  async author(input: QuestionMessageAuthorInput): Promise<AuthoredQuestionMessage | null> {
    if (input.parked.length === 0) return null;

    const userMessage = [
      input.signalText ? `The client's signal: ${truncate(input.signalText, 800)}\n` : '',
      input.parked.map(renderParkedNegotiation).join('\n\n'),
      renderClientDm(input.clientDm),
      '\n\nWrite the message: the prose preamble and the questions with their "unblocks" indices.',
    ].join('\n');

    try {
      // Validate → retry once → fall back, the same loop as park-time
      // authoring — except giving up composes deterministically instead of
      // dropping delivery: the parked set must reach the client either way.
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await this.callModel([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ]);
        const authored = this.validate(raw, input.parked);
        if (authored) return authored;
        logger.warn('Question-message model output rejected', { attempt: attempt + 1 });
      }
    } catch (err) {
      logger.warn('Question-message authoring failed; composing deterministically', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return this.compose(input.parked);
  }

  /** Schema + coverage + safety validation of one model round trip. */
  private validate(raw: unknown, parked: ParkedNegotiation[]): AuthoredQuestionMessage | null {
    const parsed = AuthoredOutputSchema.safeParse(raw);
    if (!parsed.success) return null;

    // Every parked negotiation must be unblocked by exactly one question —
    // the message is a complete view of the parked set, and a duplicate ref
    // would make answer routing ambiguous (QuestionBlockSchema also rejects it).
    const seen = new Set<number>();
    for (const question of parsed.data.questions) {
      for (const index of question.unblocks) {
        if (index >= parked.length || seen.has(index)) return null;
        seen.add(index);
      }
    }
    if (seen.size !== parked.length) return null;

    if (!isSafeQuestionMessageProse(parsed.data.prose)) return null;
    if (!parsed.data.questions.every((question) => isSafeQuestionMessagePrompt(question.prompt))) return null;

    const questions = parsed.data.questions.map((question) => {
      const [primary, ...rest] = question.unblocks;
      return {
        prompt: question.prompt.trim(),
        opportunityId: parked[primary].opportunityId,
        ...(rest.length > 0 ? { alsoUnblocks: rest.map((index) => parked[index].opportunityId) } : {}),
      };
    });
    return this.toAuthoredMessage(parsed.data.prose.trim(), questions);
  }

  /**
   * Deterministic composition: fixed prose over the park-time questions,
   * verbatim. Negotiations whose park-time question was stripped as unsafe
   * have nothing renderable and are left for a later regeneration.
   */
  private compose(parked: ParkedNegotiation[]): AuthoredQuestionMessage | null {
    const questions = parked.flatMap((negotiation) =>
      negotiation.question
        ? [{ prompt: negotiation.question.prompt, opportunityId: negotiation.opportunityId }]
        : []);
    if (questions.length === 0) {
      logger.warn('Parked set has no renderable question; skipping message', { parked: parked.length });
      return null;
    }
    return this.toAuthoredMessage(QUESTION_MESSAGE_FALLBACK_PROSE, questions);
  }

  /** Final block validation — an invalid block must never reach the serializer. */
  private toAuthoredMessage(prose: string, questions: QuestionBlockQuestion[]): AuthoredQuestionMessage | null {
    const block = QuestionBlockSchema.safeParse({ version: 1, questions });
    if (!block.success) {
      logger.warn('Authored question block failed schema validation', {
        issues: block.error.issues.map((issue) => issue.message).slice(0, 3),
      });
      return null;
    }
    return { prose, questions: block.data.questions };
  }

  /**
   * Raw structured-model round trip. A seam so tests drive the
   * validate → retry → fallback loop without a live provider — the model is
   * constructed here, not in the constructor, so tests never need a key.
   */
  protected async callModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error('QuestionMessageAuthor: OPENROUTER_API_KEY is required');
    const timeoutEnv = Number.parseInt(process.env.OPENROUTER_REQUEST_TIMEOUT_MS ?? '', 10);
    const model = new ChatOpenAI({
      model: this.modelName,
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey,
      },
      temperature: 0.3,
      maxTokens: 2048,
      timeout: Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 60_000,
      maxRetries: 1,
    });
    return model
      .withStructuredOutput(AuthoredOutputSchema, { name: 'question_message' })
      .invoke(messages);
  }
}
