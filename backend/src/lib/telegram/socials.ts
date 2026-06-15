export interface SocialRow {
  label: string;
  value: string;
}

/**
 * Normalize a Telegram social value into the canonical DB representation.
 * Stored Telegram handles are bare handles only: no leading @, no t.me URL.
 *
 * @param raw - Raw Telegram handle or URL.
 * @returns Bare Telegram handle, or null when the value is not routable.
 */
export function normalizeTelegramSocialValue(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const stripped = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  return /^[A-Za-z0-9_]{5,32}$/.test(stripped) ? stripped : null;
}

/**
 * Merge a Telegram handle into a user's social rows without clobbering unrelated labels.
 *
 * @param existingSocials - Existing social rows for the user.
 * @param telegramHandle - Normalized Telegram handle without an @ prefix.
 * @returns The replacement social list, or null when the stored Telegram handle is already unchanged.
 */
export function mergeTelegramHandleIntoSocials(
  existingSocials: SocialRow[],
  telegramHandle: string,
): SocialRow[] | null {
  const normalizedTelegramHandle = normalizeTelegramSocialValue(telegramHandle);
  if (!normalizedTelegramHandle) return null;

  const existingTelegram = existingSocials.find((social) => social.label === 'telegram');
  if (existingTelegram?.value === normalizedTelegramHandle) return null;

  const kept = existingSocials
    .filter((social) => social.label !== 'telegram')
    .map((social) => ({ label: social.label, value: social.value }));

  return [...kept, { label: 'telegram', value: normalizedTelegramHandle }];
}
