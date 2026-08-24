/**
 * Openness, per signal: what this user is currently being asked
 * (conversational questions, docs/plans/2026-08-18-conversational-questions.md).
 *
 * A question is OPEN iff its negotiation is PARKED on this user's side for
 * this signal — a mid-flight consult whose exact task sits `input_required`
 * inside its answer window, or a post-stall park. Nothing about the DM's
 * message order enters that predicate.
 *
 * That is a correction, and the incident behind it is exact. Openness used to
 * mean "the NEWEST agent message in the DM parses as a question block". On
 * 2026-08-20 a question was delivered at 20:21 and an edit-confirmation
 * landed after it at 20:24; the question was still the durable ask — its task
 * stayed `input_required` for the whole answer window — but it was no longer
 * the newest message. At 21:11 the client answered it and EVERY lane resolved
 * "nothing open": the precedence gate fell through, the orchestrator edited
 * the signal instead, and the model's own `answer_pending_question` call was
 * refused by the host with `no_open_question`. One intervening agent message
 * had buried an ask that was still waiting, and the park outlived its own
 * answerability.
 *
 * The spine's doctrine already said which of the two is the record: the
 * parked negotiation is the durable record, the DM message is its rendering.
 * So openness is read from the parked set, and the question BLOCK is
 * RECOVERED rather than located:
 *
 * - the delivered question-message when one exists ANYWHERE in the DM (the
 *   newest agent message that carries a block referencing a still-parked
 *   negotiation — not the newest agent message), else
 * - a block DERIVED from the parked turns themselves, through the same
 *   dimension derivation the message author uses (`dimension-question.ts`),
 *   so a park whose message was never delivered is still answerable.
 *
 * Every answerability lane resolves through {@link readOpenQuestionsForIntent}
 * — the precedence gate, the `answer_pending_question` host, and the
 * orchestrator's context enumeration — so the numbers the model is shown and
 * the numbers the host resolves cannot disagree. They are the same call, not
 * the same logic written twice.
 *
 * {@link readOpenQuestionMessages} stays anchored on the newest agent message
 * on purpose: it is the NOTIFICATION snapshot, and a notification deep-links a
 * message the client can actually open. A buried question is an answerability
 * problem, not a notification one.
 */
import { QuestionBlockSchema, parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock, QuestionBlockQuestion } from '@indexnetwork/protocol';

import type { ParkedNegotiation } from '../../adapters/parked-negotiation.reader.adapter';
import { renderableQuestion } from './dimension-question';
import { log } from '../log';

const logger = log.lib.from('open-question-message');

/** One signal's open question-message, reduced to what a notification needs. */
export interface OpenQuestionMessage {
  intentId: string;
  messageId: string;
  /** Questions in the open block — the notification's count, not a fan-out. */
  questionCount: number;
}

/** A candidate agent message from a signal's DM. */
export interface QuestionMessageCandidate {
  id: string;
  content: string;
}

/**
 * Every negotiation a block's questions reference — primaries plus each
 * question's `alsoUnblocks`. This set IS the message's identity: the block
 * carries no question ids, and a rewritten prompt over the same negotiation is
 * the same ask.
 */
export function questionBlockRefs(questions: ReadonlyArray<QuestionBlockQuestion>): Set<string> {
  return new Set(questions.flatMap((question) => [question.opportunityId, ...(question.alsoUnblocks ?? [])]));
}

/**
 * The candidate message's block if that block is still open against `parked`,
 * else null. Anything without a parseable block, or whose refs have all
 * resolved, is not open.
 *
 * @param candidate - The agent message this caller anchors on, or null
 * @param parked - The user's currently parked negotiations on this signal
 */
export function openQuestionBlock(
  candidate: QuestionMessageCandidate | null,
  parked: ReadonlyArray<{ opportunityId: string }>,
): { id: string; block: QuestionBlock } | null {
  if (!candidate) return null;
  const parsed = parseQuestionMessage(candidate.content);
  if (!parsed) return null;
  const parkedRefs = new Set(parked.map((negotiation) => negotiation.opportunityId));
  const referencesParked = [...questionBlockRefs(parsed.block.questions)].some((ref) => parkedRefs.has(ref));
  return referencesParked ? { id: candidate.id, block: parsed.block } : null;
}

