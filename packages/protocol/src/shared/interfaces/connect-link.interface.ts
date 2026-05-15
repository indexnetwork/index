/**
 * Kind of connect link being minted. Determines the action endpoint the short
 * URL eventually redirects to (per-status: pending+introducer ->
 * approve_introduction, accepted -> outreach, otherwise -> connect).
 */
export type ConnectLinkKind = 'connect' | 'approve_introduction' | 'outreach';

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
