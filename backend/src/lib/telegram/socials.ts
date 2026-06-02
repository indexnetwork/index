export interface SocialRow {
  label: string;
  value: string;
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
  const existingTelegram = existingSocials.find((social) => social.label === 'telegram');
  if (existingTelegram?.value === telegramHandle) return null;

  const kept = existingSocials
    .filter((social) => social.label !== 'telegram')
    .map((social) => ({ label: social.label, value: social.value }));

  return [...kept, { label: 'telegram', value: telegramHandle }];
}
