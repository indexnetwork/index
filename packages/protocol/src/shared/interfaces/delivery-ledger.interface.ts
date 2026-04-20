/**
 * Delivery ledger interface for committing opportunity delivery rows.
 * Implementations live in src/adapters (e.g. database adapter).
 */

export interface DeliveryLedger {
  /**
   * Write a committed delivery row for an opportunity.
   * Returns 'confirmed' on first delivery, 'already_delivered' if previously committed.
   */
  confirmOpportunityDelivery(params: {
    opportunityId: string;
    userId: string;
    agentId: string | null;
  }): Promise<'confirmed' | 'already_delivered'>;
}
