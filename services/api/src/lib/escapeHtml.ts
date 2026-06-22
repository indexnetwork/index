const ALLOWED_URL_SCHEMES = ['https:', 'http:', 'mailto:'];

/**
 * Returns the URL if its scheme is https, http, or mailto; otherwise returns '#'.
 * Invalid URLs (e.g. unparseable) also yield '#'.
 */
export function sanitizeUrlForHref(url: string): string {
  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol.toLowerCase();
    return ALLOWED_URL_SCHEMES.includes(scheme) ? url : '#';
  } catch {
    return '#';
  }
}

export const escapeHtml = (str: string) => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}