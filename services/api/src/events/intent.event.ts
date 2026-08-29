/**
 * Hooks called on intent lifecycle events. Set by main.ts.
 */
export interface IntentMaterialUpdateEvent {
  intentId: string;
  userId: string;
  oldFingerprint: string;
  newFingerprint: string;
}

export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onMaterialUpdated: async (_event: IntentMaterialUpdateEvent): Promise<void> => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
