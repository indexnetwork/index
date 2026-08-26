/**
 * Hooks called on intent lifecycle events.
 * Set by main.ts to trigger maintenance.
 */
export interface IntentMaterialUpdateEvent {
  intentId: string;
  userId: string;
  oldFingerprint: string;
  newFingerprint: string;
}

/**
 * Creation-event side effects deliberately exclude discovery. IntentIndexing owns
 * the only create-time discovery start after network assignment and HyDE.
 */
export function handleIntentCreatedMaintenance(
  _intentId: string,
  userId: string,
  triggerMaintenance: (userId: string, reason: string) => void,
): void {
  triggerMaintenance(userId, 'intent-created');
}

export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onMaterialUpdated: async (_event: IntentMaterialUpdateEvent): Promise<void> => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
