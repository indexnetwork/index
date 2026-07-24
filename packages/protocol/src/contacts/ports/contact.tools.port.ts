/**
 * contacts/ports — ContactToolDeps tool host port.
 *
 * Narrow port type consumed by createContactTools. The host provides a
 * ContactServiceAdapter and an optional contactsEnabled flag that gates
 * write-path tools (import_contacts, add_contact).
 *
 * NOTE: This type is intentionally defined inline (not derived via Pick from
 * ToolRegistryCompositionDeps in shared/agent/tool.helpers.ts) to avoid a
 * module cycle. ToolRegistryCompositionDeps imports ContactServiceAdapter
 * from shared/interfaces/contact.interface.ts, which after IND-549 forwards
 * to contacts/ports — creating a cycle back here.
 *
 * Structural equivalence with the Pick<ToolRegistryCompositionDeps,
 * "contactService" | "contactsEnabled"> definition in the legacy shim is
 * preserved.
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
