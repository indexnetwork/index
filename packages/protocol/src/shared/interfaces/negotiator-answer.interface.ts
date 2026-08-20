/**
 * Host bridge for the negotiator persona's `answer_pending_question` tool.
 *
 * The deterministic path is the one that matters: while a signal's DM has an
 * open question, a free-text reply is offered to the answer evaluator BEFORE
 * this persona runs at all, and an accepted answer never reaches it. This tool
 * is the LONG TAIL of that arrow — the client answers obliquely, or three
 * turns later, or mixes an answer into a message that is also asking for
 * something else. In those cases the evaluator declines and the conversation
 * lands here, where routing an answer must be an explicit act rather than a
 * side effect of editing the client's signal.
 *
 * Everything behind the seam — resolving the DM, re-checking that the question
 * is still open, mapping the number the model was shown onto the negotiation
 * ref, and enqueueing consumption on the serialized question-message queue —
 * lives on the host. The protocol package only ever sees this surface, and
 * only the negotiator persona's toolset receives it.
 */

/**
 * What the host did with one routing attempt.
 *
 * - `routed`: the answer is on its way to the negotiation it unparks.
 * - `no_open_question`: nothing is open in this scope any more — the parks
 *   resolved, or another answer already settled them.
 * - `unknown_question`: the number does not name a question that is open.
 *   `open` is how many there are, so the model can re-read its own context
 *   rather than guess again.
 * - `error`: the host could not route it. The client must be told honestly.
 */
export type NegotiatorAnswerRoutingResult =
  | { status: "routed"; label: string }
  | { status: "no_open_question" }
  | { status: "unknown_question"; open: number }
  | { status: "error" };

export interface NegotiatorAnswerToolsHost {
  /**
   * Route what the client just said to one open question of this signal's DM.
   *
   * @param userId - The acting client; the host scopes every read to them.
   * @param input.intentId - The pinned signal whose DM holds the question.
   * @param input.question - 1-based position, exactly as the prompt listed it.
   * @param input.answer - What the client said, in their own words.
   */
  answerOpenQuestion(
    userId: string,
    input: { intentId: string; question: number; answer: string },
  ): Promise<NegotiatorAnswerRoutingResult>;
}
