import { createHash } from 'crypto';

import { S3StorageAdapter } from '../../adapters/storage.adapter';
import { log } from '../log';

const logger = log.lib.from('introducer/avatar');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** An image fetched for a contact's seat, ready to store. */
interface Picture {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

/**
 * Only public https hosts: the photo URL comes from web research, so it must
 * never reach a private address, an IP literal or an internal hostname.
 */
function isPublicImageUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  if (/(^|\.)(localhost|local|internal|railway\.internal)$/.test(host)) return null;
  return url;
}

/** Fetch one image, or null when it isn't a reasonably sized jpeg, png, webp or gif. */
async function fetchPicture(raw: string, headers?: Record<string, string>): Promise<Picture | null> {
  const url = isPublicImageUrl(raw);
  if (!url) return null;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'image/*', ...headers } });
    if (!res.ok || !isPublicImageUrl(res.url)) return null;
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const extension = TYPES[contentType];
    if (!extension || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;
    return { buffer, contentType, extension };
  } catch {
    return null;
  }
}

/** Gravatar for this email, if its owner set one (`d=404` answers 404 otherwise). */
function gravatarUrl(email: string): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `https://gravatar.com/avatar/${hash}?s=256&d=404`;
}

/** A PNG's pixel size from its header, or null when it isn't a PNG. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * The GitHub avatar of a profile link, unless it is the default identicon
 * GitHub draws for people who never uploaded a photo. Asked for at 256px, a
 * real photo comes back at 256px; the identicon ignores the size and is
 * always a 420px PNG.
 */
async function githubPicture(profileUrl: string): Promise<Picture | null> {
  const login = /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/?$/.exec(profileUrl.trim())?.[1];
  if (!login) return null;
  const photo = await fetchPicture(`https://github.com/${login}.png?size=256`);
  const size = photo ? pngSize(photo.buffer) : null;
  if (!photo || (size && size.width === 420 && size.height === 420)) return null;
  return photo;
}

/**
 * Public handles in someone's profile links that unavatar.io can turn into a
 * photo. Only handles go to unavatar, never an email address.
 */
function unavatarSources(socials: string[]): string[] {
  const out: string[] = [];
  for (const raw of socials) {
    let url: URL;
    try { url = new URL(raw.trim()); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    const handle = (h: string | undefined) => (h && /^[A-Za-z0-9_.-]{1,64}$/.test(h) ? h : null);
    let source: string | null = null;
    if (host === 'x.com' || host === 'twitter.com') source = handle(parts[0]) && `x/${parts[0]}`;
    else if (host === 'bsky.app' && parts[0] === 'profile') source = handle(parts[1]) && `bluesky/${parts[1]}`;
    else if (host === 'instagram.com') source = handle(parts[0]) && `instagram/${parts[0]}`;
    else if (host === 't.me') source = handle(parts[0]) && `telegram/${parts[0]}`;
    if (source && !out.includes(source)) out.push(source);
  }
  return out;
}

/** A photo from unavatar.io for one handle; `fallback=false` makes it answer 404 rather than a placeholder. */
async function unavatarPicture(source: string): Promise<Picture | null> {
  const key = process.env.UNAVATAR_API_KEY;
  return fetchPicture(`https://unavatar.io/${source}?fallback=false`, key ? { 'x-api-key': key } : undefined);
}

let storage: S3StorageAdapter | null = null;
function storageAdapter(): S3StorageAdapter | null {
  if (storage) return storage;
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_REGION } = process.env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  storage = new S3StorageAdapter({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    bucket: S3_BUCKET,
  });
  return storage;
}

/**
 * Find a photo of someone Introduce looked up and store it as their seat's
 * avatar. Tries, in order: the photo research found on their own public
 * pages, the photo they set on their own Google account, their Gravatar,
 * their GitHub avatar, then unavatar.io for their public X, Bluesky,
 * Instagram or Telegram handle. The image is copied into our storage so
 * nobody's browser loads it from the source site.
 *
 * @param seatUserId - The seat to store it for.
 * @param person - Their email, the photo URL research returned (may be
 *   empty), their Google profile photo if known, and the profile links
 *   research found.
 * @returns The stored avatar key, or null when no source had a photo.
 */
export async function findSeatAvatar(
  seatUserId: string,
  person: { email: string; photo?: string | null; googlePhoto?: string | null; socials: string[] },
): Promise<string | null> {
  const store = storageAdapter();
  if (!store) return null;
  const sources: (() => Promise<Picture | null>)[] = [
    async () => (person.photo?.trim() ? fetchPicture(person.photo.trim()) : null),
    async () => (person.googlePhoto ? fetchPicture(person.googlePhoto) : null),
    async () => fetchPicture(gravatarUrl(person.email)),
    async () => {
      for (const link of person.socials) {
        const picture = await githubPicture(link);
        if (picture) return picture;
      }
      return null;
    },
    async () => {
      for (const source of unavatarSources(person.socials)) {
        const picture = await unavatarPicture(source);
        if (picture) return picture;
      }
      return null;
    },
  ];
  for (const source of sources) {
    const picture = await source();
    if (!picture) continue;
    try {
      return await store.uploadAvatar(picture.buffer, seatUserId, picture.extension, picture.contentType);
    } catch (error) {
      logger.warn('Storing a seat avatar failed', { error: String(error) });
      return null;
    }
  }
  return null;
}
