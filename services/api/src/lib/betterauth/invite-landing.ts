/**
 * True when a sign-in happened on a network invite landing (`/l/:code`).
 * Someone joining through an invitation link belongs to the network that
 * invited them, so Index Early must not claim them. Magic-link verify can hand
 * the callback URL over still percent-encoded, hence the decoded retry.
 *
 * @param callbackURL - The URL the sign-in flow returns to; absolute or app-relative.
 * @param appBaseURL - Base for resolving a relative callback URL.
 */
export function isInviteLanding(callbackURL: string | undefined, appBaseURL: string): boolean {
  if (!callbackURL) return false;
  for (const candidate of [callbackURL, safeDecode(callbackURL)]) {
    try {
      if (new URL(candidate, appBaseURL).pathname.startsWith('/l/')) return true;
    } catch {
      // Not a URL; the decoded form may still be.
    }
  }
  return false;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
