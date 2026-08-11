/**
 * contacts/ports — ContactToolDeps tool host port.
 *
 * Narrow port type consumed by createContactTools. The host provides a
 * ContactServiceAdapter and an optional contactsEnabled flag that gates
 * write-path tools (import_contacts, add_contact).
 *
 * NOTE: This type is intentionally defined inline rather than derived from
 * ToolRegistryCompositionDeps, keeping the capability port independent from
 * the all-capability composition contract.
 *
 * Its shape remains structurally equivalent to the matching
 * ToolRegistryCompositionDeps fields.
 *
 * IND-549: extracted from capabilities/contacts.tools.port.ts into the
 * contacts capability's dedicated ports layer.
 */

import type { ContactServiceAdapter } from "./contact.repository.port.js";

/** Host capabilities consumed by contact tools. */
export type ContactToolDeps = {
  contactService: ContactServiceAdapter;
  contactsEnabled?: boolean;
};
