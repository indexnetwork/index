/**
 * contacts/domain — pure contact entity value types and constants.
 *
 * Contains ContactEntry and ContactSearchResult.
 *
 * ## What does NOT live here
 *
 * - ContactServiceAdapter: persistence port — lives in contacts/ports.
 * - ContactToolDeps: tool host port — lives in contacts/ports.
 * - createContactTools: application layer — lives in contacts/application.
 */
export type {
  ContactEntry,
  ContactSearchResult,
} from "./contact.types.js";
