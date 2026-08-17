/**
 * contacts — ContactToolDeps tool host port.
 *
 * Narrow port type consumed by createContactTools. The host provides a
 * ContactServiceAdapter.
 *
 * NOTE: This type is intentionally defined inline rather than derived from
 * ToolRegistryCompositionDeps, keeping the capability port independent from
 * the all-capability composition contract.
 *
 * Its shape remains structurally equivalent to the matching
 * ToolRegistryCompositionDeps fields.
 *
 * This root-level contract keeps the capability dependency surface compact.
 */

import type { ContactServiceAdapter } from "./contact.repository.port.js";

/** Host capabilities consumed by contact tools. */
export type ContactToolDeps = {
  contactService: ContactServiceAdapter;
};
