import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) nonPublic.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) nonPublic.addSubnet(network, prefix, 'ipv6');

/** A callback URL that is malformed, not HTTPS, or resolves to a non-public address. */
export class WebhookUrlError extends Error {}

/**
 * Callers supply these URLs, so every address the host resolves to must be
 * public. Run it right before each request: DNS can change between calls.
 *
 * @param raw - Callback URL.
 * @throws WebhookUrlError when the URL may not be called.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('Callback URL is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new WebhookUrlError('Callback URL must use HTTPS');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address, family }) => nonPublic.check(address, family === 6 ? 'ipv6' : 'ipv4'))) {
    throw new WebhookUrlError('Callback URL must resolve to a public address');
  }
}

/**
 * Standard Webhooks signature: HMAC-SHA256 over `id.timestamp.body` with the
 * base64 key after `whsec_`. Several secrets sign during a rotation.
 */
export function signWebhook(secrets: readonly string[], id: string, timestamp: number, body: string): string {
  return secrets
    .map((secret) => `v1,${createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`)
    .join(' ');
}

/**
 * POST one signed JSON body to a public HTTPS callback without following redirects.
 *
 * @throws WebhookUrlError when the URL may not be called; network errors as thrown by fetch.
 */
export async function postWebhook(options: {
  url: string;
  secrets: readonly string[];
  id: string;
  subscriptionId: string;
  body: string;
}): Promise<Response> {
  await assertPublicHttpsUrl(options.url);
  const timestamp = Math.floor(Date.now() / 1000);
  return fetch(options.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': options.id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signWebhook(options.secrets, options.id, timestamp, options.body),
      'X-MCP-Subscription-Id': options.subscriptionId,
    },
    body: options.body,
  });
}
