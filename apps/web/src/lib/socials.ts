/**
 * Social links: resolving a stored {label, value} row to something openable.
 *
 * Values arrive in every shape a person or a scraper can produce: a full URL, a
 * host with a path, a bare handle, an @handle, and — from enrichment — a few of
 * those packed into one field separated by commas. The label is no steadier:
 * the stored set is linkedin|twitter|github|telegram|custom, and 'custom' is
 * also where every website lands, so a LinkedIn URL routinely arrives labelled
 * 'custom'.
 *
 * The rule that keeps a link working: when the value carries a host, the value
 * decides where it goes and is never reassembled. Rebuilding from a label the
 * value disagrees with is what produced links like
 * https://eugene-pavlenko-b31a0430/ — a linkedin.com/in/… value stripped to its
 * handle, then put back together with a label that had no host to give it.
 *
 * Kept in step with apps/mac/api/socials.mjs, which does the same job for the
 * macOS app's own bundle.
 */

export type SocialPlatform = 'x' | 'linkedin' | 'github' | 'telegram' | 'website';

export interface SocialEntry {
  id?: string;
  label?: string;
  platform?: string;
  value?: string;
  handle?: string;
}

export interface ResolvedSocial {
  platform: SocialPlatform;
  handle: string;
  href: string;
}

/** Where a bare handle lives, per platform. */
const PREFIX: Record<string, string> = {
  x: 'x.com/',
  twitter: 'x.com/',
  linkedin: 'linkedin.com/in/',
  github: 'github.com/',
  telegram: 't.me/',
};

/** Labels naming a bucket rather than a platform, so the value decides. */
const GENERIC_LABELS = new Set(['', 'custom', 'website', 'web', 'link', 'site', 'url', 'other']);

const PLATFORM_HOSTS: Array<[RegExp, SocialPlatform]> = [
  [/^(mobile\.)?(x\.com|twitter\.com)$/, 'x'],
  [/^([a-z0-9-]+\.)?linkedin\.com$/, 'linkedin'],
  [/^github\.com$/, 'github'],
  [/^(t\.me|telegram\.me|telegram\.dog)$/, 'telegram'],
];

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The first address in a field that may hold several. Enrichment writes
 * discoveries like "tidemid , https://instagram.com/nick/" into one value;
 * used whole it became a single unopenable link. A URL contains none of these
 * separators, so splitting on them cannot damage a well-formed one.
 */
export function firstSocialValue(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const [first] = text.split(/[\s,;|]+/).filter(Boolean);
  return (first || '').replace(/[),.;:]+$/, '');
}

/** Whether a value names a host of its own, rather than being a bare handle. */
function looksHosted(value: string): boolean {
  if (SCHEME.test(value)) return true;
  const head = value.replace(/^\/\//, '').split('/')[0];
  // A dotted label is a domain; "eugenepx" is not, and treating it as one is
  // exactly how https://eugenepx/ ended up rendered as a link.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(head);
}

function splitHostPath(value: string): { host: string; path: string } {
  let text = value.replace(SCHEME, '').replace(/^\/\//, '');
  text = text.replace(/^www\./i, '');
  const cut = text.search(/[/?#]/);
  const host = (cut === -1 ? text : text.slice(0, cut)).toLowerCase().replace(/\.$/, '');
  const path = (cut === -1 ? '' : text.slice(cut)).replace(/\/+$/, '');
  return { host, path };
}

function platformForHost(host: string): SocialPlatform | '' {
  for (const [pattern, platform] of PLATFORM_HOSTS) {
    if (pattern.test(host)) return platform;
  }
  return '';
}

function labelPlatform(social: SocialEntry): SocialPlatform | '' {
  const id = String(social.id ?? social.label ?? social.platform ?? '').toLowerCase().trim();
  if (GENERIC_LABELS.has(id)) return '';
  if (id === 'twitter' || id === 'x') return 'x';
  return PREFIX[id] ? (id as SocialPlatform) : '';
}

function handleFromPath(platform: SocialPlatform, host: string, path: string): string {
  if (platform === 'website') return `${host}${path}`;
  const rest = path.replace(/^\//, '').replace(/^@/, '');
  // LinkedIn keeps people under /in/ and everything else (companies, schools)
  // one segment up, so only /in/ is dropped: what is left still says which.
  return platform === 'linkedin' ? rest.replace(/^in\//, '') : rest;
}

/** The canonical address for a platform and a handle that is already bare. */
function platformHref(platform: SocialPlatform, handle: string): string {
  if (!handle) return '';
  if (platform === 'linkedin') {
    return handle.includes('/') ? `https://linkedin.com/${handle}` : `https://linkedin.com/in/${handle}`;
  }
  const prefix = PREFIX[platform];
  return prefix ? `https://${prefix}${handle}` : '';
}

/**
 * Resolve any stored entry to {platform, handle, href}. `href` is '' when the
 * entry has no openable destination; callers leave those out rather than
 * rendering a dead link.
 */
export function parseSocial(social: SocialEntry = {}): ResolvedSocial {
  const fromLabel = labelPlatform(social);
  const raw = firstSocialValue(social.handle ?? social.value ?? '');
  if (!raw) return { platform: fromLabel || 'website', handle: '', href: '' };

  if (looksHosted(raw)) {
    const { host, path } = splitHostPath(raw);
    const platform = platformForHost(host) || fromLabel || 'website';
    const handle = handleFromPath(platform, host, path);
    // A platform host with nothing after it is its front page, not a profile.
    if (platform !== 'website' && !handle) return { platform, handle: '', href: '' };
    // A named platform settles onto its canonical host, so twitter.com and the
    // mobile host become the one address; a website keeps the host it came
    // with, because there the host is the identity.
    const href = platform === 'website' ? `https://${host}${path}` : platformHref(platform, handle);
    return { platform, handle, href };
  }

  const handle = raw.replace(/^@+/, '');
  const platform = fromLabel || 'website';
  return { platform, handle, href: platformHref(platform, handle) };
}

/** The address to open, or '' when there is nothing openable. */
export function socialHrefOf(social: SocialEntry): string {
  return parseSocial(social).href;
}

/** The order the profile shows them in; anything else follows as a website. */
const PLATFORM_ORDER: SocialPlatform[] = ['x', 'linkedin', 'github', 'telegram', 'website'];

/**
 * Every social worth drawing, resolved, de-duplicated and in a fixed order.
 *
 * Sorting on the resolved platform rather than the stored label is what lets a
 * LinkedIn URL filed under 'custom' appear as LinkedIn instead of vanishing.
 */
export function resolveSocials(socials: SocialEntry[] | undefined | null): ResolvedSocial[] {
  const seen = new Set<string>();
  const resolved: ResolvedSocial[] = [];
  for (const entry of socials ?? []) {
    const social = parseSocial(entry);
    if (!social.href || seen.has(social.href)) continue;
    seen.add(social.href);
    resolved.push(social);
  }
  return resolved.sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform),
  );
}
