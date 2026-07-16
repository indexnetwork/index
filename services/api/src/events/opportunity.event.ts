export interface PendingOpportunityEvent {
  id: string;
  status: string;
}

export interface OpportunityPendingPayload {
  opportunity: PendingOpportunityEvent;
}

/**
 * Hook called after an opportunity write has committed with status `pending`.
 * The adapter invokes it best-effort so downstream generation can never fail
 * or roll back the lifecycle write.
 */
export const OpportunityEvents = {
  onPending: async (_payload: OpportunityPendingPayload): Promise<void> => {},
};

/** Fire the pending hook without exposing handler failures to database writes. */
export function emitOpportunityPendingBestEffort(opportunity: PendingOpportunityEvent): void {
  if (opportunity.status !== 'pending') return;
  try {
    Promise.resolve(OpportunityEvents.onPending({ opportunity })).catch(() => {});
  } catch {
    // A synchronous handler failure is also deliberately fail-open.
  }
}
