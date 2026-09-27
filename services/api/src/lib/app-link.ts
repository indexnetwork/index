const APP_URL = (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');

/**
 * Canonical public link for an entity. The Mac app claims these as universal
 * links; the web handoff routes the rest to Hermes, the web page, or /download.
 *
 * @param kind - `u` user, `i` intent, `o` opportunity.
 * @param id - Entity id.
 * @returns Absolute https URL.
 */
export function appLink(kind: 'u' | 'i' | 'o', id: string): string {
  return `${APP_URL}/${kind}/${encodeURIComponent(id)}`;
}
