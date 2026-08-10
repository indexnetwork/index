export const HERMES_CAPABILITIES = [
  { action: 'manage:identity', label: 'Keep your Index identity up to date' },
  { action: 'manage:premises', label: 'Manage the facts and context you share with Index' },
  { action: 'manage:intents', label: 'Create and manage your intents' },
  { action: 'manage:networks', label: 'Manage your network memberships and connections' },
  { action: 'manage:opportunities', label: 'Review and act on opportunities' },
  { action: 'manage:negotiations', label: 'Handle negotiations on your behalf' },
] as const;

export type HermesCapabilityAction = (typeof HERMES_CAPABILITIES)[number]['action'];

export type HermesAuthorizationQuery = {
  requestId: string;
  state: string;
  redirectUri: string;
};

export function isHermesLoopbackRedirect(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/callback'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.toString() !== value
  ) return false;

  const port = Number(parsed.port);
  return Number.isInteger(port) && port >= 49152 && port <= 65535;
}

/** Parse exactly the three canonically encoded fields admitted by the Hermes browser bridge. */
export function parseHermesAuthorizationQuery(query: string): HermesAuthorizationQuery | null {
  if (!query || query.includes('#')) return null;

  const rawQuery = query.startsWith('?') ? query.slice(1) : query;
  const segments = rawQuery.split('&');
  const allowed = new Set(['request_id', 'state', 'redirect_uri']);
  const seen = new Set<string>();
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) return null;

  for (const segment of segments) {
    const separator = segment.indexOf('=');
    if (separator <= 0 || separator === segment.length - 1) return null;
    const rawName = segment.slice(0, separator);
    const rawValue = segment.slice(separator + 1);
    if (!allowed.has(rawName) || seen.has(rawName)) return null;
    try {
      if (encodeURIComponent(decodeURIComponent(rawValue)) !== rawValue) return null;
    } catch {
      return null;
    }
    seen.add(rawName);
  }

  const params = new URLSearchParams(rawQuery);
  const requestId = params.get('request_id');
  const state = params.get('state');
  const redirectUri = params.get('redirect_uri');
  if (!requestId || !state || !redirectUri || !isHermesLoopbackRedirect(redirectUri)) return null;

  return { requestId, state, redirectUri };
}

export function hasExactHermesCapabilities(actions: readonly string[]): actions is HermesCapabilityAction[] {
  return actions.length === HERMES_CAPABILITIES.length
    && HERMES_CAPABILITIES.every((capability, index) => actions[index] === capability.action);
}

export function buildHermesAuthorizationCallbackUrl(input: {
  redirectUri: string;
  requestId: string;
  code: string;
  state: string;
}): string {
  if (!isHermesLoopbackRedirect(input.redirectUri)) {
    throw new Error('Invalid Hermes callback');
  }
  const callback = new URL(input.redirectUri);
  callback.searchParams.set('request_id', input.requestId);
  callback.searchParams.set('code', input.code);
  callback.searchParams.set('state', input.state);
  return callback.toString();
}
