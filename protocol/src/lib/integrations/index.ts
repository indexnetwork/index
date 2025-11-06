export interface IntegrationFile {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
  type: string;
  size: number;
  sourceId?: string; // Optional source ID for tracking specific sources (links, files, etc.)
  metadata?: any; // Optional metadata for provider-specific data (e.g., original message data)
}

export interface UserIdentifier {
  id: string;
  email: string;
  name: string;
  provider: string;
  providerId: string;
  avatar?: string;
}

export interface IntegrationHandler<T = any> {
  enableUserAttribution?: boolean;
  fetchFiles?(integrationId: string, lastSyncAt?: Date): Promise<IntegrationFile[]>;
  fetchObjects?(integrationId: string, lastSyncAt?: Date): Promise<T[]>;
  extractUsers?(objects: T[]): UserIdentifier[];
}

import { log } from '../log';
import { ensureIndexMembership } from './membership-utils';
import { addGenerateIntentsJob } from '../queue/llm-queue';
import { getIntegrationById } from './integration-utils';
import { resolveIntegrationUser } from '../user-utils';
import { notionHandler } from './providers/notion';
import { slackHandler } from './providers/slack';
import { discordHandler } from './providers/discord';
import { googledocsHandler } from './providers/googledocs';
import { airtableHandler } from './providers/airtable';

export { type NotionPage } from './providers/notion';
export { type SlackMessage } from './providers/slack';
export { type DiscordMessage } from './providers/discord';
export { type GoogleDocsDocument } from './providers/googledocs';
export { type AirtableRecord } from './providers/airtable';

const registry: Record<string, IntegrationHandler> = {
  notion: notionHandler,
  slack: slackHandler,
  discord: discordHandler,
  googledocs: googledocsHandler,
  airtable: airtableHandler,
};

export const handlers = registry;

export function registerIntegration(type: string, handler: IntegrationHandler) {
  registry[type] = handler;
}

// ============================================================================
// Integration Object Processing
// ============================================================================

const MAX_INTENTS_PER_USER = 3;

/**
 * Process integration objects with flexible user attribution.
 * 
 * With attribution enabled:
 * - Extracts users from objects
 * - Resolves each user (creates account if needed)
 * - Adds users as index members
 * - Queues intent generation per user
 * 
 * Without attribution:
 * - Queues intent generation for integration owner only
 * - All objects processed under single user
 */
