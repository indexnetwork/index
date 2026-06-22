// Integration types are now managed by Composio.
// See protocol/src/lib/protocol/interfaces/integration.interface.ts for IntegrationConnection.

/** Result of importing contacts in bulk. */
export interface ImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/** Input for a single contact. */
export interface ContactInput {
  name: string;
  email: string;
}

/** Result of resolving contacts to user IDs (without membership changes). */
export interface ResolveResult {
  userIds: string[];
  newGhostIds: string[];
  skipped: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/**
 * Interface for importing contacts into a user's network.
 * Implemented by ContactService; injected into IntegrationService to avoid direct service-to-service import.
 */
export interface ContactImporter {
  importContacts(userId: string, contacts: ContactInput[]): Promise<ImportResult>;
  resolveUsers(userId: string, contacts: ContactInput[]): Promise<ResolveResult>;
}
