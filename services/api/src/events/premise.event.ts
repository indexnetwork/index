/**
 * Hooks called on premise lifecycle events.
 * Set by main.ts to trigger re-analysis, discovery updates, and expiry cleanup via queues.
 */
export const PremiseEvents = {
  onCreated: (_premiseId: string, _userId: string): void => {},
  onUpdated: (_premiseId: string, _userId: string): void => {},
  onRetracted: (_premiseId: string, _userId: string): void => {},
  onExpired: (_premiseId: string, _userId: string): void => {},
};
