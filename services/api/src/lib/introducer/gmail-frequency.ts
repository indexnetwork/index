import { log } from '../log';

const logger = log.lib.from('introducer/gmail-frequency');

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** Newest sent messages read per sync. */
const MAX_MESSAGES = 2000;
const PAGE_SIZE = 500;
const CONCURRENCY = 10;
const ADDRESS = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Distinct lowercased addresses in To/Cc/Bcc header values like `"Name" <a@b.com>, c@d.com`. */
function addressesIn(values: string[]): Set<string> {
  const found = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(ADDRESS)) found.add(match[0].toLowerCase());
  }
  return found;
}

/**
 * How often the member emailed each address: lowercased address to the number
 * of their sent messages that include it (once per message), over the newest
 * 2,000 sent. Reads headers only.
 * @returns null when Gmail refuses (401/403), fails partway or sends an unreadable body, so the caller ranks without it.
 */
export async function sentFrequency(accessToken: string): Promise<Map<string, number> | null> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const counts = new Map<string, number>();

  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < MAX_MESSAGES) {
    const query = new URLSearchParams({ labelIds: 'SENT', maxResults: String(PAGE_SIZE), ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`${GMAIL_API}/messages?${query}`, { headers }).catch(() => null);
    if (!res?.ok) {
      logger.warn('Gmail list refused', { status: res?.status ?? 'network' });
      return null;
    }
    const body = await res.json().catch(() => null) as { messages?: { id: string }[]; nextPageToken?: string } | null;
    if (!body) {
      logger.warn('Gmail list unreadable');
      return null;
    }
    ids.push(...(body.messages ?? []).map((m) => m.id));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  ids.length = Math.min(ids.length, MAX_MESSAGES);

  let failed = false;
  let next = 0;
  const worker = async () => {
    while (!failed && next < ids.length) {
      const id = ids[next++]!;
      const query = new URLSearchParams([['format', 'metadata'], ['metadataHeaders', 'To'], ['metadataHeaders', 'Cc'], ['metadataHeaders', 'Bcc']]);
      const res = await fetch(`${GMAIL_API}/messages/${id}?${query}`, { headers }).catch(() => null);
      if (!res?.ok) {
        logger.warn('Gmail message refused', { status: res?.status ?? 'network' });
        failed = true;
        return;
      }
      const body = await res.json().catch(() => null) as { payload?: { headers?: { name: string; value: string }[] } } | null;
      if (!body) {
        logger.warn('Gmail message unreadable');
        failed = true;
        return;
      }
      const values = (body.payload?.headers ?? []).map((h) => h.value);
      for (const address of addressesIn(values)) counts.set(address, (counts.get(address) ?? 0) + 1);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failed ? null : counts;
}
