import { isContactsEnabled } from '../lib/contacts-feature';

/**
 * Environment-based guard that gates the contact import / manual-add endpoints.
 * Returns void when contacts are enabled; throws (mapped to 404 in main.ts) when
 * disabled, so disabled endpoints behave as if they do not exist.
 * Enabled only when CONTACTS_ENABLED === 'true' (disabled when unset).
 */
export const ContactsEnabledGuard = async (_req: Request): Promise<void> => {
  if (!isContactsEnabled()) {
    throw new Error('Not found');
  }
};
