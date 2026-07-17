/**
 * Build the unique BullMQ job id for one resumed lifecycle version.
 * Repeated retries of the same version deduplicate, while a later pause/resume
 * cycle receives the new transition timestamp.
 *
 * @param userId - Intent owner.
 * @param intentId - Resumed intent.
 * @param lifecycleVersionMs - Stable transition timestamp from the adapter.
 * @returns The resume discovery job id.
 */
export function intentResumeDiscoveryJobId(
  userId: string,
  intentId: string,
  lifecycleVersionMs: number,
): string {
  return `intent-resume-${userId}-${intentId}-${lifecycleVersionMs}`;
}

/**
 * Hooks called on intent lifecycle events.
 * Set by main.ts to trigger maintenance and queued work.
 */
export interface IntentMaterialUpdateEvent {
  intentId: string;
  userId: string;
  oldFingerprint: string;
  newFingerprint: string;
}

export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onPaused: (_intentId: string, _userId: string, _lifecycleVersionMs: number): void => {},
  onResumed: async (_intentId: string, _userId: string, _lifecycleVersionMs: number): Promise<void> => {},
  onMaterialUpdated: async (_event: IntentMaterialUpdateEvent): Promise<void> => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
