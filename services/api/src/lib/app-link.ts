import { createHmac, timingSafeEqual } from 'node:crypto';

const APP_URL = (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');

export type LinkAction = 'accept' | 'decline';

/**
 * Canonical public link for an entity. The Mac app claims these as universal
 * links; the web handoff routes the rest to Hermes, the web page, or /download.
 *
 * @param kind - `u` user, `i` intent, `o` opportunity.
 * @param id - Entity id.
 * @returns Absolute https URL.
 */
export function appLink(kind: 'u' | 'i' | 'o', id: string): string {
  return `${APP_URL}/${kind}/${encodeURIComponent(id)}`;
}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error('BETTER_AUTH_SECRET is required to sign opportunity links');
  return value;
}

function sign(id: string, viewer: string, action: LinkAction): string {
  return createHmac('sha256', secret()).update(`o:${id}:${viewer}:${action}`).digest('base64url');
}

/** Signed accept or decline link. The surface is appended later and is not signed. */
export function actionLink(opportunityId: string, viewerId: string, action: LinkAction): string {
  const query = new URLSearchParams({ action, viewer: viewerId, sig: sign(opportunityId, viewerId, action) });
  return `${appLink('o', opportunityId)}?${query}`;
}

/** True when `sig` was minted for this opportunity, viewer, and action. */
export function isSignedAction(opportunityId: string, viewerId: string, action: LinkAction, sig: string): boolean {
  const expected = Buffer.from(sign(opportunityId, viewerId, action));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
