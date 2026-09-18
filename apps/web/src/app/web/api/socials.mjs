/**
 * Social links: one normalizer for everything that stores, edits, draws or
 * opens one.
 *
 * Values arrive in every shape a person or a scraper can produce: a full URL,
 * a host with a path, a bare handle, an @handle, and — from enrichment — a
 * few of those packed into a single field separated by commas. The label is no
 * steadier. The API's vocabulary is linkedin|twitter|github|telegram|custom,
 * and 'custom' is also where every website lands, so a LinkedIn URL routinely
 * arrives labelled 'custom'.
 *
 * The rule that keeps a link working: when the value carries a host, the value
 * decides where it goes and is never reassembled. Rebuilding from a label the
 * value disagrees with is what produced links like
 * https://eugene-pavlenko-b31a0430/ — a linkedin.com/in/… value stripped down
 * to its handle and then put back together with a label that had no host to
 * give it. The label is consulted only for a bare handle, which carries no
 * destination of its own.
 */

/** Where a bare handle lives, per platform. */
export const SOCIAL_PREFIX = {
  x: 'x.com/',
  twitter: 'x.com/',
  linkedin: 'linkedin.com/in/',
  github: 'github.com/',
  telegram: 't.me/',
};

/**
 * Labels that name a bucket rather than a platform, so the value decides.
 * 'custom' is the API's; the rest were written by older builds of this app.
 */
const GENERIC_LABELS = new Set(['', 'custom', 'website', 'web', 'link', 'site', 'url', 'other']);

/** Hosts we can name. Anything else is a website, which is not a lesser kind. */
const PLATFORM_HOSTS = [
  [/^(mobile\.)?(x\.com|twitter\.com)$/, 'x'],
  [/^([a-z0-9-]+\.)?linkedin\.com$/, 'linkedin'],
  [/^github\.com$/, 'github'],
  [/^(t\.me|telegram\.me|telegram\.dog)$/, 'telegram'],
];

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The first address in a field that may hold several.
 *
 * Enrichment writes discoveries like "tidemid , https://instagram.com/nick/"
 * into one value; used whole it became a single unopenable link
 * (https://x.com/tidemid%20,%20https://…). A URL contains none of these
 * separators, so splitting on them cannot damage a well-formed one.
 * @param {unknown} raw
 * @returns {string}
 */
export function firstSocialValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const [first] = text.split(/[\s,;|]+/).filter(Boolean);
  // Trailing sentence punctuation rides along when these are scraped from prose.
  return (first || '').replace(/[),.;:]+$/, '');
}

