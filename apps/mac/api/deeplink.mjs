/**
 * Pure deep-link parser for the macOS/iOS shells.
 *
 * The native side does no routing: it receives a URL from macOS (a universal
 * link handed over as an NSUserActivity, or an `index://` scheme open) and
 * forwards the raw absolute string to the web layer, which asks this function
 * what it means. Keeping every URL→route decision here is what makes app
 * routing as verifiable as an HTTP endpoint: see api/deeplink.spec.mjs.
 *
 * Dependency-free ESM like the rest of api/; assemble.py strips `export` when
 * it inlines this file into the single-file bundle as window.IndexApi.
 */

/** Hosts whose https:// links this app claims (see the web AASA). */
const DEFAULT_HOSTS = ['index.network'];

/** First path segment -> route name. The web serves the same three paths. */
const ROUTE_BY_SEGMENT = {
  o: 'card',
  u: 'profile',
  c: 'legacy-connect',
};

/**
 * @typedef {{ route: 'card', id: string }
 *   | { route: 'profile', id: string }
 *   | { route: 'legacy-connect', code: string }} DeepLinkRoute
 */

/**
 * Resolve a deep link into a route, or null when it is not one of ours.
 *
 * Accepts two URL families:
 *   · `https://<allowed host>/o|u|c/<id>` — universal links. Only https, since
 *     that is the only scheme macOS ever hands over as a universal link; extra
 *     hosts (staging, a review app) go through `options.hosts` so adding one
 *     never touches the routing table.
 *   · `index://o|u|c/<id>` — the internal scheme alias, no host to check.
 *
 * Query strings, fragments and trailing slashes are ignored. Anything else —
 * a foreign host, an unknown path, a missing id, malformed input — is null.
 * Never throws.
 *
 * @param {unknown} rawUrl
 * @param {{ hosts?: Array<string> }} [options]
 * @returns {DeepLinkRoute | null}
 */
export function parseDeepLink(rawUrl, options = {}) {
  const path = claimedPath(rawUrl, options);
  if (path === null) return null;
  return routeFromPath(path);
}

/**
 * Is this URL ours at all — the `index:` scheme, or https on a host we claim —
 * regardless of whether it resolves to a route?
 *
 * The two questions are genuinely different: the web AASA claims `/u/*`, and
 * `*` matches path separators, so macOS can hand over `https://index.network/
 * u/<id>/chat` — a real web route with no screen in the app. The window has
 * already been raised by then, so the app says so instead of dropping it.
 *
 * @param {unknown} rawUrl
 * @param {{ hosts?: Array<string> }} [options]
 * @returns {boolean}
 */
export function isIndexDeepLink(rawUrl, options = {}) {
  return claimedPath(rawUrl, options) !== null;
}

/**
 * Return the path of a URL this app claims, or null when the URL is not ours.
 * @param {unknown} rawUrl
 * @param {{ hosts?: Array<string> }} options
 * @returns {string | null}
 */
function claimedPath(rawUrl, options) {
  if (typeof rawUrl !== 'string') return null;
  const raw = rawUrl.trim();
  if (!raw) return null;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(raw);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();

  if (scheme === 'index') {
    // `index://o/<id>`, `index:o/<id>` and `index:///o/<id>` all mean the same
    // thing. The WHATWG parser reads the authority of a non-special scheme as
    // a host, which would split `o` off the path, so slice it by hand instead.
    const rest = raw.slice(schemeMatch[0].length).replace(/^\/*/, '');
    return stripQueryAndFragment(rest);
  }

  if (scheme !== 'https') return null;

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    return null;
  }

  const hosts = Array.isArray(options.hosts) && options.hosts.length
    ? options.hosts
    : DEFAULT_HOSTS;
  const hostname = url.hostname.toLowerCase();
  const allowed = hosts.some(
    (host) => typeof host === 'string' && host.trim().toLowerCase() === hostname,
  );
  if (!allowed) return null;

  return url.pathname;
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripQueryAndFragment(value) {
  return value.split('#')[0].split('?')[0];
}

/**
 * Turn `/o/<id>` (with or without trailing slashes) into a route.
 * @param {string} path
 * @returns {DeepLinkRoute | null}
 */
function routeFromPath(path) {
  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const route = ROUTE_BY_SEGMENT[segments[0]];
  if (!route) return null;

  const value = safeDecode(segments[1]);
  if (!value) return null;

  return route === 'legacy-connect' ? { route, code: value } : { route, id: value };
}

/**
 * decodeURIComponent that keeps the raw segment rather than throwing on a
 * malformed escape.
 * @param {string} segment
 * @returns {string}
 */
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    return segment;
  }
}
