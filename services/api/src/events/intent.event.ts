import { log } from '../lib/log';
import { publishUserEvent } from '../lib/user-events';

/**
 * Publish a committed creation/broadcast; delivery failures never undo the mutation.
 * @param userId - Owner whose hosted agent may activate.
 * @param intentId - Committed intent.
 * @param activation - Stable identity of the creation or network assignment.
 * @returns After best-effort publication, without waiting for model work.
 */
export async function publishIntentActivation(userId: string, intentId: string, activation:
  { id: string; type: 'intent.created' } | { id: string; type: 'intent.broadcast'; networkId: string },
): Promise<void> {
  const logger = log.lib.from('agent-events');
  logger.info(activation.type, { userId, intentId, ...activation });
  try {
    await publishUserEvent(userId, { ...activation, title: '', body: '', data: { intentId, ...('networkId' in activation ? { networkId: activation.networkId } : {}) } });
  } catch (error) {
    logger.error('Intent activation delivery failed; no automatic replay', { userId, intentId, eventId: activation.id, error: String(error) });
  }
}

/** Hooks for committed intent lifecycle changes. */
export interface IntentMaterialUpdateEvent {
  intentId: string;
  userId: string;
  oldFingerprint: string;
  newFingerprint: string;
}

/** Structured intent observations; the hosted service also activates H2A on committed resume frames. */
export const IntentEvents = {
  onCreated: (intentId: string, userId: string): Promise<void> => publishIntentActivation(userId, intentId, { type: 'intent.created', id: `intent.created:${intentId}` }),
  onMaterialUpdated: async (event: IntentMaterialUpdateEvent): Promise<void> => {
    log.lib.from('agent-events').info('intent.updated', { ...event, change: 'content' });
  },
  onStatusChanged: (event: { intentId: string; userId: string; status: 'ACTIVE' | 'PAUSED'; lifecycleVersionMs: number }): void => {
    log.lib.from('agent-events').info('intent.updated', { ...event, change: 'status' });
  },
  onArchived: (event: { intentId: string; userId: string; lifecycleVersionMs: number }): void => {
    log.lib.from('agent-events').info('intent.archived', event);
  },
};
