/**
 * Negotiation context loader: given an opportunity, fetches the turn log of
 * the negotiation attached to it so the card presenter can explain *why* the
 * opportunity surfaced.
 *
 * An expired opportunity's negotiation no longer matters, so the loader
 * returns null for it without asking the host.
 */

import type { NegotiationContextDatabase, NegotiationContextOutcome, NegotiationContextTurn, OpportunityStatus } from '../../platform/database.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('NegotiationContextLoader');

/** Snapshot of a negotiation surfaced to the presenter. */
export interface NegotiationContext {
  status: OpportunityStatus;
  turnCount: number;
  turns: NegotiationContextTurn[];
  outcome?: NegotiationContextOutcome;
}

const STATUSES_WITH_NO_NEGOTIATION: ReadonlyArray<OpportunityStatus> = ['expired'];

/**
 * Loads the negotiation context for an opportunity.
 *
 * @param db - The host's negotiation read.
 * @param opportunityId - The opportunity being presented.
 * @param opportunityStatus - Its current status.
 * @param viewerId - Who the card is being presented to.
 * @returns The context, or null when no meaningful negotiation exists.
 */
export async function loadNegotiationContext(
  db: NegotiationContextDatabase,
  opportunityId: string,
  opportunityStatus: OpportunityStatus,
  viewerId: string,
): Promise<NegotiationContext | null> {
  if (STATUSES_WITH_NO_NEGOTIATION.includes(opportunityStatus)) {
    return null;
  }

  const record = await db.readNegotiationContext(opportunityId, viewerId);
  if (!record) {
    logger.verbose('No negotiation found for opportunity', { opportunityId, opportunityStatus });
    return null;
  }

  return {
    status: opportunityStatus,
    turnCount: record.turns.length,
    turns: record.turns,
    ...(record.outcome ? { outcome: record.outcome } : {}),
  };
}