export async function processObjects<T = any>(
  objects: T[],
  integration: { id: string; indexId?: string | null; userId: string; enableUserAttribution?: boolean },
  handler: IntegrationHandler<T>
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!objects.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  const integrationDetails = await getIntegrationById(integration.id);
  if (!integrationDetails) {
    log.error('Integration not found for processing', { integrationId: integration.id });
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  // Check if attribution is enabled (from DB or handler default)
  const enableAttribution = integration.enableUserAttribution ?? handler.enableUserAttribution ?? false;

  if (enableAttribution && handler.extractUsers && integration.indexId) {
    // Attribution mode: extract users and process per user
    return await attributeToUsers(objects, { id: integration.id, indexId: integration.indexId }, handler);
  } else {
    // No attribution mode: process for integration owner only
    return await attributeToOwner(objects, integration, integrationDetails.userId);
  }
}

/**
 * Attribute objects to extracted users.
 * Extracts users, resolves them, adds to index, and generates intents per user.
 */
async function attributeToUsers<T>(
  objects: T[],
  integration: { id: string; indexId: string },
  handler: IntegrationHandler<T>
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  log.info('Processing objects with user attribution', { count: objects.length });

  if (!handler.extractUsers) {
    log.error('Handler missing extractUsers function');
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  // Step 1: Extract unique users from objects
  const userIdentifiers = handler.extractUsers(objects);
  log.info('Extracted users', { count: userIdentifiers.length });

  if (userIdentifiers.length === 0) {
    log.warn('No users extracted from objects');
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  // Step 2: Resolve each user and add to index
  const resolvedUsers = new Map<string, { id: string; name: string; email: string; isNewUser: boolean }>();
  let newUsersCreated = 0;

  for (const userIdentifier of userIdentifiers) {
    try {
      const resolvedUser = await resolveIntegrationUser({
        email: userIdentifier.email,
        providerId: userIdentifier.providerId,
        name: userIdentifier.name,
        provider: userIdentifier.provider as any,
        avatar: userIdentifier.avatar,
        updateEmptyFields: userIdentifier.provider === 'slack' // Only Slack has avatars
      });
      
      if (!resolvedUser) {
        log.error('Failed to resolve user', { 
          providerId: userIdentifier.providerId,
          email: userIdentifier.email 
        });
        continue;
      }

      if (resolvedUser.isNewUser) {
        newUsersCreated++;
      }

      // Add user as index member
      await ensureIndexMembership(resolvedUser.id, integration.indexId);

      resolvedUsers.set(userIdentifier.providerId, resolvedUser);

      log.debug('User resolved and added to index', {
        providerId: userIdentifier.providerId,
        userId: resolvedUser.id,
        email: resolvedUser.email,
        isNewUser: resolvedUser.isNewUser
      });
    } catch (error) {
      log.error('Failed to resolve user', {
        providerId: userIdentifier.providerId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  log.info('Users resolved', { resolvedCount: resolvedUsers.size, newUsersCreated });

  if (resolvedUsers.size === 0) {
    log.warn('No users successfully resolved');
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated };
  }

  // Step 3: Queue intent generation per user
  let totalIntentsGenerated = 0;


  for (const [providerId, user] of resolvedUsers) {
    try {
      // Extract datetime from objects if available
      let createdAt: Date | undefined;
      if (objects.length > 0) {
        const firstObj = objects[0] as any;
        if (firstObj?.metadata?.createdAt) {
          createdAt = firstObj.metadata.createdAt;
        }
      }

      // Queue intent generation for this user
      await addGenerateIntentsJob({
        userId: user.id,
        sourceId: integration.id,
        sourceType: 'integration',
        objects: objects,
        instruction: `Generate intents based on integration data`,
        indexId: integration.indexId,
        intentCount: MAX_INTENTS_PER_USER,
        ...(createdAt && { createdAt })
      }, 6);

      totalIntentsGenerated++;
    } catch (error) {
      log.error('Failed to queue intent generation', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  log.info('Object processing with attribution complete', {
    intentsGenerated: totalIntentsGenerated,
    usersProcessed: resolvedUsers.size,
    newUsersCreated
  });

  return {
    intentsGenerated: totalIntentsGenerated,
    usersProcessed: resolvedUsers.size,
    newUsersCreated
  };
}

/**
 * Attribute objects to integration owner.
 * Generates intents for integration owner only, no user extraction.
 */
async function attributeToOwner<T>(
  objects: T[],
  integration: { id: string; indexId?: string | null },
  integrationOwnerId: string
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  log.info('Processing objects without user attribution', {
    count: objects.length,
    ownerId: integrationOwnerId
  });

  try {
    // If there's an indexId, ensure integration owner is index member
    if (integration.indexId) {
      await ensureIndexMembership(integrationOwnerId, integration.indexId);
    }

    // Extract datetime from objects if available
    let createdAt: Date | undefined;
    if (objects.length > 0) {
      const firstObj = objects[0] as any;
      if (firstObj?.metadata?.createdAt) {
        createdAt = firstObj.metadata.createdAt;
      }
    }

    // Queue intent generation for integration owner with all objects
    await addGenerateIntentsJob({
      userId: integrationOwnerId,
      sourceId: integration.id,
      sourceType: 'integration',
      objects: objects,
      instruction: `Generate intents based on integration data`,
      indexId: integration.indexId || undefined,
      intentCount: MAX_INTENTS_PER_USER,
      ...(createdAt && { createdAt })
    }, 6);

    log.info('Object processing without attribution complete', {
      intentsGenerated: 1,
      usersProcessed: 1,
      newUsersCreated: 0
    });

    return {
      intentsGenerated: 1,
      usersProcessed: 1,
      newUsersCreated: 0
    };
  } catch (error) {
    log.error('Failed to process objects without attribution', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }
}
