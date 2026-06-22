/**
 * Contacts & ghost-user feature flag.
 *
 * Gates the contact import / manual-add code paths — the only paths that mint
 * ghost users. Reading, searching, and removing existing contacts, and the
 * opportunity-acceptance contact links written directly via the database
 * adapter, are intentionally NOT gated.
 *
 * Disabled when unset: the feature is OFF unless `CONTACTS_ENABLED` is exactly
 * the string `"true"`. This is a fail-closed default.
 */

/** @returns true when contact import / ghost-user creation is enabled. */
export function isContactsEnabled(): boolean {
  return process.env.CONTACTS_ENABLED === 'true';
}

/**
 * Thrown by the ContactService write/create paths when the contacts feature is
 * disabled. Acts as a defense-in-depth backstop behind the route guards and MCP
 * tool gating, so no surface (HTTP, MCP, CLI) can mint ghost users when off.
 */
export class ContactsDisabledError extends Error {
  constructor(message = 'Contacts feature is disabled') {
    super(message);
    this.name = 'ContactsDisabledError';
  }
}
