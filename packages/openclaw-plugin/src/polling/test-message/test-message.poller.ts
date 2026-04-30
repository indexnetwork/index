import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';

export interface TestMessageConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/**
 * Handles one test-message pickup cycle. Test messages are delivery
 * verification: pick up a reservation, dispatch via main agent (which
 * the gateway delivers to the user's last channel), and confirm.
 *
 * If dispatch fails the reservation is allowed to expire so the backend
 * can retry on the next cycle.
 *
 * @returns `true` when a test message was rendered and confirmed,
 *          `false` when nothing was pending or dispatch/pickup failed.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: TestMessageConfig,
): Promise<boolean> {
  // 1. Pickup
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/pickup`;
  const pickupRes = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
  });

  if (pickupRes.status === 204) return false;
  if (!pickupRes.ok) {
    const text = await pickupRes.text().catch(() => '');
    api.logger.warn(`Test-message pickup failed: ${pickupRes.status} ${text}`);
    return false;
  }

  const reservation = (await pickupRes.json()) as {
    id: string;
    content: string;
    reservationToken: string;
  };

  // 2. Dispatch via main agent.
  const mainAgentToolUse = readMainAgentToolUse(api);
  const prompt = buildMainAgentPrompt({
    contentType: 'test_message',
    mainAgentToolUse,
    payload: { contentType: 'test_message', content: reservation.content },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:test:${reservation.id}:${reservation.reservationToken}`,
  });

  if (!dispatch.delivered) {
    api.logger.warn('Test-message dispatch failed; reservation will expire.');
    return false;
  }

  // 3. Confirm.
  const confirmUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/${reservation.id}/delivered`;
  await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationToken: reservation.reservationToken }),
  }).catch((err) => {
    api.logger.warn(
      `Test-message confirm failed for ${reservation.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return true;
}
