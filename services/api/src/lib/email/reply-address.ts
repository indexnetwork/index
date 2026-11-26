import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Reply addresses let an owner answer their agent's email by replying to it.
 * Each one names its owner and the day it was minted, signed so nobody can
 * write to someone else's agent:
 *
 *   reply-<user id as 32 hex>-<day, base 36>-<signature, 16 hex>@<EMAIL_REPLY_DOMAIN>
 *
 * Everything is lowercase, because mail servers may change the case of the
 * part before the @. Off until EMAIL_REPLY_DOMAIN is set; sends then keep the
 * hello@ Reply-To.
 */

/** How long a reply address keeps working after its email went out. */
export const REPLY_ADDRESS_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL = /^reply-([0-9a-f]{32})-([0-9a-z]{1,8})-([0-9a-f]{16})$/;

/** The domain replies arrive on, or null when replying to the agent is off. */
export function replyDomain(): string | null {
  const domain = process.env.EMAIL_REPLY_DOMAIN?.trim().toLowerCase();
  return domain || null;
}

function sign(hex: string, day: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required to sign reply addresses');
  return createHmac('sha256', secret).update(`email-reply:${hex}:${day}`).digest('hex').slice(0, 16);
}

/**
 * The address an owner's reply should go to, so it reaches their personal agent.
 *
 * @param userId - The owner the email is for.
 * @param now - When the email goes out; injectable for tests.
 * @returns The address, or null when replies are off or the id can't be written into one.
 */
export function replyAddress(userId: string, now: Date = new Date()): string | null {
  const domain = replyDomain();
  const id = userId.toLowerCase();
  if (!domain || !UUID.test(id) || !process.env.BETTER_AUTH_SECRET) return null;
  const hex = id.replace(/-/g, '');
  const day = Math.floor(now.getTime() / DAY_MS).toString(36);
  return `reply-${hex}-${day}-${sign(hex, day)}@${domain}`;
}

export type ReadReplyAddress =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_ours' | 'bad_signature' | 'expired' };

/**
 * Read a reply address back to its owner.
 *
 * @param address - One recipient of an inbound email, bare or as `Name <address>`.
 * @param now - When the reply arrived; injectable for tests.
 */
export function readReplyAddress(address: string, now: Date = new Date()): ReadReplyAddress {
  const domain = replyDomain();
  const bare = (address.match(/<([^>]+)>/)?.[1] ?? address).trim().toLowerCase();
  const at = bare.lastIndexOf('@');
  if (!domain || at <= 0 || bare.slice(at + 1) !== domain) return { ok: false, reason: 'not_ours' };
  const match = bare.slice(0, at).match(LOCAL);
  if (!match) return { ok: false, reason: 'not_ours' };
  const [, hex, day, signature] = match;

  const expected = Buffer.from(sign(hex, day));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };

  const minted = parseInt(day, 36) * DAY_MS;
  if (!Number.isFinite(minted) || now.getTime() - minted > (REPLY_ADDRESS_DAYS + 1) * DAY_MS) return { ok: false, reason: 'expired' };

  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { ok: true, userId };
}
