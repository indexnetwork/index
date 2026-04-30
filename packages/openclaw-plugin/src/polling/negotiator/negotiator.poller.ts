import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';

import { turnPrompt } from './negotiation-turn.prompt.js';

export type NegotiatorPollResult = 'handled' | 'idle' | 'network_error';

export interface NegotiatorConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/** Tracks in-flight turns so we don't re-launch subagents for already-claimed work. */
const inflight = new Set<string>();

/**
 * Handles one negotiation pickup cycle.
 *
 * @param api - OpenClaw plugin API.
 * @param config - Negotiator configuration (baseUrl, agentId, apiKey).
 * @returns `'handled'` if a turn was dispatched, `'idle'` if nothing was pending,
 *   or `'network_error'` if the request failed.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: NegotiatorConfig,
): Promise<NegotiatorPollResult> {
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/negotiations/pickup`;

  const res = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
  });

  if (res.status === 204) {
    return 'idle';
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    api.logger.warn(`Pickup request failed: ${res.status} ${body}`);
    return 'network_error';
  }

  const turn = (await res.json()) as {
    negotiationId: string;
    taskId: string;
    opportunity: { id: string; reasoning: string } | null;
    turn: {
      number: number;
      deadline: string;
      history: Array<{ turnNumber: number; agent: string; action: string; message?: string | null }>;
      counterpartyAction: string;
    };
    context: import('./negotiation-turn.prompt.js').TurnContext | null;
  };

  const inflightKey = `${turn.taskId}:${turn.turn.number}`;
  if (inflight.has(inflightKey)) {
    api.logger.debug(`Turn ${inflightKey} already in-flight, skipping.`);
    return 'idle';
  }
  inflight.add(inflightKey);

  api.logger.info(`Negotiation turn picked up: ${turn.taskId} turn ${turn.turn.number}`);

  const lastEntry = turn.turn.history.length > 0
    ? turn.turn.history[turn.turn.history.length - 1]
    : null;

  const model = await readModel(api);

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:negotiation:${turn.negotiationId}`,
      idempotencyKey: `index:turn:${turn.taskId}:${turn.turn.number}`,
      message: turnPrompt({
        negotiationId: turn.taskId,
        turnNumber: turn.turn.number,
        counterpartyAction: turn.turn.counterpartyAction,
        counterpartyMessage: lastEntry?.message ?? null,
        deadline: turn.turn.deadline,
        context: turn.context,
      }),
      deliver: false,
      model,
    });
    api.logger.info(`Subagent launched for negotiation ${turn.taskId}`);
  } catch (err) {
    inflight.delete(inflightKey);
    throw err;
  }

  return 'handled';
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  inflight.clear();
}
