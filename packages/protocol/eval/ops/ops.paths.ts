/**
 * Which request paths the ops HTTP handler owns.
 *
 * `createOpsHandler` is mounted two ways: standalone (ops.serve.ts, API only)
 * and behind a static file server that also serves the built SPA
 * (apps/eval-ops/server.ts). The second one has to decide, per request, whether
 * to forward to the handler or to answer with a file — and a bare
 * `pathname.startsWith("/api/")` gets that wrong, because the handler also owns
 * {@link OPS_CALLBACK_PATH}. That is not a cosmetic miss: the sign-in bridge
 * redirects the operator's browser to `/callback` carrying a freshly minted API
 * key, so answering it with `index.html` leaves a real credential sitting in the
 * URL bar and in browser history for a sign-in that can never complete.
 *
 * The rule therefore lives here, in one zero-dependency module both sides
 * import, rather than being restated as a prefix test at each mount point. The
 * callback path cannot be under `/api/`: `validateCliCallbackUrl` in
 * apps/web/src/lib/cli-auth.ts requires the pathname to be exactly `/callback`.
 *
 * A test in eval/ops/tests/server.spec.ts asserts that every route in the
 * server's own hand-maintained inventory is owned here, so a route added to
 * ops.server.ts outside `/api/` fails there rather than silently falling through
 * to the SPA.
 */

/** Every route the JSON API serves lives under this prefix. */
export const OPS_API_PREFIX = "/api/";

/**
 * Where the CLI-auth bridge delivers the credential. Exactly `/callback`, and
 * deliberately not under {@link OPS_API_PREFIX} — the bridge's own validator
 * accepts no other pathname.
 */
export const OPS_CALLBACK_PATH = "/callback";

/**
 * True when the ops handler — not the static file server in front of it — must
 * answer this path.
 *
 * `/api` with no trailing slash is included: the handler answers it (gated, then
 * 404), and forwarding it keeps "the API owns /api" true without a special case
 * at every mount point.
 */
export function isOpsServerPath(pathname: string): boolean {
  return (
    pathname === OPS_CALLBACK_PATH
    || pathname === OPS_API_PREFIX.slice(0, -1)
    || pathname.startsWith(OPS_API_PREFIX)
  );
}
