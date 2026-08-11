/**
 * contacts/domain — pure contact entity value types and constants.
 *
 * Contains ContactInput, ContactResult, ContactImportResult, ContactEntry,
 * and ContactSearchResult.
 *
 * ## What does NOT live here
 *
 * - ContactServiceAdapter: persistence port — lives in contacts/ports.
 * - ContactToolDeps: tool host port — lives in contacts/ports.
 * - createContactTools: application layer — lives in contacts/application.
 * - generateInviteMessage: application layer — lives in contacts/application.
 *
 * IND-549: canonical domain layer for the contacts capability.
 */
export type {
  ContactInput,
  ContactResult,
  ContactImportResult,
  ContactEntry,
  ContactSearchResult,
} from "./contact.types.js";
