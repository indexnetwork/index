import { getClient } from '../composio';
import { log } from '../../log';
import { ensureIndexMembership } from '../membership-utils';
import { getIntegrationById } from '../integration-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

const RECORD_LIMIT = 100; // Airtable API pagination limit
const MAX_INTENTS_PER_USER = 3;

export interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  baseId: string;
  baseName?: string;
  tableId: string;
  tableName?: string;
  createdTime?: string;
  comments?: Array<{
    id: string;
    text: string;
    author?: { id: string; email?: string };
    createdTime: string;
  }>;
}

interface AirtableBase {
  id: string;
  name?: string;
}

interface AirtableTable {
  id: string;
  name?: string;
  fields?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

interface AirtableApiResponse {
  data?: {
    response_data?: any; // The actual data is nested under response_data
    id?: string;
    email?: string;
    scopes?: string[];
    bases?: AirtableBase[];
    tables?: AirtableTable[];
    records?: Array<{
      id: string;
      fields: Record<string, any>;
      createdTime: string;
    }>;
    comments?: Array<{
      id: string;
      text: string;
      author?: { id: string; email?: string };
      createdTime: string;
    }>;
    offset?: string;
  };
  error?: string;
  successful?: boolean;
}

/**
 * Initialize Airtable integration sync.
 * Fetches records, processes them, and queues intent generation for the integration owner.
 * For index integrations: skips (directory sync handles this).
 */
export async function initAirtable(
  integrationId: string,
  lastSyncAt?: Date
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Index integration: skip intent generation (directory sync handles this)
    if (integration.indexId) {
      log.info('Skipping intent generation for index integration', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    log.info('Airtable sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    
    // Fetch records
    const records = await fetchRecords(integrationId, integration.userId, integration.connectedAccountId, lastSyncAt);
    
    if (!records.length) {
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Process records for integration owner
    if (integration.indexId) {
      await ensureIndexMembership(integration.userId, integration.indexId);
    }

    await addGenerateIntentsJob({
      userId: integration.userId,
      sourceId: integrationId,
      sourceType: 'integration',
      objects: records,
      instruction: `Generate intents based on Airtable records and comments`,
      indexId: integration.indexId || undefined,
      intentCount: MAX_INTENTS_PER_USER
    }, 6);

    log.info('Airtable sync complete', {
      integrationId,
      recordsProcessed: records.length,
      intentsGenerated: 1,
      usersProcessed: 1
    });

    return {
      intentsGenerated: 1,
      usersProcessed: 1,
      newUsersCreated: 0
    };
  } catch (error) {
    log.error('Airtable sync error', { integrationId, error: (error as Error).message });
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }
}

/**
 * Fetches Airtable records with comments.
 */
async function fetchRecords(
  integrationId: string,
  userId: string,
  connectedAccountId: string,
  lastSyncAt?: Date
): Promise<AirtableRecord[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    // Index integration: skip intent generation (directory sync handles this)
    if (integration.indexId) {
      log.info('Skipping intent generation for index integration', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    const composio = await getClient();

    // Get authenticated user info
    let userInfoResp: AirtableApiResponse;
    try {
      userInfoResp = await composio.tools.execute('AIRTABLE_GET_USER_INFO', {
        userId,
        connectedAccountId,
        arguments: {}
      }) as AirtableApiResponse;
    } catch (error) {
      log.error('Failed to get Airtable user info', { integrationId, error: (error as Error).message });
      throw error;
    }

    const userData = userInfoResp?.data?.response_data;
    if (!userData?.id || !userData?.email) {
      log.error('Failed to get Airtable user info', { 
        integrationId, 
        hasData: !!userInfoResp?.data,
        dataKeys: userInfoResp?.data ? Object.keys(userInfoResp.data) : [],
        hasResponseData: !!userData,
        responseDataKeys: userData ? Object.keys(userData) : []
      });
      return [];
    }

    const airtableUser = {
      id: userData.id,
      email: userData.email,
      name: userData.email.split('@')[0]
    };

    log.info('Airtable user info', { userId: airtableUser.id, email: airtableUser.email });

    // List all accessible bases
    const bases: AirtableBase[] = [];
    let offset: string | undefined;
    
    do {
      const basesResp = await composio.tools.execute('AIRTABLE_LIST_BASES', {
        userId,
        connectedAccountId,
        arguments: offset ? { offset } : {}
      }) as AirtableApiResponse;

      const responseData = basesResp?.data?.response_data;
      if (responseData?.bases) {
        bases.push(...responseData.bases);
        offset = responseData.offset;
      } else {
        break;
      }
    } while (offset);

    log.info('Airtable bases', { count: bases.length });
    if (!bases.length) return [];

    // Process each base and its tables
    const allRecords: AirtableRecord[] = [];
    
    for (const base of bases) {
      try {
        // Discover tables in this base
        const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
          userId,
          connectedAccountId,
          arguments: { baseId: base.id }
        }) as AirtableApiResponse;

        const schemaData = schemaResp?.data?.response_data;
        if (!schemaData?.tables) {
          log.warn('No tables found in base', { baseId: base.id, baseName: base.name });
          continue;
        }

        const tables = schemaData.tables;
        log.info('Base tables', { baseId: base.id, baseName: base.name, tableCount: tables.length });

        // Process each table's records
        for (const table of tables) {
          try {
            // Fetch records with pagination
            let recordOffset: string | undefined;
            const tableRecords: AirtableRecord[] = [];

            do {
              const recordsResp = await composio.tools.execute('AIRTABLE_LIST_RECORDS', {
                userId,
                connectedAccountId,
                arguments: {
                  baseId: base.id,
                  tableIdOrName: table.id,
                  pageSize: RECORD_LIMIT,
                  ...(recordOffset && { offset: recordOffset })
                }
              }) as AirtableApiResponse;

              const recordsData = recordsResp?.data?.response_data;
              if (!recordsData?.records) {
                break;
              }

              // Apply incremental sync filter
              const filteredRecords = recordsData.records.filter((record: any) => {
                if (!lastSyncAt) return true;
                const recordTime = new Date(record.createdTime);
                return recordTime > lastSyncAt;
              });


              // Process each record and fetch comments
              for (const record of filteredRecords) {
                try {
                  // TODO: Optimize comment fetching - consider batching or parallel requests
                  // Comments may fail due to permissions but are optional for intent generation
                  let comments: any[] = [];
                  try {
                    const commentsResp = await composio.tools.execute('AIRTABLE_LIST_COMMENTS', {
                      userId,
                      connectedAccountId,
                      arguments: {
                        baseId: base.id,
                        tableIdOrName: table.id,
                        recordId: record.id
                      }
                    }) as AirtableApiResponse;

                    const commentsData = commentsResp?.data?.response_data;
                    comments = commentsData?.comments || [];
                  } catch (commentError) {
                    log.debug('Comments not available for record', {
                      baseId: base.id,
                      tableId: table.id,
                      recordId: record.id,
                      error: commentError instanceof Error ? commentError.message : String(commentError)
                    });
                    comments = [];
                  }

                  // Create enriched record with comments
                  const airtableRecord: AirtableRecord = {
                    id: record.id,
                    fields: record.fields,
                    baseId: base.id,
                    baseName: base.name,
                    tableId: table.id,
                    tableName: table.name,
                    createdTime: record.createdTime,
                    comments: comments.map((comment: any) => ({
                      id: comment.id,
                      text: comment.text,
                      author: comment.author,
                      createdTime: comment.createdTime
                    }))
                  };

                  tableRecords.push(airtableRecord);
                } catch (error) {
                  log.error('Failed to process record', {
                    baseId: base.id,
                    tableId: table.id,
                    recordId: record.id,
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              }

              recordOffset = recordsData.offset;
            } while (recordOffset);

            allRecords.push(...tableRecords);
            log.info('Table records processed', {
              baseId: base.id,
              baseName: base.name,
              tableId: table.id,
              tableName: table.name,
              recordCount: tableRecords.length
            });

          } catch (error) {
            log.error('Failed to process table', {
              baseId: base.id,
              baseName: base.name,
              tableId: table.id,
              tableName: table.name,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

      } catch (error) {
        log.error('Failed to process base', {
          baseId: base.id,
          baseName: base.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    log.info('Airtable records fetched', { 
      integrationId, 
      count: allRecords.length,
      recordsWithComments: allRecords.filter(r => r.comments && r.comments.length > 0).length
    });
    
    return allRecords;
  } catch (error) {
    log.error('Failed to fetch Airtable records', { integrationId, error: (error as Error).message });
    return [];
  }
}
