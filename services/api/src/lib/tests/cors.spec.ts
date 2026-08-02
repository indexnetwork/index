/**
 * CORS origin policy.
 *
 * These tests exist because the API used to reflect *any* `Origin` back with
 * `Access-Control-Allow-Credentials: true`, which let any website read a
 * logged-in user's auth token (`/api/auth/token`, exposed via
 * `Access-Control-Expose-Headers: set-auth-jwt`, with a `SameSite=None` session
 * cookie). The grant must now come from configuration only.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { getCorsHeaders, getTrustedOrigins } from '../cors';

const PROD_LIKE = 'https://index.network';
const DEV_LIKE = 'https://dev.index.network';
const LOCAL_LIKE = 'http://localhost:3000';

let savedTrustedOrigins: string | undefined;

/** Build a request the way Bun.serve hands one to `getCorsHeaders`. */
function request(origin?: string | null, method = 'GET'): Request {
  const headers = new Headers();
  if (origin !== undefined && origin !== null) headers.set('Origin', origin);
  return new Request('https://protocol.index.network/api/auth/token', { method, headers });
}

/** The headers every response gets regardless of origin (no grant in here). */
const BASE_HEADER_KEYS = [
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
];

beforeEach(() => {
  savedTrustedOrigins = process.env.TRUSTED_ORIGINS;
  process.env.TRUSTED_ORIGINS = `${PROD_LIKE},${LOCAL_LIKE}`;
});

afterEach(() => {
  if (savedTrustedOrigins === undefined) delete process.env.TRUSTED_ORIGINS;
  else process.env.TRUSTED_ORIGINS = savedTrustedOrigins;
});

