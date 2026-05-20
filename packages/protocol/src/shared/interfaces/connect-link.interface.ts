/**
 * Kind of connect link being minted. Determines the action endpoint the short
 * URL eventually redirects to:
 *
 * - `connect` — receiver of a `pending` opp clicks to flip it to `accepted`
 *   and open the chat with a pre-filled greeting.
 * - `approve_introduction` — unapproved introducer on a `draft`/`latent` opp
 *   clicks to flip `approved=true` and kick off negotiation.
 * - `outreach` — non-introducer party on an `accepted` opp clicks to open
 *   the existing chat (no state change).
 * - `send_direct` — sender (non-introducer party) of a `draft`/`latent`
 *   direct-mode opp clicks to flip it to `pending`, releasing it to the
 *   counterpart's flow. No chat is opened — the counterpart must accept
 *   first via a `connect` link from their side.
 */
export type ConnectLinkKind = 'connect' | 'approve_introduction' | 'outreach' | 'send_direct';

/**
 * Mints (or reuses) a short link for the given recipient and kind, snapshotting
 * the greeting and the caller's preferred surface onto the link record. Returns
 * the full public URL.
 *
 * `preferredSurface` is stamped onto the row at insert time and drives the
 * click-time redirect on `/c/{code}/go`: only `'telegram'` activates the t.me
 * deep-link path; everything else (including `undefined`, persisted as NULL)
 * routes to the web frontend chat URL.
 */
export interface MintConnectLink {
  (args: {
    userId: string;
    opportunityId: string;
    kind: ConnectLinkKind;
    greeting?: string | null;
    preferredSurface?: 'telegram' | 'web';
  }): Promise<{ url: string }>;
}
