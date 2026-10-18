import { createHmac, timingSafeEqual } from 'node:crypto';

/** Resend event types that feed the daily mail counts. */
export const TRACKED_EVENTS = [
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'failed',
  'opened',
  'clicked',
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export interface ParsedEmailEvent {
  type: TrackedEvent;
  emailId: string;
  kind: string | null;
  occurredAt: Date;
}

const TOLERANCE_SECONDS = 5 * 60;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Resend signs webhooks with Svix: HMAC-SHA256 over `id.timestamp.body`, keyed
 * by the base64 part of the `whsec_` secret. The header lists one or more
 * `v1,<signature>` entries, so a rotated secret still verifies.
 *
 * @param secret - The webhook signing secret from the Resend dashboard.
 * @param headers - The request headers.
 * @param body - The raw request body, exactly as received.
 * @param nowSeconds - Current time, injectable for tests.
 * @returns The Svix message id when the signature and timestamp are valid, otherwise null.
 */
export function verifyResendWebhook(
  secret: string,
  headers: Pick<Headers, 'get'>,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return null;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return null;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  const valid = signatures
    .split(' ')
    .some((entry) => {
      const [version, signature] = entry.split(',');
      return version === 'v1' && signature !== undefined && safeEqual(signature, expected);
    });
  return valid ? id : null;
}

function tagValue(tags: unknown, name: string): string | null {
  if (Array.isArray(tags)) {
    const found = tags.find((tag): tag is { name: string; value: unknown } => (
      typeof tag === 'object' && tag !== null && (tag as { name?: unknown }).name === name
    ));
    return typeof found?.value === 'string' ? found.value : null;
  }
  if (typeof tags === 'object' && tags !== null) {
    const value = (tags as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * Reduce a Resend webhook payload to what the counts need: no address and no
 * subject is kept. Returns null for event types that are not tracked, such as
 * contact or domain events.
 */
export function parseResendEvent(payload: unknown): ParsedEmailEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { type, created_at: createdAt, data } = payload as {
    type?: unknown;
    created_at?: unknown;
    data?: { email_id?: unknown; tags?: unknown; created_at?: unknown };
  };
  if (typeof type !== 'string' || !type.startsWith('email.')) return null;
  const name = type.slice('email.'.length);
  if (!(TRACKED_EVENTS as readonly string[]).includes(name)) return null;
  const emailId = data?.email_id;
  if (typeof emailId !== 'string' || !emailId) return null;
  const when = new Date(typeof createdAt === 'string' ? createdAt : typeof data?.created_at === 'string' ? data.created_at : Date.now());
  if (Number.isNaN(when.getTime())) return null;
  return { type: name as TrackedEvent, emailId, kind: tagValue(data?.tags, 'kind'), occurredAt: when };
}
