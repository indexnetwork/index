import type { IntegrationHandler } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { resolveAirtableUser } from '../../user-utils';
import { ensureIndexMembership } from '../membership-utils';
import { getIntegrationById } from '../integration-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

// Constants
const RECORD_LIMIT = 100; // Airtable max per page
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

    // Step 1: Get authenticated user info
    let userInfoResp: AirtableApiResponse;
    try {
      userInfoResp = await composio.tools.execute('AIRTABLE_GET_USER_INFO', {
        userId: integration.userId,
        connectedAccountId,
        arguments: {}
      }) as AirtableApiResponse;
    } catch (error) {
      log.error('Failed to get Airtable user info', { integrationId, error: (error as Error).message });
      throw error;
    }

    // Parse the response_data structure
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
      name: userData.email.split('@')[0] // Use email prefix as name fallback
    };

    log.info('Airtable user info', { userId: airtableUser.id, email: airtableUser.email });

    // Step 2: List all bases
    const bases: AirtableBase[] = [];
    let offset: string | undefined;
    
    do {
      const basesResp = await composio.tools.execute('AIRTABLE_LIST_BASES', {
        userId: integration.userId,
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

    // Step 3: Process each base
    const allRecords: AirtableRecord[] = [];
    
    for (const base of bases) {
      try {
        // Get base schema to discover tables
        const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
          userId: integration.userId,
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

        // Step 4: Process each table
        for (const table of tables) {
          try {
            // List records from table with pagination
            let recordOffset: string | undefined;
            const tableRecords: AirtableRecord[] = [];

            do {
              const recordsResp = await composio.tools.execute('AIRTABLE_LIST_RECORDS', {
                userId: integration.userId,
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

              // Filter records by lastSyncAt if provided
              const filteredRecords = recordsData.records.filter((record: any) => {
                if (!lastSyncAt) return true;
                const recordTime = new Date(record.createdTime);
                return recordTime > lastSyncAt;
              });


              // Step 5: Process each record and fetch comments (optional)
              for (const record of filteredRecords) {
                try {
                  // Try to fetch comments for this record (optional - may fail due to permissions)
                  let comments: any[] = [];
                  try {
                    const commentsResp = await composio.tools.execute('AIRTABLE_LIST_COMMENTS', {
                      userId: integration.userId,
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
                    // Comments are optional - log but continue if they fail
                    log.debug('Comments not available for record', {
                      baseId: base.id,
                      tableId: table.id,
                      recordId: record.id,
                      error: commentError instanceof Error ? commentError.message : String(commentError)
                    });
                    comments = [];
                  }

                  // Build AirtableRecord object
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
                  // Continue processing other records
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
            // Continue processing other tables
          }
        }

      } catch (error) {
        log.error('Failed to process base', {
          baseId: base.id,
          baseName: base.name,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue processing other bases
      }
    }

    log.info('Airtable objects sync done', { 
      integrationId, 
      objects: allRecords.length,
      recordsWithComments: allRecords.filter(r => r.comments && r.comments.length > 0).length
    });
    
    return allRecords;
  } catch (error) {
    log.error('Airtable objects sync error', { integrationId, error: (error as Error).message });
    return [];
  }
}

// Process Airtable records to generate intents for the authenticated user
export async function processAirtableRecords(
  records: AirtableRecord[],
  integration: { id: string; indexId: string }
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!records.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  log.info('Processing Airtable records', { 
    count: records.length,
    recordsWithComments: records.filter(r => r.comments && r.comments.length > 0).length
  });

  try {
    // Get integration details to fetch user info
    const integrationDetails = await getIntegrationById(integration.id);
    if (!integrationDetails) {
      log.error('Integration not found for processing', { integrationId: integration.id });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Get user info from Airtable API
    const composio = await getClient();
    const userInfoResp = await composio.tools.execute('AIRTABLE_GET_USER_INFO', {
      userId: integrationDetails.userId,
      connectedAccountId: integrationDetails.connectedAccountId!,
      arguments: {}
    }) as AirtableApiResponse;

    // Parse the response_data structure
    const userData = userInfoResp?.data?.response_data;
    if (!userData?.id || !userData?.email) {
      log.error('Failed to get Airtable user info for processing', { 
        integrationId: integration.id,
        hasData: !!userInfoResp?.data,
        dataKeys: userInfoResp?.data ? Object.keys(userInfoResp.data) : [],
        hasResponseData: !!userData,
        responseDataKeys: userData ? Object.keys(userData) : []
      });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    const airtableUser = {
      id: userData.id,
      email: userData.email,
      name: userData.email.split('@')[0] // Use email prefix as name fallback
    };

    // Resolve the user
    const resolvedUser = await resolveAirtableUser(airtableUser.email, airtableUser.id, airtableUser.name);
    if (!resolvedUser) {
      log.error('Failed to resolve Airtable user', { userEmail: airtableUser.email, airtableUserId: airtableUser.id });
      return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
    }

    // Ensure user is a member of the index
    await ensureIndexMembership(resolvedUser.id, integration.indexId);

    log.info('Processing Airtable user', {
      airtableUserId: airtableUser.id,
      email: resolvedUser.email,
      name: resolvedUser.name,
      userId: resolvedUser.id,
      isNewUser: resolvedUser.isNewUser
    });

    // Queue intent generation for this user
    await addGenerateIntentsJob({
      userId: resolvedUser.id,
      sourceId: integration.id,
      sourceType: 'integration',
      objects: records,
      instruction: `Generate intents for Airtable user "${resolvedUser.name}" based on their records and comments`,
      indexId: integration.indexId,
      intentCount: MAX_INTENTS_PER_USER
    }, 6);

    log.info('Airtable processing complete', {
      intentsGenerated: 1,
      usersProcessed: 1,
      newUsersCreated: resolvedUser.isNewUser ? 1 : 0
    });

    return {
      intentsGenerated: 1,
      usersProcessed: 1,
      newUsersCreated: resolvedUser.isNewUser ? 1 : 0
    };
  } catch (error) {
    log.error('Failed to process Airtable records', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }
}

export const airtableHandler: IntegrationHandler<AirtableRecord> = { 
  fetchObjects,
  processObjects: processAirtableRecords
};
