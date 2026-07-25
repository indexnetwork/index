/**
 * @deprecated Canonical location: contacts/ports
 * Retained for backward compatibility during IND-549 migration.
 *
 * IND-549: types and interfaces migrated to src/contacts/domain and
 * src/contacts/ports. This file is a thin compatibility shim.
 */

// Domain value types
export type {
  ContactInput,
  ContactResult,
  ContactImportResult,
  ContactEntry,
  ContactSearchResult,
} from "../../contacts/domain/index.js";

// Persistence port
export type { ContactServiceAdapter } from "../../contacts/ports/index.js";
