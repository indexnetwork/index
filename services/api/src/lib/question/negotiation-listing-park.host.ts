/**
 * Host bridge behind the park annotations `list_negotiations` renders (#1472).
 *
 * The listing was the last surface still answering "what is happening on this
 * pairing?" from a source of its own. It renders lifecycle from OPPORTUNITY
 * STATUS, and a pairing whose negotiation is parked on the client legitimately
 * reads `negotiating` there. On 2026-08-20, in the DM of a signal whose
 * negotiation had sat `input_required` on the client's side for two hours with
 * the open question "Timing: This week", every #1470 surface was correct — the
 * precedence gate found the question, the prompt's open-questions section
 * named it — and then the model called `list_negotiations`, read "still
 * negotiating", and told her there were no open questions and nothing for her
 * to decide. Both clauses false at the task level; both faithful to what the
 * tool rendered. A model holding a static context line and a just-executed
 * tool result will take the tool, every time.
 *
 * So this exists, and it re-implements nothing: it resolves the signal's open
 * questions through the SAME call the precedence gate, the prompt section and
 * `answer_pending_question` make (`readOpenQuestionsForIntent`) and hands the
 * listing back the enumeration it already produced. The number the listing
 * prints IS the number the answer routes against, because there is one call
 * and one enumeration — not the same rule written twice. That is the #1470
 * rule, extended to its last holdout.
 *
 * The parked-ness itself is NOT resolved here. The listing already holds the
 * task and the negotiation's messages and classifies whose side a park is on
 * through the canonical protocol predicate; what only the question record can
 * supply is the question's number and label, and that is all this returns.
 */
import { readOpenQuestionsForIntent } from './open-question-message';
import type { OpenQuestionsForIntentDeps } from './open-question-message';
import { log } from '../log';

const logger = log.lib.from('negotiation-listing-park.host');

/** Mirrors the protocol's `ListingOpenQuestion`; structural by design. */
export interface ListingOpenQuestion {
  opportunityId: string;
  question: number;
  label: string;
}

/**
 * Every question currently open on this user's side for one signal, expanded
 * to every negotiation each one unparks.
 *
 * `alsoUnblocks` refs are annotated with their question's number too: one
 * answer resumes them all, and the block guarantees a ref appears exactly once
 * across the whole block, so the mapping is unambiguous. A pairing unparked
 * through an `alsoUnblocks` ref would otherwise render as parked-with-no-number
 * while its sibling rendered the number — the same divergence, one level down.
 *
 * Never throws: this feeds a tool result, and the reader below it already
 * swallows its own failures. `[]` means nothing is parked on this user's side
 * for this signal — the only state in which the listing may stay silent.
 */
export async function readListingOpenQuestions(
  userId: string,
  intentId: string,
  deps?: OpenQuestionsForIntentDeps,
): Promise<ListingOpenQuestion[]> {
  try {
    const open = await readOpenQuestionsForIntent(userId, intentId, deps);
    if (!open) return [];
    return open.questions.flatMap((question) => {
      // Same index by construction: `enumerateQuestions` maps the block's
      // questions 1:1, in order, into `questions`.
      const alsoUnblocks = open.block.questions[question.position - 1]?.alsoUnblocks ?? [];
      return [question.opportunityId, ...alsoUnblocks].map((opportunityId) => ({
        opportunityId,
        question: question.position,
        label: question.label,
      }));
    });
  } catch (err) {
    logger.warn('listing_open_questions_read_failed', {
      userId,
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** The host object the composition root injects into the negotiation toolset. */
export const negotiationListingParkHost = {
  readOpenQuestions: (userId: string, intentId: string) => readListingOpenQuestions(userId, intentId),
};
