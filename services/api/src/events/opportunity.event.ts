export interface PendingOpportunityEvent {
  id: string;
  status: string;
}

export interface OpportunityPendingPayload {
  opportunity: PendingOpportunityEvent;
}

export type OpportunityActionablePayload = OpportunityPendingPayload;

/**
 * Hooks called after actionable opportunity writes have committed. The adapter
 * invokes them best-effort so downstream work can never fail or roll back the
 * lifecycle write.
 */
export const OpportunityEvents: {
  onPending: (payload: OpportunityPendingPayload) => void | Promise<void>;
  onActionable: (payload: OpportunityActionablePayload) => void | Promise<void>;
} = {
  onPending: async (_payload: OpportunityPendingPayload): Promise<void> => {},
  onActionable: async (_payload: OpportunityActionablePayload): Promise<void> => {},
};

/** Fire actionable lifecycle hooks without exposing handler failures to database writes. */
export function emitOpportunityLifecycleBestEffort(opportunity: PendingOpportunityEvent): void {
  if (opportunity.status !== 'latent' && opportunity.status !== 'pending') return;
  try {
    Promise.resolve(OpportunityEvents.onActionable({ opportunity })).catch(() => {});
  } catch {
    // A synchronous handler failure is deliberately fail-open.
  }
  if (opportunity.status !== 'pending') return;
  try {
    Promise.resolve(OpportunityEvents.onPending({ opportunity })).catch(() => {});
  } catch {
    // A synchronous handler failure is deliberately fail-open.
  }
}

/** @deprecated Use {@link emitOpportunityLifecycleBestEffort}. */
export const emitOpportunityPendingBestEffort = emitOpportunityLifecycleBestEffort;
