import { log } from '../log';

const logger = log.service.from('NegotiationPollingService');

export const NEGOTIATION_PICKUP_CONFLICT_REASON = 'runtime_conflict' as const;

/** Emit only the stable conflict reason; negotiation authority identifiers stay out of logs. */
export function logNegotiationPickupConflict(): void {
  logger.info('Lost race to claim negotiation task', {
    reason: NEGOTIATION_PICKUP_CONFLICT_REASON,
  });
}
