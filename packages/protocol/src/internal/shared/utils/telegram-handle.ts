/**
 * Normalize a raw Telegram social value into a bare handle.
 * Trims surrounding whitespace, strips URL prefixes (t.me, telegram.me),
 * strips @ prefix, and strips query/hash/path suffixes.
 * Returns null if the result is not a valid Telegram handle (5-32 alphanumeric/underscore chars).
 */
export function normalizeTelegramHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const stripped = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  return stripped && /^[A-Za-z0-9_]{5,32}$/.test(stripped) ? stripped : null;
}
