/**
 * Research record for ON and shadow turns: a durable opportunity_events row
 * (joinable on opportunity id for the outcome export) plus an optional POST to
 * the lab's Village Data relay. Neither may ever lose a turn: failures log.
 */

import type { TurnExposureEvent } from '@indexnetwork/moralmod';

import db from '../drizzle/drizzle';
import { opportunityEvents } from '../../schemas/database.schema';
import { log } from '../log';

const logger = log.lib.from('moralmod');

export const EXPOSURE_EVENT_TYPE = 'moralmod.turn_exposure';

export interface ExposureSinkOptions {
  relayUrl: string | null;
  relayToken: string;
  fetch?: typeof fetch;
}

/** @param options - Relay target, when the lab provided one. @returns The hook's emit function. */
export function createExposureSink(options: ExposureSinkOptions): (event: TurnExposureEvent) => Promise<void> {
  const transport = options.fetch ?? fetch;
  return async (event: TurnExposureEvent) => {
    await db.insert(opportunityEvents).values({
      opportunityId: event.opportunityId,
      type: EXPOSURE_EVENT_TYPE,
      actorUserId: event.userId,
      data: event as unknown as Record<string, unknown>,
    });
    if (!options.relayUrl) return;
    try {
      const response = await transport(options.relayUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.relayToken ? { authorization: `Bearer ${options.relayToken}` } : {}) },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) logger.warn('MoralMod relay refused an exposure event', { status: response.status, opportunityId: event.opportunityId });
    } catch (error) {
      logger.warn('MoralMod relay unreachable', { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
