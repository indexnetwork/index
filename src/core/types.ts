export interface NegotiationParty {
  name: string;
  objective: string;
}

export type MessageRole = "incoming" | "outgoing";

/** The substance of an offer, as structured data rather than prose — e.g.
 * `{ hoursPerWeek: 4, weeks: 6, startDate: "2026-09-08" }`. Keeping terms
 * out of the message text is what lets two agents verify they agreed to the
 * same thing instead of both claiming "accept" over different numbers. */
export type NegotiationTerms = Record<string, unknown>;

export interface NegotiationMessage {
  role: MessageRole;
  content: string;
  /** Structured terms this message put on the table, if any. */
  terms?: NegotiationTerms;
  /** Identifies the offer this message made, so a later decision can name
   * exactly which offer it accepts. */
  offerId?: string;
}

export interface NegotiationState {
  party: NegotiationParty;
  history: NegotiationMessage[];
}

export interface NegotiationDecision<A extends string = string> {
  action: A;
  message: string;
  /** Structured terms this decision puts on the table. Set by `decide()`
   * when `DecideOptions.terms` describes what to emit. */
  terms?: NegotiationTerms;
  /** Identifies this decision's own offer. Assigned automatically whenever
   * a decision carries `terms`, so the counterparty has something stable to
   * reference when accepting. */
  offerId?: string;
  /** For an accepting action: the `offerId` this binds to. Without it,
   * "accept" names no particular offer — which is how both sides can end up
   * believing they agreed to different things. */
  acceptsOfferId?: string;
}
