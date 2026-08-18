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
