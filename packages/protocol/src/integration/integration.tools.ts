import { z } from 'zod';
import type { DefineTool, ToolDeps } from '../shared/agent/tool.helpers.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { requestContext } from "../shared/observability/request-context.js";
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('ChatTools:Integration');

/**
 * Creates integration tools for the chat agent.
 *
 * Exposes `import_gmail_contacts` which authenticates via the integration adapter,
 * fetches all Gmail contacts (paginated), and imports them as ghost users into the network.
 *
 * @param defineTool - Tool definition helper injected by the tool registry.
 * @param deps - Shared tool dependencies including the integration adapter.
 * @returns An array of tool definitions to register with the chat agent.
 */
export function createIntegrationTools(defineTool: DefineTool, deps: ToolDeps) {
  const { integration, integrationImporter } = deps;

  // import_gmail_contacts creates ghost users, so it is gated behind the
  // CONTACTS_ENABLED flag (injected as deps.contactsEnabled). When disabled the
  // tool is not registered at all (defineTool registers as a side effect).
  if (deps.contactsEnabled !== true) {
    return [];
  }

  const import_gmail_contacts = defineTool({
    name: 'import_gmail_contacts',
    description:
      "Imports contacts from the user's connected Gmail/Google account into their personal network. " +
      "This is the preferred method for importing Google Contacts — handles OAuth authentication, pagination, and deduplication automatically.\n\n" +
      "**Authentication flow:** If Gmail is not yet connected, returns an `authUrl` the user must visit to grant access. " +
      "After they complete OAuth, call this tool again to perform the actual import.\n\n" +
      "**What happens on import:** All Gmail contacts with valid name+email are imported. " +
      "Contacts without existing platform accounts become ghost users (enriched with public profile data from LinkedIn, GitHub, etc.). " +
      "All imported contacts are added to the user's personal network for opportunity discovery.\n\n" +
      "**When to use:** When the user asks to import or sync their Gmail/Google contacts. No parameters needed.\n\n" +
      "**Returns:** Either `{ requiresAuth: true, authUrl }` (user needs to authenticate) or import statistics: " +
      "imported (total), newContacts (ghost users created), existingContacts (already in network), skipped (invalid entries).",
    querySchema: z.object({}),
    handler: async ({ context }) => {
      try {
        const session = await integration.createSession(context.userId);
        const toolkits = await session.toolkits();

        const gmailToolkit = toolkits.items.find(t => t.slug === 'gmail');
        const isConnected = !!gmailToolkit?.connection?.connectedAccount?.id;

        if (!isConnected) {
          logger.info('Gmail not connected, returning auth URL', { userId: context.userId });
          const originUrl = requestContext.getStore()?.originUrl;
          const callbackUrl = originUrl ? `${originUrl}/oauth/callback` : undefined;
          type AuthorizeFn = (toolkit: string, options?: { callbackUrl?: string }) => Promise<{ redirectUrl: string }>;
          const authRequest = await (session.authorize as unknown as AuthorizeFn)('gmail', callbackUrl ? { callbackUrl } : undefined);
          return success({
            requiresAuth: true,
            message: 'Please connect your Gmail account to import contacts.',
            authUrl: authRequest.redirectUrl,
          });
        }

        const importResult = await integrationImporter.importContacts(context.userId, 'gmail');

        logger.info('Gmail contacts imported', {
          userId: context.userId,
          imported: importResult.imported,
          skipped: importResult.skipped,
          newContacts: importResult.newContacts,
          existingContacts: importResult.existingContacts,
        });

        return success({
          message: importResult.newContacts > 0
            ? `Imported ${importResult.imported} contacts from Gmail. ${importResult.newContacts} new, ${importResult.existingContacts} already in your network.`
            : importResult.imported > 0
              ? `All ${importResult.imported} contacts from Gmail were already in your network. No new contacts added.`
              : 'No contacts with valid name and email found in your Gmail account.',
          imported: importResult.imported,
          newContacts: importResult.newContacts,
          existingContacts: importResult.existingContacts,
          skipped: importResult.skipped,
        });
      } catch (err) {
        logger.error('import_gmail_contacts failed', {
          userId: context.userId,
          err,
        });
        return error('Failed to import Gmail contacts. Please try again.');
      }
    },
  });

  return [import_gmail_contacts];
}