/** Injectable seams; production resolves the real collaborators lazily. */
export interface OpenQuestionMessageReaderDeps {
  /** Newest agent message per ('negotiator-intent', intentId) DM of this user. */
  listNewestAgentMessages?: (userId: string) => Promise<Array<{ intentId: string; messageId: string; content: string }>>;
  /** This user's parked negotiations on one signal. */
  readParkedNegotiations?: (userId: string, intentId: string) => Promise<ReadonlyArray<{ opportunityId: string }>>;
}

/**
 * Every open question-message this user currently has, one per signal.
 *
 * Two-stage on purpose: one indexed read gives the newest agent message per
 * negotiator DM, and only the ones that actually carry a question block cost a
 * parked-set read. A signal whose DM has no block — the common case — never
 * touches the negotiation tables.
 */
export async function readOpenQuestionMessages(
  userId: string,
  deps?: OpenQuestionMessageReaderDeps,
): Promise<OpenQuestionMessage[]> {
  if (!userId) return [];

  const listNewestAgentMessages = deps?.listNewestAgentMessages
    ?? (async (id: string) => (await import('../../adapters/database.adapter')).conversationDatabaseAdapter
      .getNewestAgentMessagesForNegotiatorIntents(id));
  const readParkedNegotiations = deps?.readParkedNegotiations
    ?? (async (id: string, intentId: string) => (await import('../../adapters/parked-negotiation.reader.adapter'))
      .parkedNegotiationReaderAdapter.readParkedNegotiations(id, intentId));

  const candidates = await listNewestAgentMessages(userId);
  const open: OpenQuestionMessage[] = [];
  for (const candidate of candidates) {
    // Cheap first: no block, no parked-set read.
    if (!parseQuestionMessage(candidate.content)) continue;
    try {
      const parked = await readParkedNegotiations(userId, candidate.intentId);
      const openBlock = openQuestionBlock({ id: candidate.messageId, content: candidate.content }, parked);
      if (!openBlock) continue;
      open.push({
        intentId: candidate.intentId,
        messageId: candidate.messageId,
        questionCount: openBlock.block.questions.length,
      });
    } catch (err) {
      // One unreadable signal must not cost the caller every other frame.
      logger.warn('open_question_message_read_failed', {
        userId,
        intentId: candidate.intentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return open;
}

/** One question this signal currently has open, as the client sees it. */
export interface OpenQuestionForIntent {
  /** 1-based position in the block — the number the orchestrator is shown. */
  position: number;
  /** The step's label: its checklist dimension, else a short form of the prompt. */
  label: string;
  /** The negotiation this question unparks; the answer's routing identity. */
  opportunityId: string;
}

/** Where the open block came from — see the module header. */
export type OpenQuestionSource = 'delivered' | 'derived';

/** A signal's open questions, resolved for one intent scope. */
export interface OpenQuestionsForIntent {
  /**
   * The signal's negotiator DM, when it exists. Null only for a park whose
   * DM was never created — openness does not depend on the conversation, but
   * consuming an answer through the queue does, so the caller must check.
   */
  sessionId: string | null;
  /**
   * The delivered question-message's id, or — for a derived block — a
   * synthetic id that names no persisted message
   * ({@link derivedQuestionMessageId}). Carried for logging and job payloads
   * only; nothing downstream reads a message by it.
   */
  messageId: string;
  /** The block body an answer is consumed against — delivered, or serialized here. */
  body: string;
  /** The block itself, so a caller never re-parses `body` to route against it. */
  block: QuestionBlock;
  source: OpenQuestionSource;
  questions: OpenQuestionForIntent[];
}

/** Label cap for a question shown in the orchestrator's context. */
const MAX_QUESTION_LABEL_CHARS = 80;

/** Block-schema caps the derived block must respect (question-block.schema.ts). */
const MAX_BLOCK_QUESTIONS = 20;
const MAX_PROMPT_CHARS = 2000;
const MAX_DIMENSION_CHARS = 60;

/**
 * Server-owned prose for a DERIVED block. Never rendered to the client — a
 * derived block is not delivered, it is only the shape an answer is routed
 * and consumed against — but the body is a real question-message body, so it
 * carries real prose rather than a placeholder.
 */
export const DERIVED_QUESTION_MESSAGE_PROSE =
  'Some of the conversations I am running on this signal are waiting on details only you can provide.';

/**
 * The prompt for a park with nothing renderable at all: no authored question
 * (the safety gate stripped it, or no author was involved) and no dimension to
 * derive one from — a policy-inferred consultation, or a pre-checklist
 * post-stall gap.
 *
 * Fixed, server-owned copy. The alternative is dropping the park from the open
 * set, and that is exactly the hole this module exists to close: a park with a
 * live answer window must be answerable, and answering needs a question to
 * route onto. A generic prompt bound to the right negotiation resumes the
 * right negotiation; no prompt resumes nothing.
 */
export const UNRENDERABLE_PARK_PROMPT =
  'One of the conversations I am running on this signal is parked on something only you can settle. '
  + 'What should I take as your answer?';

/**
 * Synthetic id for a derived block, so payloads and logs can name it. It is
 * deliberately not a uuid and deliberately not a message id: nothing may look
 * it up, and a reader that tries will fail loudly rather than silently read
 * the wrong message.
 */
export function derivedQuestionMessageId(intentId: string): string {
  return `derived-question-message.${intentId}`;
}

function labelFor(question: QuestionBlockQuestion): string {
  const label = question.dimension?.trim() || question.prompt.trim();
  return label.length > MAX_QUESTION_LABEL_CHARS
    ? `${label.slice(0, MAX_QUESTION_LABEL_CHARS).trimEnd()}…`
    : label;
}

/**
 * Every question of the block, numbered as delivered — not only the ones whose
 * negotiations are still parked. The numbers must line up with what the client
 * is looking at, and a question whose parks resolved simply consumes to
 * nothing.
 */
function enumerateQuestions(block: QuestionBlock): OpenQuestionForIntent[] {
  return block.questions.map((question, index) => ({
    position: index + 1,
    label: labelFor(question),
    opportunityId: question.opportunityId,
  }));
}

/**
 * The delivered rendering of the open ask: the newest AGENT message carrying a
 * block that references a still-parked negotiation — searching BACK through
 * the conversation, not just at its tail.
 *
 * Searching back is the fix. The newest agent message is a rendering detail:
 * an edit-confirmation, a status line, or any other thing the negotiator says
 * after asking pushes the question up the transcript without settling it.
 */
function deliveredQuestionMessage(
  messages: Array<{ id: string; role: string; content: string }>,
  parked: ReadonlyArray<{ opportunityId: string }>,
): { id: string; content: string; block: QuestionBlock } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    const open = openQuestionBlock({ id: message.id, content: message.content }, parked);
    if (open) return { id: message.id, content: message.content, block: open.block };
  }
  return null;
}

function clampPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > MAX_PROMPT_CHARS ? trimmed.slice(0, MAX_PROMPT_CHARS).trimEnd() : trimmed;
}

/**
 * The block a parked set makes on its own, when no delivered message renders
 * it: one question per park, from the same material the message author would
 * have used — the agent's park-time question, else one derived from the
 * checklist dimension (`dimension-question.ts`), else the fixed prompt above.
 *
 * Null only when the block schema refuses the result, which would mean a park
 * carrying something no message could have carried either. Openness is still
 * real in that case; it is the recovery that failed, and the caller logs it.
 */
function deriveQuestionBlock(parked: ReadonlyArray<ParkedNegotiation>): QuestionBlock | null {
  const questions = parked.slice(0, MAX_BLOCK_QUESTIONS).map((negotiation) => {
    const question = renderableQuestion(negotiation);
    const dimension = negotiation.dimension?.trim();
    const options = question?.options ?? [];
    return {
      prompt: clampPrompt(question?.prompt || UNRENDERABLE_PARK_PROMPT) || UNRENDERABLE_PARK_PROMPT,
      opportunityId: negotiation.opportunityId,
      // Presentation only; routing is the ref. A dimension the block schema
      // would reject is dropped rather than allowed to fail the whole block.
      ...(dimension && dimension.length <= MAX_DIMENSION_CHARS ? { dimension } : {}),
      // The block's options floor is two: a park-time question that carried
      // one renders as a prompt with a reply arrow, exactly as it does today.
      ...(options.length >= 2 ? { options: options.slice(0, 4) } : {}),
    };
  });
  const block = QuestionBlockSchema.safeParse({ version: 1, questions });
  return block.success ? block.data : null;
}

/** Injectable seams for {@link readOpenQuestionsForIntent}. */
export interface OpenQuestionsForIntentDeps {
  findSession?: (userId: string, intentId: string) => Promise<{ id: string } | null>;
  getSessionMessages?: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string }>>;
  readParkedNegotiations?: (userId: string, intentId: string) => Promise<ReadonlyArray<ParkedNegotiation>>;
}

