/**
 * The key that ties an emailed sign-in link to this browser.
 *
 * Asking for a link sends only the key's hash; opening the link sends the key
 * itself. Mail scanners that open and click links in incoming mail never saw
 * the request, so they hold no key and cannot spend the link. One key per
 * browser (not per request) keeps every link requested here redeemable here.
 */

const STORAGE_KEY = 'index.signInBrowserKey';

/** The stored key, or null when this browser has none or storage is blocked. */
export function readSignInBrowserKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function createKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Hex SHA-256 of this browser's key, creating the key on first use. Null when
 * storage or Web Crypto is unavailable; the link is then sent unbound.
 */
export async function signInBrowserKeyHash(): Promise<string | null> {
  try {
    let key = window.localStorage.getItem(STORAGE_KEY);
    if (!key) {
      key = createKey();
      window.localStorage.setItem(STORAGE_KEY, key);
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
