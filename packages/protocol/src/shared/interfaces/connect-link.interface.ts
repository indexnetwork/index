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
 *   direct-mode opp clicks to flip it straight to `accepted` and open
 *   the chat with a pre-filled greeting. Mirrors the frontend's "Start
 *   Chat" button on draft cards: both posted public intents that
 *   matched, so opening the chat counts as the consent; the counterpart
 *   sees the new accepted opp on their side and can engage or not.
 */
export type ConnectLinkKind = 'connect' | 'approve_introduction' | 'outreach' | 'send_direct';

/**
 * Mints (or reuses) a short link for the given recipient and kind, snapshotting
 * the greeting onto the link record. Returns the full public URL.
 *
 * The click-time redirect on `/c/{code}/go` routes by the counterparty's live
 * reachability (Telegram handle → t.me deep link, else the web chat URL), so
 * the link record no longer stores a surface hint.
 */
export interface MintConnectLink {
  (args: {
    userId: string;
    opportunityId: string;
    kind: ConnectLinkKind;
    greeting?: string | null;
  }): Promise<{ url: string }>;
}
