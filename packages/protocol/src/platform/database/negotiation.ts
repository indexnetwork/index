/**
 * The host's read of a negotiation record.
 *
 * Index is the server for every negotiation, so a graph never assembles a
 * transcript from messages — it asks the host for the turn log of one
 * opportunity's negotiation, already projected onto the reading seat.
 */

/** What one seat decided, and what it said about it. */
export interface NegotiationContextTurn {
  action: 'propose' | 'counter' | 'accept' | 'decline';
  message: string;
  /** True when the viewer's own seat authored this turn. */
  own: boolean;
}

/** How a negotiation ended, once it has. */
export type NegotiationContextOutcome = 'agreed' | 'declined' | 'closed';

/** One negotiation, from the reading seat's side. */
export interface NegotiationContextRecord {
  outcome: NegotiationContextOutcome | null;
  turns: NegotiationContextTurn[];
}

/** The one thing a host must do for negotiation-grounded presentation. */
export interface NegotiationContextDatabase {
  /**
   * The negotiation attached to an opportunity, as one seat sees it.
   *
   * @param opportunityId - The opportunity.
   * @param viewerUserId - The reading seat's owner.
   * @returns The record, or null when there is none or the viewer holds no seat.
   */
  readNegotiationContext(
    opportunityId: string,
    viewerUserId: string,
  ): Promise<NegotiationContextRecord | null>;
}
