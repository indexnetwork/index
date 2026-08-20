/**
 * The open question-message, per signal (conversational questions,
 * docs/plans/2026-08-18-conversational-questions.md).
 *
 * A question-message is OPEN while its block still references at least one
 * negotiation parked on this user's side: that is what makes it answerable,
 * and it is derived at read time from the parked set — there is no stored
 * read/unread or open/closed state anywhere in this design.
 *
 * Two surfaces need that predicate over the same parked set:
 *
 * - the regeneration job's edit rule, which anchors on the newest message in
 *   the conversation (a client reply since means the message is no longer the
 *   one to rewrite), and
 * - the notification snapshot, which anchors on the newest AGENT message (a
 *   reply does not un-ask the question; only consumption and the regeneration
 *   that follows it do).
 *
 * The anchor differs, the openness test does not — so the test lives here
 * once and each caller hands it the message it anchors on.
 */
import { parseQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionBlock, QuestionBlockQuestion } from '@indexnetwork/protocol';

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

/** One question of a signal's open question-message, as the client sees it. */
export interface OpenQuestionForIntent {
  /** 1-based position in the block — the number the orchestrator is shown. */
  position: number;
  /** The step's label: its checklist dimension, else a short form of the prompt. */
  label: string;
  /** The negotiation this question unparks; the answer's routing identity. */
  opportunityId: string;
}

/** A signal's open question-message, resolved for one intent scope. */
export interface OpenQuestionsForIntent {
  sessionId: string;
  messageId: string;
  /** The message body as delivered — the block an answer is consumed against. */
  body: string;
  questions: OpenQuestionForIntent[];
}

/** Label cap for a question shown in the orchestrator's context. */
const MAX_QUESTION_LABEL_CHARS = 80;

function labelFor(question: QuestionBlockQuestion): string {
  const label = question.dimension?.trim() || question.prompt.trim();
  return label.length > MAX_QUESTION_LABEL_CHARS
    ? `${label.slice(0, MAX_QUESTION_LABEL_CHARS).trimEnd()}…`
    : label;
}

/** Injectable seams for {@link readOpenQuestionsForIntent}. */
export interface OpenQuestionsForIntentDeps {
  findSession?: (userId: string, intentId: string) => Promise<{ id: string } | null>;
  getSessionMessages?: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string }>>;
  readParkedNegotiations?: (userId: string, intentId: string) => Promise<ReadonlyArray<{ opportunityId: string }>>;
}

/**
 * One signal's open question-message, resolved for the orchestrator's context
 * and for the `answer_pending_question` tool behind it (#1466).
 *
 * Anchored on the newest AGENT message, like the notification snapshot rather
 * than the edit rule: the client having replied since does not un-ask the
 * question, and this is read on a turn where they just did reply.
 *
 * Resolves null whenever there is nothing open — no DM, no block, or every
 * negotiation the block references has since resolved. Never throws: this
 * feeds a prompt section and a tool registration, and neither is worth failing
 * a chat turn over.
 */
export async function readOpenQuestionsForIntent(
  userId: string,
  intentId: string,
  deps?: OpenQuestionsForIntentDeps,
): Promise<OpenQuestionsForIntent | null> {
  if (!userId || !intentId) return null;
  try {
    const findSession = deps?.findSession
      ?? (async (id: string, intent: string) => (await import('../../services/chat.service')).chatSessionService
        .findNegotiatorIntentSession(id, intent));
    const session = await findSession(userId, intentId);
    if (!session) return null;

    const getSessionMessages = deps?.getSessionMessages
      ?? (async (sessionId: string) => (await import('../../services/chat.service')).chatSessionService
        .getSessionMessages(sessionId));
    const messages = await getSessionMessages(session.id);
    const newestAgentMessage = [...messages].reverse().find((message) => message.role === 'assistant');
    // Cheap first: no block, no parked-set read.
    if (!newestAgentMessage || !parseQuestionMessage(newestAgentMessage.content)) return null;

    const readParkedNegotiations = deps?.readParkedNegotiations
      ?? (async (id: string, intent: string) => (await import('../../adapters/parked-negotiation.reader.adapter'))
        .parkedNegotiationReaderAdapter.readParkedNegotiations(id, intent));
    const parked = await readParkedNegotiations(userId, intentId);
    const open = openQuestionBlock({ id: newestAgentMessage.id, content: newestAgentMessage.content }, parked);
    if (!open) return null;

    // Every question of the open block is listed, not only the still-parked
    // ones: the numbers must line up with what the client is looking at, and a
    // question whose parks resolved simply consumes to nothing.
    return {
      sessionId: session.id,
      messageId: open.id,
      body: newestAgentMessage.content,
      questions: open.block.questions.map((question, index) => ({
        position: index + 1,
        label: labelFor(question),
        opportunityId: question.opportunityId,
      })),
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
