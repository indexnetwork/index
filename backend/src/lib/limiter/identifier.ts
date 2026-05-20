import { jwtVerify, createRemoteJWKSet } from 'jose';

import { BASE_URL, JWT_AUDIENCE } from '../betterauth/betterauth';

export type IdentifierKind = 'user' | 'apikey' | 'cookie' | 'ip';

export interface Identifier {
  kind: IdentifierKind;
  /** Already-hashed or already-safe value used in the bucket key. */
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

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const isValidIp = (s: string) => IPV4.test(s) || (IPV6.test(s) && s.includes(':'));

export function resolveClientIp(
  req: Request,
  server?: { requestIP(req: Request): { address: string } | null },
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
  const peer = server?.requestIP(req);
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
  server?: { requestIP(req: Request): { address: string } | null },
): Promise<Identifier> {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWKS, {
        issuer: BASE_URL, audience: JWT_AUDIENCE,
      });
      const userId = payload.id;
      if (typeof userId === 'string' && userId.length > 0) {
        return { kind: 'user', value: userId };
      }
    } catch { /* fall through */ }
  }

  const apiKey = req.headers.get('x-api-key');
  if (apiKey) {
    return { kind: 'apikey', value: await sha256Truncated(apiKey) };
  }

  const cookie = req.headers.get('cookie');
  const sessionToken = readCookie(cookie, 'better-auth.session_token')
    ?? readCookie(cookie, '__Secure-better-auth.session_token');
  if (sessionToken) {
    return { kind: 'cookie', value: await sha256Truncated(sessionToken) };
  }

  return { kind: 'ip', value: resolveClientIp(req, server) };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}
