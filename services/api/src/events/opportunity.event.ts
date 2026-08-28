export interface PendingOpportunityEvent {
  id: string;
  status: string;
}

export interface OpportunityPendingPayload {
  opportunity: PendingOpportunityEvent;
}

export type OpportunityActionablePayload = OpportunityPendingPayload;

export type OpportunityTransitionPayload = OpportunityPendingPayload;

/**
 * Hooks called after actionable opportunity writes have committed. The adapter
 * invokes them best-effort so downstream work can never fail or roll back the
 * lifecycle write.
 *
 * `onTransition` fires for every status UPDATE (never for creations),
 * whatever the status — the exhaustion evaluator's trigger. It is
 * edge-triggered on writes, not on changes: a redundant write to the same
 * status re-fires, so subscribers must be idempotent.
 */
export const OpportunityEvents: {
  onPending: (payload: OpportunityPendingPayload) => void | Promise<void>;
  onActionable: (payload: OpportunityActionablePayload) => void | Promise<void>;
  onTransition: (payload: OpportunityTransitionPayload) => void | Promise<void>;
} = {
  onPending: async (_payload: OpportunityPendingPayload): Promise<void> => {},
  onActionable: async (_payload: OpportunityActionablePayload): Promise<void> => {},
  onTransition: async (_payload: OpportunityTransitionPayload): Promise<void> => {},
};

/** Fire actionable lifecycle hooks without exposing handler failures to database writes. */
export function emitOpportunityLifecycleBestEffort(opportunity: PendingOpportunityEvent): void {
  if (opportunity.status !== 'pending') return;
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

/**
 * Fire the status-transition hook without exposing handler failures to
 * database writes. Called from every opportunity status UPDATE path —
 * single-row updates, the atomic negotiation writers, and the bulk terminal
 * writers — and deliberately NOT from creation paths: a fresh row is not a
 * negotiation transition.
 */
export function emitOpportunityTransitionBestEffort(opportunity: PendingOpportunityEvent): void {
  try {
    Promise.resolve(OpportunityEvents.onTransition({ opportunity })).catch(() => {});
  } catch {
    // A synchronous handler failure is deliberately fail-open.
  }
}

/** @deprecated Use {@link emitOpportunityLifecycleBestEffort} for lifecycle writes. */
export function emitOpportunityPendingBestEffort(opportunity: PendingOpportunityEvent): void {
  if (opportunity.status !== 'pending') return;
  try {
    Promise.resolve(OpportunityEvents.onPending({ opportunity })).catch(() => {});
  } catch {
    // Preserve the legacy helper's pending-only, fail-open contract.
  }
}
