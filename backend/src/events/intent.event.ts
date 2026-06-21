/**
 * Hooks called on intent lifecycle events.
 * Set by main.ts to trigger cascade cleanup and maintenance via queues/brokers.
 */
export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
