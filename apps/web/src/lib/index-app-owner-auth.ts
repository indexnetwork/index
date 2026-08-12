const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type IndexAppOwnerAuthorizationQuery = {
  requestId: string;
  state: string;
  redirectUri: string;
};

export function isIndexAppOwnerLoopbackRedirect(value: string): boolean {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  const port = Number(parsed.port);
  return parsed.protocol === 'http:'
    && parsed.hostname === '127.0.0.1'
    && parsed.username === '' && parsed.password === ''
    && parsed.pathname === '/callback'
    && parsed.search === '' && parsed.hash === ''
    && parsed.toString() === value
    && Number.isInteger(port) && port >= 49152 && port <= 65535;
}

/** Parse the exact canonical browser tuple issued by the native app. */
export function parseIndexAppOwnerAuthorizationQuery(
  query: string,
): IndexAppOwnerAuthorizationQuery | null {
  if (!query || query.includes('#')) return null;
  const raw = query.startsWith('?') ? query.slice(1) : query;
  const segments = raw.split('&');
  const allowed = new Set(['request_id', 'state', 'redirect_uri']);
  const seen = new Set<string>();
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) return null;
  for (const segment of segments) {
    const separator = segment.indexOf('=');
    if (separator <= 0 || separator === segment.length - 1) return null;
    const name = segment.slice(0, separator);
    const encoded = segment.slice(separator + 1);
    if (!allowed.has(name) || seen.has(name)) return null;
    try { if (encodeURIComponent(decodeURIComponent(encoded)) !== encoded) return null; } catch { return null; }
    seen.add(name);
  }
  const params = new URLSearchParams(raw);
  const requestId = params.get('request_id');
  const state = params.get('state');
  const redirectUri = params.get('redirect_uri');
  if (!requestId || !UUID_PATTERN.test(requestId) || !state || !STATE_PATTERN.test(state)
      || !redirectUri || !isIndexAppOwnerLoopbackRedirect(redirectUri)) return null;
  return { requestId, state, redirectUri };
}

export function buildIndexAppOwnerCallbackUrl(input: {
  redirectUri: string; requestId: string; code: string; state: string;
}): string {
  if (!isIndexAppOwnerLoopbackRedirect(input.redirectUri)) throw new Error('Invalid Index app callback');
  const callback = new URL(input.redirectUri);
  callback.searchParams.set('request_id', input.requestId);
  callback.searchParams.set('code', input.code);
  callback.searchParams.set('state', input.state);
  return callback.toString();
}
