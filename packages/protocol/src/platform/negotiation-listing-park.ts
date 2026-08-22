/**
 * Host bridge for the park annotations the negotiation LISTING renders (#1472).
 *
 * The listing was the last surface still answering "what is happening on this
 * pairing?" from a source of its own. It renders lifecycle from OPPORTUNITY
 * STATUS, and a pairing whose negotiation is parked on the client legitimately
 * reads `negotiating` there. On 2026-08-20 a client asked "do we have a
 * question?" while a negotiation had sat `input_required` on her side for two
 * hours: every #1470 surface was correct — the precedence gate found the
 * question and the prompt's open-questions section named it — and then the
 * model called `list_negotiations`, read "still negotiating", and told her
 * there were no open questions and nothing for her to decide.
 *
 * A model holding a static context line and a just-executed tool result will
 * take the tool. So the listing must say the park, out of the SAME record the
 * open-questions section is built from — `readOpenQuestionsForIntent` on the
 * host side. Not a second predicate, not a re-derivation from opportunity
 * status: the same call, so the number the listing prints and the number
 * `answer_pending_question` takes cannot drift apart.
 *
 * The host is optional. Without it the listing still says WHETHER a pairing is
 * parked and on whose side (classified from the task the listing already
 * holds); what it loses is the question's number and label, which only the
 * question record can supply.
 */

/** One open question of a signal, as the listing must name it. */
export interface ListingOpenQuestion {
  /**
   * The negotiation this question unparks. Includes refs a question carries
   * through `alsoUnblocks` — one answer resumes them all, so each of them is
   * annotated with that question's number.
   */
  opportunityId: string;
  /**
   * 1-based position in the signal's question block — the SAME number the
   * open-questions prompt section shows and `answer_pending_question` takes.
   */
  question: number;
  /** The step's label: its checklist dimension, else a short form of the prompt. */
  label: string;
}

export interface NegotiationListingParkHost {
  /**
   * Every question currently open on this user's side for one signal, resolved
   * through the question record itself.
   *
   * Must never throw and must never widen: an unreadable signal resolves to
   * `[]`, and a park on the counterparty's side is not this user's question to
   * read and must not appear here.
   *
   * @param userId - The acting client; the host scopes every read to them.
   * @param intentId - The signal whose parked negotiations are being listed.
   */
  readOpenQuestions(userId: string, intentId: string): Promise<ReadonlyArray<ListingOpenQuestion>>;
}
