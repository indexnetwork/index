import type { IntegrationHandler } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

// Constants
const BASE_LIMIT = 50;
const RECORD_LIMIT = 100;
const MAX_INTENTS_PER_BASE = 5;
const RATE_LIMIT_DELAY = 200; // 200ms between requests (5 req/sec)

export interface AirtableRecord {
  id: string;
  fields: Record<string, any>; // Dynamic fields
  createdTime: string;
  baseId: string;
  baseName: string;
  tableId: string;
  tableName: string;
  user_resolved?: {
    id: string;
    name: string;
    email: string;
    isNewUser: boolean;
  };
}

interface AirtableBase {
  id: string;
  name?: string;
}

interface AirtableTable {
  id: string;
  name?: string;
  fields: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

interface AirtableApiResponse {
  data?: {
    bases?: AirtableBase[];
    tables?: AirtableTable[];
    records?: any[];
    error?: string;
  };
}

// Helper function to add delay for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to format field values for text conversion
function formatFieldValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (typeof value === 'string') {
    return value;
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  
  if (Array.isArray(value)) {
    return value.map(formatFieldValue).join(', ');
  }
  
  if (typeof value === 'object') {
    // Handle Airtable-specific field types
    if (value.url) {
      return value.url;
    }
    if (value.name) {
      return value.name;
    }
    if (value.email) {
      return value.email;
    }
    // For other objects, try to extract meaningful text
    return JSON.stringify(value);
  }
  
  return String(value);
}

// Convert Airtable record to human-readable text
function recordToText(record: AirtableRecord): string {
  const fieldTexts = Object.entries(record.fields)
    .filter(([_, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${formatFieldValue(value)}`)
    .join('\n');
  
  return `[${record.tableName}]\n${fieldTexts}`;
}

// Return raw Airtable records as objects
async function fetchObjects(integrationId: string, lastSyncAt?: Date): Promise<AirtableRecord[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    log.info('Airtable objects sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    // Step 1: Fetch all accessible bases
    const basesResp = await composio.tools.execute('AIRTABLE_LIST_BASES', {
      userId: integration.userId,
      connectedAccountId,
      arguments: {}
    }) as AirtableApiResponse;

    const bases = basesResp?.data?.bases || [];
    log.info('Airtable bases', { count: bases.length });
    
    if (!bases.length) {
      return [];
    }

    const allRecords: AirtableRecord[] = [];
    let recordsTotal = 0;

    // Step 2: For each base, get schema and fetch records
    for (const base of bases) {
      const baseId = base.id;
      const baseName = base.name || base.id;

      try {
        // Get base schema to understand table structure
        const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
          userId: integration.userId,
          connectedAccountId,
          arguments: { baseId }
        }) as AirtableApiResponse;

        const tables = schemaResp?.data?.tables || [];
        log.info('Airtable tables for base', { baseId, baseName, count: tables.length });

        // Step 3: For each table, fetch records
        for (const table of tables) {
          const tableId = table.id;
          const tableName = table.name || table.id;

          try {
            // Add rate limiting delay
            await delay(RATE_LIMIT_DELAY);

            // Build arguments for list records
            const args: any = {
              baseId,
              tableIdOrName: tableId,
              pageSize: RECORD_LIMIT
            };

            // Add filtering for incremental sync if lastSyncAt is provided
            if (lastSyncAt) {
              // Note: Airtable doesn't have native "updated since" filtering
              // We'll fetch all records and filter client-side
              // Alternative: could use filterByFormula with LAST_MODIFIED_TIME() if available
            }

            const recordsResp = await composio.tools.execute('AIRTABLE_LIST_RECORDS', {
              userId: integration.userId,
              connectedAccountId,
              arguments: args
            }) as AirtableApiResponse;

            const records = recordsResp?.data?.records || [];
            recordsTotal += records.length;

            // Process each record
            for (const record of records) {
              if (!isValidRecord(record, lastSyncAt)) {
                continue;
              }

              allRecords.push({
                id: record.id,
                fields: record.fields || {},
                createdTime: record.createdTime || new Date().toISOString(),
                baseId,
                baseName,
                tableId,
                tableName
              });
            }

            log.debug('Airtable records processed', { 
              baseId, 
              baseName, 
              tableId, 
              tableName, 
              count: records.length 
            });

          } catch (tableError) {
            log.error('Failed to fetch records for table', { 
              baseId, 
              baseName, 
              tableId, 
              tableName, 
              error: (tableError as Error).message 
            });
            // Continue with other tables even if one fails
          }
        }

      } catch (baseError) {
        log.error('Failed to fetch schema for base', { 
          baseId, 
          baseName, 
          error: (baseError as Error).message 
        });
        // Continue with other bases even if one fails
      }
    }

    log.info('Airtable objects sync done', { 
      integrationId, 
      objects: allRecords.length, 
      total: recordsTotal 
    });
    
    return allRecords;

  } catch (error) {
    log.error('Airtable objects sync error', { 
      integrationId, 
      error: (error as Error).message 
    });
    return [];
  }
}

// Process Airtable records to generate intents per base
export async function processAirtableRecords(
  records: AirtableRecord[],
  integration: { id: string; indexId: string }
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!records.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  log.info('Processing Airtable records', { count: records.length });

  // Group records by base (since Airtable doesn't have rich user data like Slack)
  const recordsByBase = new Map<string, AirtableRecord[]>();
  for (const record of records) {
    const baseKey = `${record.baseId}:${record.baseName}`;
    if (!recordsByBase.has(baseKey)) {
      recordsByBase.set(baseKey, []);
    }
    recordsByBase.get(baseKey)!.push(record);
  }

  let totalIntentsGenerated = 0;
  let usersProcessed = 0;
  let newUsersCreated = 0;

  // Process each base individually
  for (const [baseKey, baseRecords] of recordsByBase) {
    if (!baseRecords.length) continue;

    const [baseId, baseName] = baseKey.split(':');
    const firstRecord = baseRecords[0];

    try {
      usersProcessed++;
      
      log.info('Processing Airtable base', { 
        baseId, 
        baseName, 
        recordCount: baseRecords.length 
      });

      // Convert records to text for intent generation
      const recordTexts = baseRecords.map(recordToText);
      const combinedText = recordTexts.join('\n\n---\n\n');

      // Queue intent generation for this base
      await addGenerateIntentsJob({
        userId: integration.indexId, // Use indexId as the "user" for base-level intents
        sourceId: integration.id,
        sourceType: 'integration',
        objects: baseRecords,
        content: combinedText,
        instruction: `Generate intents for Airtable base "${baseName}" based on its records`,
        indexId: integration.indexId,
        intentCount: MAX_INTENTS_PER_BASE
      }, 6);
      
      totalIntentsGenerated++; // Count queued jobs
    } catch (error) {
      log.error('Failed to process Airtable base', {
        baseId,
        baseName,
        recordCount: baseRecords.length,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue processing other bases even if one fails
    }
  }

  log.info('Airtable processing complete', { 
    intentsGenerated: totalIntentsGenerated,
    usersProcessed,
    newUsersCreated
  });

  return { 
    intentsGenerated: totalIntentsGenerated, 
    usersProcessed,
    newUsersCreated
  };
}

/**
 * Helper function to validate if a record should be processed
 */
function isValidRecord(record: any, lastSyncAt?: Date): boolean {
  if (!record?.id) {
    return false;
  }
  
  // Check if record is newer than last sync
  if (lastSyncAt && record.createdTime) {
    const recordTime = new Date(record.createdTime);
    if (recordTime <= lastSyncAt) {
      return false;
    }
  }
  
  return true;
}

export const airtableHandler: IntegrationHandler<AirtableRecord> = { 
  fetchObjects,
  processObjects: processAirtableRecords
};
