import { isIP } from 'node:net';

import { jwtVerify, createRemoteJWKSet } from 'jose';

import { BASE_URL, JWT_AUDIENCE } from '../betterauth/betterauth';

/**
 * Identifier kinds the limiter buckets against. Only two — `user` for
 * cryptographically verified JWTs, and `ip` for everything else. Unverified
 * credentials (API keys we haven't checked yet, session cookies, no auth at
 * all) all fall through to the IP bucket. This prevents a credential-rotation
 * bypass: a client can't escape IP throttling by sending a fresh random
 * x-api-key or session_token cookie per request.
 */
export type IdentifierKind = 'user' | 'ip';

export interface Identifier {
  kind: IdentifierKind;
  /** Either the verified userId or the resolved client IP / sentinel. */
  value: string;
}

const DEFAULT_IP_HEADERS = [
  'x-envoy-external-address',
  'x-forwarded-for',
  'x-original-forwarded-for',
  'x-real-ip',
];

/** Read LIMITER_IP_HEADERS per-call so test overrides take effect without re-import. */
function getIpHeaders(): string[] {
  return (
    process.env.LIMITER_IP_HEADERS
      ?.split(',').map(s => s.trim()).filter(Boolean)
    ?? DEFAULT_IP_HEADERS
  );
}

const isRailway = () => !!process.env.RAILWAY_ENVIRONMENT;

// Use Node's RFC-compliant IP validator (available in Bun via node:net) so we
// can't be fooled into bucketing on malformed strings like `::::` or random
// hex from a spoofed forwarded header.
const isValidIp = (s: string): boolean => isIP(s) !== 0;

/**
 * Minimal subset of Bun.Server we use — captured to look up the socket peer
 * IP when forwarded headers aren't available (local dev or non-Railway deploys).
 */
export interface ServerLike {
  requestIP(req: Request): { address: string } | null;
}

let boundServer: ServerLike | null = null;

/**
 * Called once from main.ts after `Bun.serve(...)` so the limiter can resolve
 * the socket peer IP in environments where `RAILWAY_ENVIRONMENT` isn't set.
 */
export function bindLimiterServer(server: ServerLike): void {
  boundServer = server;
}

export function resolveClientIp(
  req: Request,
  server?: ServerLike,
): string {
  if (isRailway()) {
    for (const h of getIpHeaders()) {
      const v = req.headers.get(h);
      if (!v) continue;
      const first = v.split(',')[0]?.trim();
      if (first && isValidIp(first)) return first;
    }
    // On Railway with no resolvable header — explicit sentinel that does NOT bypass
    // the rate limiter. Requests share a shared bucket (ip:unresolved) as a defensive
    // default. Operators should check edge header configuration.
    return 'unresolved';
  }
  const peer = (server ?? boundServer)?.requestIP(req);
  return peer?.address ?? 'unknown';
}

export async function sha256Truncated(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

const JWKS = createRemoteJWKSet(new URL('/api/auth/jwks', BASE_URL));

export async function resolveIdentifier(
  req: Request,
  server?: ServerLike,
): Promise<Identifier> {
  // Only the JWT path counts as "verified" — the signature check guarantees
  // the userId is real and stable per user. API keys and session cookies are
  // unverified at this point (the auth guard hasn't run yet) and would let a
  // client trivially rotate credentials to create fresh buckets. Fall through
  // to the IP bucket for those.
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWKS, {
        issuer: BASE_URL, audience: JWT_AUDIENCE,
      });
      // Better Auth JWTs carry `id`; MCP OAuth tokens (also signed by the
      // same JWKS) carry `sub` per the OAuth/OIDC convention. Accept either.
      const userId = typeof payload.id === 'string' && payload.id.length > 0
        ? payload.id
        : typeof payload.sub === 'string' && payload.sub.length > 0
          ? payload.sub
          : null;
      if (userId) {
        return { kind: 'user', value: userId };
      }
    } catch { /* fall through */ }
  }

  return { kind: 'ip', value: resolveClientIp(req, server) };
}
