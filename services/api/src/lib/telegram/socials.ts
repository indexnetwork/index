/**
 * Normalize a Telegram social value into the canonical DB representation.
 * Stored Telegram handles are bare, lowercase handles only: no leading @, no
 * t.me URL. Telegram usernames are case-insensitive (@Seref and @seref resolve
 * to the same account), so case is folded to keep comparisons drift-free.
 *
 * @param raw - Raw Telegram handle or URL.
 * @returns Bare lowercase Telegram handle, or null when the value is not routable.
 */
export function normalizeTelegramSocialValue(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const stripped = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  return /^[A-Za-z0-9_]{5,32}$/.test(stripped) ? stripped.toLowerCase() : null;
}
