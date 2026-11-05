/**
 * X (Twitter) profile URLs from stored social values. A value may be a bare
 * handle, an @handle, or an x.com / twitter.com URL; anything else is not
 * routable. X handles are case-insensitive, so case is folded to keep
 * deduplication drift-free.
 */

/** Path roots on x.com that are product pages, never profiles. */
const RESERVED_PATHS = new Set([
  'i', 'home', 'intent', 'search', 'hashtag', 'explore',
  'messages', 'settings', 'share', 'login', 'signup',
]);

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Canonical X profile URL for one stored social value.
 *
 * Enrichment sometimes packs several addresses into one value, so only the
 * first token counts. A URL on any host other than x.com / twitter.com is
 * rejected even when it was filed under the x label.
 *
 * @param raw - Raw handle, @handle, or URL.
 * @returns `https://x.com/<handle>` in lowercase, or null when not routable.
 */
export function normalizeXProfileUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[,;|]+/)[0].trim().replace(/[),.;:]+$/, '');
  if (!first) return null;

  let candidate = first;
  const hosted = /^(?:https?:)?\/\//i.test(first) || /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(first);
  if (hosted) {
    const withoutScheme = first.replace(/^(?:https?:)?\/\//i, '');
    const [host, ...path] = withoutScheme.split('/');
    const bareHost = host.replace(/^(?:www\.|mobile\.)/i, '').toLowerCase();
    if (bareHost !== 'x.com' && bareHost !== 'twitter.com') return null;
    candidate = path[0] ?? '';
  }

  const handle = candidate.split(/[/?#]/)[0].replace(/^@+/, '');
  if (!HANDLE.test(handle)) return null;
  const lower = handle.toLowerCase();
  if (RESERVED_PATHS.has(lower)) return null;
  return `https://x.com/${lower}`;
}

/** Distinct X profile URLs among stored social values, in first-seen order. */
export function distinctXProfileUrls(values: string[]): string[] {
  const urls = new Set<string>();
  for (const value of values) {
    const url = normalizeXProfileUrl(value);
    if (url) urls.add(url);
  }
  return [...urls];
}
