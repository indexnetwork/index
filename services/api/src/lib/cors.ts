/**
 * CORS policy for the API.
 *
 * One rule, one source: a browser origin is granted access only when it appears
 * in `TRUSTED_ORIGINS`. The request's own `Origin` is never evidence of anything
 * — reflecting it (as this module used to) with
 * `Access-Control-Allow-Credentials: true` let any website read a signed-in
 * user's `set-auth-jwt` from `/api/auth/token`, because the session cookie is
 * `SameSite=None`.
 *
 * `getCorsHeaders` and `getTrustedOrigins` both read the same parsed set, so the
 * CORS layer cannot grant an origin that Better Auth would not also trust.
 *
 * Callers that send no `Origin` (CLI, MCP clients, Telegram webhooks) are
 * untouched: they get the base headers and no grant, exactly as before.
 */
import { log } from './log';

const logger = log.lib.from('cors');

/**
 * Serialize an origin to `scheme://host[:port]`, or null if it is not one.
 *
 * `URL.origin` is the comparison key on both sides of the check, which makes the
 * match exact rather than textual: a default port is dropped (`https://x:443` ===
 * `https://x`), a trailing slash or path is discarded, and userinfo cannot smuggle
 * a hostname (`https://index.network@evil.example` → `https://evil.example`).
 *
 * Non-HTTP(S) schemes are refused because `URL.origin` serializes them to the
 * opaque `"null"`, which would make every one of them compare equal to every
 * other and to a sandboxed browser context. `"null"` itself never parses, so an
 * opaque origin can neither be sent nor configured into the trusted set.
 */
function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.origin;
}

/**
 * Parsed `TRUSTED_ORIGINS`, cached against the raw value it was parsed from.
 *
 * Keyed by the raw string rather than parsed once at import so a changed
 * environment is picked up (tests do this) while a request still costs one map
 * lookup instead of a parse.
 */
let cache: { raw: string; origins: ReadonlySet<string> } | null = null;

/**
 * The configured trusted origins.
 *
 * A malformed entry is skipped and named in a warning, not fatal. Failing the
 * boot would let one typo in one entry take the whole API down, and silently
 * dropping it is how a trusted set quietly shrinks to nothing with no signal;
 * the warning is emitted once per distinct `TRUSTED_ORIGINS` value, so it lands
 * at startup on the first request rather than on every request. Skipping can
 * only ever shrink the set — it never widens it.
 */
function trustedOrigins(): ReadonlySet<string> {
  const raw = process.env.TRUSTED_ORIGINS ?? '';
  if (cache && cache.raw === raw) return cache.origins;

  const origins = new Set<string>();
  const rejected: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = normalizeOrigin(trimmed);
    if (normalized === null) {
      rejected.push(trimmed);
      continue;
    }
    origins.add(normalized);
  }

  if (rejected.length > 0) {
    logger.warn('Ignoring malformed TRUSTED_ORIGINS entries', { rejected, trusted: [...origins] });
  }

  cache = { raw, origins };
  return origins;
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, x-api-key',
    'Access-Control-Expose-Headers': 'X-Session-Id, set-auth-jwt',
    'Access-Control-Max-Age': '86400',
  };

  const origin = req.headers.get('Origin');
  const normalized = origin ? normalizeOrigin(origin) : null;
  // The normalized form is echoed, never the caller's raw string, so nothing
  // from the request reaches a response header.
  if (normalized !== null && trustedOrigins().has(normalized)) {
    headers['Access-Control-Allow-Origin'] = normalized;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/**
 * Trusted origins for Better Auth, from `TRUSTED_ORIGINS` only.
 *
 * The `request` parameter is part of Better Auth's `trustedOrigins` callback
 * signature and is deliberately unused: adding the caller's own `Origin` here
 * (as this used to) made Better Auth's trusted-origin check accept whatever the
 * caller claimed to be.
 */
export async function getTrustedOrigins(_request?: Request): Promise<string[]> {
  return [...trustedOrigins()];
}
