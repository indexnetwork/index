/**
 * Decides who plays a seat: this host's PersonalAgent, or an external agent
 * over A2A.
 *
 * A seat goes external only when its principal has an agent that is `external`,
 * active, flagged to handle negotiations, and carrying an active `a2a`
 * transport. Anything short of all four is a local seat — an agent registered
 * but not wired for negotiations is not an invitation to route a principal's
 * words through it.
 */
import { agentService } from '../../services/agent.service';
import { log } from '../log';

import type { A2ATransportConfig } from './a2a-turn-author';

const logger = log.job.from('A2ASeat');

/** Reads `{ url, token? }` off a transport config, or null when malformed. */
function transportConfig(config: Record<string, unknown>): A2ATransportConfig | null {
  const url = typeof config.url === 'string' ? config.url : undefined;
  if (!url) return null;
  const token = typeof config.token === 'string' ? config.token : undefined;
  return token ? { url, token } : { url };
}

/**
 * The external A2A transport playing this seat, if there is one.
 *
 * @param userId - The seat's principal.
 * @returns The transport to negotiate through, or null for a local seat.
 */
export async function resolveA2ASeat(userId: string): Promise<A2ATransportConfig | null> {
  let agents;
  try {
    agents = await agentService.listForUser(userId);
  } catch (error) {
    // A failed lookup must not silently downgrade the seat to local: the
    // principal asked for their own agent to speak. Let the turn fail so the
    // negotiation pauses re-kickably instead.
    throw new Error(`Could not determine who plays ${userId}'s seat`, { cause: error });
  }

  const external = agents.find((agent) =>
    agent.type === 'external'
    && agent.status === 'active'
    && agent.handleNegotiations
    && agent.transports.some((transport) => transport.channel === 'a2a' && transport.active));
  if (!external) return null;

  // Highest priority first, matching the order the adapter already reads them in.
  const transport = external.transports
    .filter((entry) => entry.channel === 'a2a' && entry.active)
    .sort((a, b) => b.priority - a.priority)[0];
  const config = transport ? transportConfig(transport.config) : null;
  if (!config) {
    throw new Error(`Agent ${external.id} has an active a2a transport with no usable url`);
  }

  logger.info('Seat is played by an external agent over A2A', {
    userId,
    agentId: external.id,
    url: config.url,
  });
  return config;
}
