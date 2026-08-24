/**
 * Delivery ledger interface for committing opportunity delivery rows.
 * Implementations live in src/adapters (e.g. database adapter).
 */

/** A committed delivery-ledger row, as read back for digest dedup. */
export interface DeliveredOpportunityRow {
  opportunityId: string;
  /** Opportunity status at the time the delivery was committed. */
  deliveredAtStatus: string;
  deliveredAt: Date;
}

export interface DeliveryLedger {
  /**
   * Write a committed delivery row for an opportunity.
   * Returns 'confirmed' on first delivery, 'already_delivered' if previously committed.
   *
   * @param trigger - Which dispatch path produced this delivery: 'ambient' for
   *                  real-time critical alerts (≤3/day target), 'digest' for the
   *                  daily sweep of everything ambient passed on, 'accepted' for
   *                  accepted-opportunity notifications to the counterparty.
   */
  confirmOpportunityDelivery(params: {
    opportunityId: string;
    userId: string;
    agentId: string | null;
    trigger: 'ambient' | 'digest' | 'accepted';
  }): Promise<'confirmed' | 'already_delivered'>;

  /**
   * Read committed delivery rows for the given opportunities delivered to the user.
   * Used by digest mode of `list_opportunities` to suppress opportunities the user
   * has already been shown across days, and to select cooldown re-show candidates.
   *
   * Optional: hosts that predate digest dedup may not implement it; callers must
   * degrade gracefully (no suppression) when absent.
   */
  getDeliveredOpportunities?(params: {
    userId: string;
    opportunityIds: string[];
  }): Promise<DeliveredOpportunityRow[]>;
}