/** Whether a value names a host of its own, rather than being a bare handle. */
function looksHosted(value) {
  if (SCHEME.test(value)) return true;
  const head = value.replace(/^\/\//, '').split('/')[0];
  // A dotted label is a domain; "eugenepx" is not, and treating it as one is
  // exactly how https://eugenepx/ got rendered as a link.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(head);
}

/** Split a hosted value into a lowercase bare host and its path. */
function splitHostPath(value) {
  let text = value.replace(SCHEME, '').replace(/^\/\//, '');
  text = text.replace(/^www\./i, '');
  const cut = text.search(/[/?#]/);
  const host = (cut === -1 ? text : text.slice(0, cut)).toLowerCase().replace(/\.$/, '');
  const path = (cut === -1 ? '' : text.slice(cut)).replace(/\/+$/, '');
  return { host, path };
}

function platformForHost(host) {
  for (const [pattern, platform] of PLATFORM_HOSTS) {
    if (pattern.test(host)) return platform;
  }
  return '';
}

/** The platform an entry's own label names, or '' when it names a bucket. */
function labelPlatform(social) {
  const id = String(social.id ?? social.label ?? social.platform ?? '').toLowerCase().trim();
  if (GENERIC_LABELS.has(id)) return '';
  if (id === 'twitter' || id === 'x') return 'x';
  return SOCIAL_PREFIX[id] ? id : '';
}

/** The identifying part of a hosted value: no scheme, no host, no /in/. */
function handleFromPath(platform, host, path) {
  if (platform === 'website') return `${host}${path}`;
  const rest = path.replace(/^\//, '').replace(/^@/, '');
  // LinkedIn keeps people under /in/ and everything else (companies, schools)
  // one segment up, so only /in/ is dropped: what is left still says which.
  return platform === 'linkedin' ? rest.replace(/^in\//, '') : rest;
}

/**
 * The canonical address for a platform plus a handle that is already bare.
 *
 * A handle that kept a slash is a path under the platform's own host rather
 * than a username, so LinkedIn's /in/ is left off for those — otherwise a
 * company page comes back as linkedin.com/in/company/name. Takes the handle as
 * given and never re-reads it as a URL, so it can be used while parsing one.
 */
function platformHref(platform, handle) {
  if (!handle) return '';
  if (platform === 'linkedin') {
    return handle.includes('/') ? `https://linkedin.com/${handle}` : `https://linkedin.com/in/${handle}`;
  }
  const prefix = SOCIAL_PREFIX[platform];
  return prefix ? `https://${prefix}${handle}` : '';
}

/**
 * The address for a field the person typed into, which may be a bare handle or
 * a whole URL pasted out of a browser.
 *
 * A pasted URL says where it goes, so it is honoured even in another field's
 * row; the row only decides what a bare handle means.
 * @param {string} platform
 * @param {string} handle
 * @returns {string}
 */
export function buildSocialHref(platform, handle) {
  const value = String(handle ?? '').trim().replace(/^@+/, '').replace(/\/+$/, '');
  if (!value) return '';
  if (looksHosted(value)) return parseSocial({ id: platform, handle: value }).href;
  // A website has to be a real address. A bare word is someone's username that
  // lost its platform along the way, and linking it would only 404.
  return platformHref(platform, value);
}

/**
 * Resolve any stored or typed entry to {platform, handle, href}.
 *
 * `href` is '' when the entry has no openable destination; callers hide those
 * rather than rendering a dead link.
 * @param {{id?: string, label?: string, platform?: string, handle?: string, value?: string}} social
 * @returns {{platform: string, handle: string, href: string}}
 */
export function parseSocial(social = {}) {
  const fromLabel = labelPlatform(social);
  const raw = firstSocialValue(social.handle ?? social.value ?? '');
  if (!raw) return { platform: fromLabel || 'website', handle: '', href: '' };

  if (looksHosted(raw)) {
    const { host, path } = splitHostPath(raw);
    const platform = platformForHost(host) || fromLabel || 'website';
    const handle = handleFromPath(platform, host, path);
    // A platform host with nothing after it is the platform's front page, not
    // anybody's profile.
    if (platform !== 'website' && !handle) return { platform, handle: '', href: '' };
    // A named platform is rebuilt onto its canonical host, so twitter.com and
    // the mobile host settle to the one address; a website keeps the host it
    // came with, because there it is the identity.
    const href = platform === 'website' ? `https://${host}${path}` : platformHref(platform, handle);
    return { platform, handle, href };
  }

  const handle = raw.replace(/^@+/, '');
  const platform = fromLabel || 'website';
  return { platform, handle, href: platformHref(platform, handle) };
}

/** Platform id, for choosing a glyph. */
export function socialPlatformOf(social = {}) {
  return parseSocial(social).platform;
}

/** Just the part that identifies the person, for display next to the glyph. */
export function socialHandleOf(social = {}) {
  return parseSocial(social).handle;
}

/** The address to open, or '' when there is nothing openable. */
export function socialHrefOf(social = {}) {
  return parseSocial(social).href;
}

/**
 * The label to store an entry under.
 *
 * The API's set is fixed (linkedin|twitter|github|telegram|custom, see the
 * protocol's detectSocialLabel) and every other surface filters on it, so the
 * platform ids used for drawing are translated back on the way out: 'x' is
 * stored as 'twitter'. A label outside the set silently loses the link — it
 * renders nowhere and enrichment skips it.
 * @param {Object} social
 * @returns {string}
 */
export function socialApiLabelOf(social = {}) {
  const platform = social.platform || socialPlatformOf(social);
  if (platform === 'x' || platform === 'twitter') return 'twitter';
  return SOCIAL_PREFIX[platform] ? platform : 'custom';
}

/** {id, prefix, handle} for editing, from any of the shapes above. */
export function normalizeSocial(social = {}) {
  const { platform, handle } = parseSocial(social);
  return { id: platform, prefix: SOCIAL_PREFIX[platform] || '', handle };
}

/** The platforms the editor always offers, in the order it shows them. */
export const EDITABLE_PLATFORMS = ['x', 'linkedin', 'github', 'telegram'];

/**
 * Bucket a stored social list into the editor's fixed fields plus websites.
 *
 * Every field is always present so it can be cleared and filled again; an
 * editor that only lists what exists has no way back once a row is removed.
 * @param {Array<Object>} socials
 * @returns {{handles: Record<string, string>, websites: string[]}}
 */
export function splitProfileSocials(socials) {
  const handles = {};
  for (const platform of EDITABLE_PLATFORMS) handles[platform] = '';
  const websites = [];

  for (const entry of Array.isArray(socials) ? socials : []) {
    const { platform, handle, href } = parseSocial(entry);
    if (Object.prototype.hasOwnProperty.call(handles, platform)) {
      // Duplicates happen (enrichment and the person can both supply one);
      // the first that resolves wins and the rest are dropped rather than
      // stacking up as unlabelled extras.
      if (!handles[platform] && handle) handles[platform] = handle;
    } else if (href) {
      const shown = href.replace(SCHEME, '');
      if (!websites.includes(shown)) websites.push(shown);
    }
  }
  return { handles, websites };
}

/**
 * The editor's fields back into the API's {label, value} rows.
 * @param {Record<string, string>} handles
 * @param {string[]} websites
 * @returns {Array<{label: string, value: string}>}
 */
export function buildProfileSocials(handles, websites) {
  const rows = [];
  const add = (platform, typed) => {
    const parsed = parseSocial({ id: platform, handle: typed });
    if (!parsed.href) return;
    // 'custom' is the one label the per-user uniqueness index exempts, so more
    // than one website can be stored; a second linkedin would be rejected, and
    // that is reachable by pasting one platform's URL into another's row.
    const label = socialApiLabelOf({ platform: parsed.platform });
    const clash = rows.some((row) => row.value === parsed.href || (label !== 'custom' && row.label === label));
    if (!clash) rows.push({ label, value: parsed.href });
  };
  for (const platform of EDITABLE_PLATFORMS) add(platform, (handles || {})[platform] || '');
  for (const site of Array.isArray(websites) ? websites : []) add('website', site);
  return rows;
}