describe('getCorsHeaders — grants', () => {
  test('grants a configured origin, with credentials', () => {
    const headers = getCorsHeaders(request(PROD_LIKE));
    expect(headers['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  test('grants the local web dev origin from .env.development', () => {
    process.env.TRUSTED_ORIGINS = `${DEV_LIKE},${LOCAL_LIKE}`;
    const headers = getCorsHeaders(request(LOCAL_LIKE));
    expect(headers['Access-Control-Allow-Origin']).toBe(LOCAL_LIKE);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  test('a configured entry written with a trailing slash still grants the browser origin', () => {
    process.env.TRUSTED_ORIGINS = 'https://index.network/';
    const headers = getCorsHeaders(request(PROD_LIKE));
    expect(headers['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
  });

  test('a default port on either side compares equal', () => {
    process.env.TRUSTED_ORIGINS = 'https://index.network:443';
    expect(getCorsHeaders(request(PROD_LIKE))['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
  });

  test('picks up a changed TRUSTED_ORIGINS without a restart of the module', () => {
    expect(getCorsHeaders(request(DEV_LIKE))['Access-Control-Allow-Origin']).toBeUndefined();
    process.env.TRUSTED_ORIGINS = DEV_LIKE;
    expect(getCorsHeaders(request(DEV_LIKE))['Access-Control-Allow-Origin']).toBe(DEV_LIKE);
  });
});

describe('getCorsHeaders — refusals', () => {
  test('an untrusted origin gets no CORS grant at all', () => {
    const headers = getCorsHeaders(request('https://evil.example'));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  test('never echoes an untrusted origin into any header value', () => {
    const headers = getCorsHeaders(request('https://evil.example'));
    expect(Object.values(headers).join('|')).not.toContain('evil.example');
  });

  test.each([
    ['suffix impostor', 'https://index.network.evil.com'],
    ['subdomain impostor', 'https://evil.index.network'],
    ['prefix impostor', 'https://index.networkevil.com'],
    ['scheme mismatch', 'http://index.network'],
    ['explicit non-default port', 'https://index.network:8443'],
    ['userinfo smuggling', 'https://index.network@evil.example'],
    ['path suffix', 'https://evil.example/https://index.network'],
  ])('refuses a near-match: %s', (_label, origin) => {
    const headers = getCorsHeaders(request(origin));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  test('refuses the opaque origin `null`', () => {
    // `Origin: null` is presented by sandboxed iframes, data: URLs and some
    // cross-origin redirects. It is unauthenticatable, so a grant to `null` is
    // a grant to everyone. This must stay refused even if a client asks for it.
    const headers = getCorsHeaders(request('null'));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  test('refuses a literal `null` entry in TRUSTED_ORIGINS too', () => {
    process.env.TRUSTED_ORIGINS = `null,${PROD_LIKE}`;
    expect(getCorsHeaders(request('null'))['Access-Control-Allow-Origin']).toBeUndefined();
    expect(getCorsHeaders(request(PROD_LIKE))['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
  });

  test('refuses a wildcard origin and does not honour `*` as configuration', () => {
    process.env.TRUSTED_ORIGINS = `*,${PROD_LIKE}`;
    expect(getCorsHeaders(request('https://evil.example'))['Access-Control-Allow-Origin']).toBeUndefined();
    expect(getCorsHeaders(request('*'))['Access-Control-Allow-Origin']).toBeUndefined();
    expect(getCorsHeaders(request(PROD_LIKE))['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
  });

  test('grants nothing when TRUSTED_ORIGINS is unset or empty', () => {
    delete process.env.TRUSTED_ORIGINS;
    expect(getCorsHeaders(request(PROD_LIKE))['Access-Control-Allow-Origin']).toBeUndefined();
    process.env.TRUSTED_ORIGINS = '   ,,  ';
    expect(getCorsHeaders(request(PROD_LIKE))['Access-Control-Allow-Origin']).toBeUndefined();
  });

  test('a malformed entry does not widen the set', () => {
    process.env.TRUSTED_ORIGINS = `not a url, ://broken , ${PROD_LIKE}`;
    expect(getCorsHeaders(request('https://evil.example'))['Access-Control-Allow-Origin']).toBeUndefined();
    expect(getCorsHeaders(request('not a url'))['Access-Control-Allow-Origin']).toBeUndefined();
    expect(getCorsHeaders(request(PROD_LIKE))['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
  });
});

describe('getCorsHeaders — non-browser callers are unaffected', () => {
  test('a request with no Origin gets exactly the base headers (CLI, MCP, Telegram)', () => {
    const headers = getCorsHeaders(request());
    expect(Object.keys(headers).sort()).toEqual([...BASE_HEADER_KEYS].sort());
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toBe(
      'Content-Type, Authorization, X-Requested-With, Accept, x-api-key'
    );
    expect(headers['Access-Control-Expose-Headers']).toBe('X-Session-Id, X-Chat-Persona, set-auth-jwt');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  test('an empty Origin header is treated as no origin', () => {
    const headers = getCorsHeaders(request(''));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  test('the base headers are identical for trusted, untrusted and origin-less requests', () => {
    const pick = (h: Record<string, string>) =>
      Object.fromEntries(BASE_HEADER_KEYS.map((k) => [k, h[k]]));
    const none = pick(getCorsHeaders(request()));
    expect(pick(getCorsHeaders(request(PROD_LIKE)))).toEqual(none);
    expect(pick(getCorsHeaders(request('https://evil.example')))).toEqual(none);
  });
});

describe('getCorsHeaders — preflight (OPTIONS, main.ts:640)', () => {
  test('a preflight from a trusted origin is granted and keeps the preflight headers', () => {
    const headers = getCorsHeaders(request(PROD_LIKE, 'OPTIONS'));
    expect(headers['Access-Control-Allow-Origin']).toBe(PROD_LIKE);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  test('a preflight from an untrusted origin is not granted', () => {
    const headers = getCorsHeaders(request('https://evil.example', 'OPTIONS'));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });
});

describe('getTrustedOrigins', () => {
  test('does not echo the caller back as trusted', async () => {
    const origins = await getTrustedOrigins(request('https://evil.example'));
    expect(origins).not.toContain('https://evil.example');
    expect(origins).toEqual([PROD_LIKE, LOCAL_LIKE]);
  });

  test('is identical with and without a request', async () => {
    const withRequest = await getTrustedOrigins(request('https://evil.example'));
    const withoutRequest = await getTrustedOrigins();
    expect(withRequest).toEqual(withoutRequest);
  });

  test('normalises and de-duplicates configured entries', async () => {
    process.env.TRUSTED_ORIGINS = `${PROD_LIKE}/, https://index.network:443 ,${PROD_LIKE}`;
    expect(await getTrustedOrigins()).toEqual([PROD_LIKE]);
  });

  test('skips malformed entries instead of widening the set', async () => {
    process.env.TRUSTED_ORIGINS = `not a url,*,ftp://index.network,${PROD_LIKE}`;
    expect(await getTrustedOrigins()).toEqual([PROD_LIKE]);
  });

  test('is empty when TRUSTED_ORIGINS is unset', async () => {
    delete process.env.TRUSTED_ORIGINS;
    expect(await getTrustedOrigins(request(PROD_LIKE))).toEqual([]);
  });

  test('agrees with getCorsHeaders: anything CORS grants, Better Auth also trusts', async () => {
    process.env.TRUSTED_ORIGINS = `${PROD_LIKE}/,${DEV_LIKE},${LOCAL_LIKE},garbage`;
    const trusted = await getTrustedOrigins();
    for (const candidate of [PROD_LIKE, DEV_LIKE, LOCAL_LIKE, 'https://evil.example', 'null', 'garbage']) {
      const granted = getCorsHeaders(request(candidate))['Access-Control-Allow-Origin'] !== undefined;
      expect(granted).toBe(trusted.includes(candidate));
    }
  });
});
