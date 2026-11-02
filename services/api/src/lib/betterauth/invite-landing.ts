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

/**
 * How recently an Index Early membership must have been made for an
 * invitation to undo it. The sign-in auto-join lands seconds before the
 * invitation is accepted; the window allows for an agent that joins a few
 * minutes after its owner signs in, and leaves older memberships alone.
 */
export const INDEX_EARLY_RELEASE_WINDOW_MINUTES = 15;

/**
 * Whether accepting an invitation to `invitedNetworkId` should undo a fresh
 * sign-in auto-join to Index Early. The sign-in check cannot always tell that
 * someone came from an invitation (a Google sign-in loses the return URL, an
 * agent signs in before it joins), so the invitation itself settles it.
 *
 * @param indexEarlyNetworkId - INDEX_EARLY_NETWORK_ID, when configured.
 * @param invitedNetworkId - The network the invitation was for.
 */
export function shouldReleaseIndexEarly(indexEarlyNetworkId: string | undefined, invitedNetworkId: string): boolean {
  return !!indexEarlyNetworkId && indexEarlyNetworkId !== invitedNetworkId;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
