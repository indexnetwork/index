/**
 * Host bridge for the negotiator persona's `reject_opportunity` and
 * `accept_opportunity` tools.
 *
 * The owner has exactly three kinds of decision in their signal's DM: they can
 * ANSWER a question the negotiation asked, they can EDIT the signal, and they
 * can pass a VERDICT on a counterparty. The first two had lanes —
 * `answer_pending_question` (#1466) and `update_intent`. The third had none.
 * On 2026-08-20, in the DM for a parked pairing, the client told their agent to
 * reject the counterparty and the agent could not comply: the only verdict
 * levers in the product were the Radar card's Skip/Start-Chat and the REST
 * endpoints behind them, both out of the chat agent's reach. `update_opportunity`
 * is in the toolset but cannot serve — its admission blocks `negotiating`
 * outright, and the IND-593 owner-approval boundary fails closed on the chat
 * surface by design.
 *
 * Positions, never ids. The prompt lists this signal's actionable
 * counterparties, numbered; the tool takes the number; the host owns the
 * mapping onto the opportunity. A ref the model could name is a ref it could
 * get wrong, and here a wrong ref rejects the wrong person — the one failure
 * this seam exists to make impossible.
 *
 * Everything behind the seam — enumerating the scope's actionable pairings,
 * resolving the number, and executing the SAME owner accept/reject the Radar's
 * card executes — lives on the host. The protocol package only ever sees this
 * surface, and only the negotiator persona's toolset receives it.
 */

/**
 * What the host did with one verdict.
 *
 * - `executed`: the verdict is recorded. `counterparty` is who it landed on,
 *   so the model's confirmation to the client names a person the host actually
 *   acted on rather than the one the model believed it had picked.
 * - `none_actionable`: this signal has no counterparty left to decide on —
 *   they concluded, expired, or were never here.
 * - `unknown_counterparty`: the number does not name one. `actionable` carries
 *   the current list so the model can re-read it rather than guess again, and
 *   `count` is how many there are.
 * - `already_decided`: the client (or their agent) already acted on this
 *   pairing; for an accept that means the other side must move next.
 * - `error`: the host could not execute it. The client must be told honestly.
 */
export type NegotiatorVerdictResult =
  | { status: "executed"; counterparty: string }
  | { status: "none_actionable" }
  | { status: "unknown_counterparty"; count: number; actionable: string[] }
  | { status: "already_decided"; counterparty: string }
  | { status: "error" };

/** One verdict the client passed, as the tools hand it to the host. */
export interface NegotiatorVerdictInput {
  /** The pinned signal whose counterparties are in scope. */
  intentId: string;
  /** 1-based position, exactly as the prompt listed it. */
  counterparty: number;
  /**
   * The client's own words for why, when they gave one. For the record only —
   * never invented, never inferred, and never required.
   */
  reason?: string;
}

export interface NegotiatorVerdictToolsHost {
  /**
   * Decline one counterparty of this signal on the client's instruction: the
   * same owner-reject the Radar card's Skip performs, including whatever the
   * pairing's live negotiation and open question do in its wake.
   *
   * @param userId - The acting client; the host scopes every read and write to them.
   */
  rejectOpportunity(userId: string, input: NegotiatorVerdictInput): Promise<NegotiatorVerdictResult>;

  /**
   * Accept one counterparty of this signal on the client's instruction: the
   * same owner-accept the Radar card performs. Two-party semantics are
   * unchanged — the client's accept is one side's, and the connection is made
   * only when the other side accepts too.
   */
  acceptOpportunity(userId: string, input: NegotiatorVerdictInput): Promise<NegotiatorVerdictResult>;
}
