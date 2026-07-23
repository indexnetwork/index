import { isQuestionerEnabled } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { questionerQueue } from '../questioner.queue';
import type { RecoveryQuestionerJobData } from '../questioner.queue';

const logger = log.job.from('IntentRecoveryCompletion');

export interface RecoveryCompletionDeps {
  enabled?: () => boolean;
  enqueue?: (data: RecoveryQuestionerJobData) => Promise<unknown>;
}

/**
 * Failure-isolated completion hook shared by both authoritative discovery paths.
 * It carries only exact recipient/intent provenance and optional run identity.
 */
export async function maybeEnqueueIntentRecovery(
  completion: RecoveryQuestionerJobData,
  deps?: RecoveryCompletionDeps,
): Promise<boolean> {
  const enabled = deps?.enabled ?? isQuestionerEnabled;
  if (!enabled()) return false;
  const enqueue = deps?.enqueue ?? ((data) => questionerQueue.addRecoveryJob(data));
  try {
    await enqueue(completion);
    return true;
  } catch (error) {
    const candidate = typeof error === 'object' && error !== null
      ? error as { name?: unknown; code?: unknown }
      : null;
    logger.warn('Failed to enqueue recovery refinement after successful discovery', {
      source: completion.source,
      intentId: completion.intentId,
      userId: completion.recipientUserId,
      errorClass: typeof candidate?.name === 'string' ? candidate.name.slice(0, 64) : 'UnknownError',
      errorCode: typeof candidate?.code === 'string' || typeof candidate?.code === 'number'
        ? String(candidate.code).slice(0, 64)
        : 'UNCLASSIFIED',
    });
    return false;
  }
}
