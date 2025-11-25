import { log } from '../log';
import { getIntegrationById } from './integration-utils';
import { resolveFileUser } from '../user-utils';
import { DirectorySyncConfig, userIntegrations, indexMembers, indexes } from '../schema';
import db from '../db';
import { eq, and } from 'drizzle-orm';
import { addMemberToIndex } from '../index-members';

export interface Source {
  id: string;
  name: string;
  subSources?: Array<{ id: string; name: string }>;
}

export interface Column {
  id: string;
  name: string;
  type?: string;
}

export interface DirectoryRecord {
  [columnName: string]: any;
}

export interface SyncResult {
  success: boolean;
  membersAdded: number;
  membersUpdated: number;
  errors: Array<{ record: any; error: string }>;
  status: 'success' | 'error' | 'partial';
  error?: string;
}

/**
 * Provider-agnostic interface for directory sync
 */
export interface DirectorySyncProvider {
  listSources(integrationId: string): Promise<Source[]>;
  getSourceSchema(integrationId: string, sourceId: string, subSourceId?: string): Promise<Column[]>;
  fetchRecords(integrationId: string, config: DirectorySyncConfig): Promise<DirectoryRecord[]>;
}

/**
 * Main directory sync function - syncs records from a provider to index members
 */
export async function syncDirectoryMembers(
  integrationId: string,
  provider: DirectorySyncProvider
): Promise<SyncResult> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Integration not found'
      };
    }

    if (!integration.indexId) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Directory sync requires an index integration'
      };
    }

    const config = integration.config?.directorySync;
    if (!config || !config.enabled) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Directory sync not configured or disabled'
      };
    }

    // Validate email mapping exists
    if (!config.columnMappings.email) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Email column mapping is required'
      };
    }

    log.info('Starting directory sync', {
      integrationId,
      indexId: integration.indexId,
      source: config.source
    });

    // Fetch records from provider
    const records = await provider.fetchRecords(integrationId, config);
    
    if (records.length === 0) {
      log.info('No records found for directory sync', { integrationId });
      return {
        success: true,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'success'
      };
    }

    log.info('Fetched records for directory sync', {
      integrationId,
      recordCount: records.length
    });

    // Get index prompt for default member prompt
    const indexData = await db.select({ prompt: indexes.prompt })
      .from(indexes)
      .where(eq(indexes.id, integration.indexId))
      .limit(1);

    const indexPrompt = indexData[0]?.prompt || null;

    // Profile fields that update user profile if empty
    const profileFields = ['name', 'intro', 'location', 'twitter', 'website'];
    
    const addedMembers: string[] = [];
    const errors: Array<{ record: any; error: string }> = [];

    for (const record of records) {
      try {
        // Extract email (required)
        const email = record[config.columnMappings.email]?.trim();
        if (!email) {
          errors.push({ record, error: 'Missing email' });
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.push({ record, error: `Invalid email format: ${email}` });
          continue;
        }

        // Extract profile fields
        const name = config.columnMappings.name 
          ? record[config.columnMappings.name]?.trim() || email.split('@')[0]
          : email.split('@')[0];
        const intro = config.columnMappings.intro 
          ? record[config.columnMappings.intro]?.trim() || undefined
          : undefined;
        const location = config.columnMappings.location
          ? record[config.columnMappings.location]?.trim() || undefined
          : undefined;

        // Prepare socials object
        const socials: any = {};
        if (config.columnMappings.twitter && record[config.columnMappings.twitter]?.trim()) {
          // Remove @ symbol if present
          let twitterValue = record[config.columnMappings.twitter].trim();
          if (twitterValue.startsWith('@')) {
            twitterValue = twitterValue.substring(1);
          }
          socials.x = twitterValue;
        }
        if (config.columnMappings.linkedin && record[config.columnMappings.linkedin]?.trim()) {
          socials.linkedin = record[config.columnMappings.linkedin].trim();
        }
        if (config.columnMappings.github && record[config.columnMappings.github]?.trim()) {
          socials.github = record[config.columnMappings.github].trim();
        }
        if (config.columnMappings.website && record[config.columnMappings.website]?.trim()) {
          socials.websites = [record[config.columnMappings.website].trim()];
        }

        // Find or create user
        const user = await resolveFileUser({
          email,
          name: name || email.split('@')[0],
          avatar: undefined,
          intro,
          location,
          socials: Object.keys(socials).length > 0 ? socials : undefined
        });

        if (!user) {
          errors.push({ record, error: 'Failed to create/find user' });
          continue;
        }

        // Check if already a member
        const existingMember = await db.select({ userId: indexMembers.userId })
          .from(indexMembers)
          .where(and(
            eq(indexMembers.indexId, integration.indexId),
            eq(indexMembers.userId, user.id)
          ))
          .limit(1);

        if (existingMember.length > 0) {
          // Already a member, skip
          continue;
        }

        // Collect metadata from unmapped columns
        const metadata: Record<string, string | string[]> = {};
        const mappedColumns = [
          config.columnMappings.email,
          config.columnMappings.name,
          config.columnMappings.intro,
          config.columnMappings.location,
          config.columnMappings.twitter,
          config.columnMappings.linkedin,
          config.columnMappings.github,
          config.columnMappings.website
        ].filter(Boolean) as string[];

        for (const [key, value] of Object.entries(record)) {
          if (!mappedColumns.includes(key) && value) {
            const stringValue = String(value).trim();
            if (stringValue) {
              // Check if value contains multiple values (comma-separated)
              if (stringValue.includes(',')) {
                metadata[key] = stringValue.split(',').map(v => v.trim()).filter(v => v);
              } else {
                metadata[key] = stringValue;
              }
            }
          }
        }

        // Add member to index
        const addResult = await addMemberToIndex({
          indexId: integration.indexId,
          userId: user.id,
          role: 'member',
          prompt: indexPrompt,
          autoAssign: true,
          metadata: Object.keys(metadata).length > 0 ? metadata : null
        });

        if (!addResult.success) {
          throw new Error(addResult.error || 'Failed to add member');
        }

        addedMembers.push(email);
      } catch (error) {
        log.error('Error processing directory sync record', {
          integrationId,
          error: error instanceof Error ? error.message : String(error)
        });
        errors.push({
          record,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Update sync status in integration config
    const status: 'success' | 'error' | 'partial' = errors.length === 0 
      ? 'success' 
      : addedMembers.length === 0 
        ? 'error' 
        : 'partial';

    const updateConfig: DirectorySyncConfig = {
      ...config,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: status,
      lastSyncError: status !== 'success' && errors.length > 0 
        ? `${errors.length} record(s) failed` 
        : undefined,
      memberCount: addedMembers.length
    };

    // Update integration config in database
    await db.update(userIntegrations)
      .set({ 
        config: { directorySync: updateConfig },
        updatedAt: new Date()
      } as any)
      .where(eq(userIntegrations.id, integrationId));

    log.info('Directory sync completed', {
      integrationId,
      membersAdded: addedMembers.length,
      errors: errors.length,
      status
    });

    return {
      success: status !== 'error',
      membersAdded: addedMembers.length,
      membersUpdated: 0, // We don't update existing members, only add new ones
      errors,
      status
    };
  } catch (error) {
    log.error('Directory sync error', {
      integrationId,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      success: false,
      membersAdded: 0,
      membersUpdated: 0,
      errors: [],
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