/**
 * What this signal currently has open, for every lane that has to answer it:
 * the precedence gate, the `answer_pending_question` host, and the
 * orchestrator's context enumeration.
 *
 * Parked first, deliberately: the parked read is the authority AND the cheap
 * short-circuit — an indexed scoped query that rules out every ordinary
 * conversation before a message is read. Null means nothing is parked on this
 * user's side for this signal, which is the only thing that closes a question.
 *
 * Never throws: this feeds a prompt section, a tool registration and a chat
 * turn, and none of them is worth failing over. A DM that cannot be read is
 * degraded to the derived block rather than to "nothing open" — the park is
 * the record, and losing the client's answer is the worse failure.
 */
export async function readOpenQuestionsForIntent(
  userId: string,
  intentId: string,
  deps?: OpenQuestionsForIntentDeps,
): Promise<OpenQuestionsForIntent | null> {
  if (!userId || !intentId) return null;
  try {
    const readParkedNegotiations = deps?.readParkedNegotiations
      ?? (async (id: string, intent: string) => (await import('../../adapters/parked-negotiation.reader.adapter'))
        .parkedNegotiationReaderAdapter.readParkedNegotiations(id, intent));
    const parked = await readParkedNegotiations(userId, intentId);
    if (parked.length === 0) return null;

    const session = await (async () => {
      try {
        const findSession = deps?.findSession
          ?? (async (id: string, intent: string) => (await import('../../services/chat.service')).chatSessionService
            .findNegotiatorIntentSession(id, intent));
        const found = await findSession(userId, intentId);
        if (!found) return null;
        const getSessionMessages = deps?.getSessionMessages
          ?? (async (sessionId: string) => (await import('../../services/chat.service')).chatSessionService
            .getSessionMessages(sessionId));
        return { id: found.id, messages: await getSessionMessages(found.id) };
      } catch (err) {
        // The park stands whether or not its rendering can be read.
        logger.warn('open_questions_dm_read_failed; falling back to the parked set', {
          userId,
          intentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })();

    const delivered = session ? deliveredQuestionMessage(session.messages, parked) : null;
    if (delivered) {
      return {
        sessionId: session!.id,
        messageId: delivered.id,
        body: delivered.content,
        block: delivered.block,
        source: 'delivered',
        questions: enumerateQuestions(delivered.block),
      };
    }

    const derived = deriveQuestionBlock(parked);
    if (!derived) {
      logger.warn('open_questions_parked_but_unrenderable', { userId, intentId, parked: parked.length });
      return null;
    }
    return {
      sessionId: session?.id ?? null,
      messageId: derivedQuestionMessageId(intentId),
      body: serializeQuestionMessage(DERIVED_QUESTION_MESSAGE_PROSE, derived),
      block: derived,
      source: 'derived',
      questions: enumerateQuestions(derived),
    };
  } catch (err) {
    logger.warn('open_questions_for_intent_read_failed', {
      userId,
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
