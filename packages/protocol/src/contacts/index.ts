/**
 * contacts — domain-first module root.
 *
 * Re-exports the curated public surface. Other modules inside the contacts
 * capability import directly from contacts/domain, contacts/application, or
 * contacts/ports; this barrel is for cross-capability consumers that must
 * go through the contacts public surface.
 *
 * IND-549: canonical home for contact management capabilities.
 *
 * Retains participant reachability semantics: all operations are scoped to
 * the owning user's personal network. Contacts are participants with whom
 * opportunity discovery is run.
 *
 * Compatibility path:
 * - capabilities/contacts.facade.ts — thin re-export via contacts/public
 */
export * from "./public/index.js";
