import { getClient } from '../composio';
import { getIntegrationById } from '../integration-utils';
import { log } from '../../log';
import type { DirectorySyncProvider, Source, Column, DirectoryRecord } from '../directory-sync';
import type { DirectorySyncConfig } from '../../schema';

interface NotionDatabase {
  id: string;
  title?: Array<{ plain_text: string }>;
  properties?: Record<string, any>;
}

interface NotionApiResponse {
  data?: {
    response_data?: any;
    results?: NotionDatabase[];
    properties?: Record<string, any>;
    records?: Array<{
      id: string;
      properties: Record<string, any>;
    }>;
    next_cursor?: string;
  };
  error?: string;
  successful?: boolean;
}

export const notionDirectoryProvider: DirectorySyncProvider = {
  async listSources(integrationId: string): Promise<Source[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      const composio = await getClient();
      
      // Search for databases in Notion
      const searchResp = await composio.tools.execute('NOTION_SEARCH_NOTION_PAGE', {
        userId: integration.userId,
        connectedAccountId: integration.connectedAccountId,
        arguments: {
          query: '',
          filter: { property: 'object', value: 'database' },
          page_size: 100
        }
      }) as NotionApiResponse;

      const databases = searchResp?.data?.response_data?.results || 
                       searchResp?.data?.results || 
                       [];

      const sources: Source[] = databases.map((db: NotionDatabase) => {
        const title = db.title?.[0]?.plain_text || db.id;
        return {
          id: db.id,
          name: title
        };
      });

      return sources;
    } catch (error) {
      log.error('Failed to list Notion databases', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  async getSourceSchema(integrationId: string, sourceId: string, subSourceId?: string): Promise<Column[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      const composio = await getClient();
      
      // Get database properties
      const dbResp = await composio.tools.execute('NOTION_GET_DATABASE', {
        userId: integration.userId,
        connectedAccountId: integration.connectedAccountId,
        arguments: { database_id: sourceId }
      }) as NotionApiResponse;

      const properties = dbResp?.data?.response_data?.properties ||
                        dbResp?.data?.properties ||
                        {};

      const columns: Column[] = Object.entries(properties).map(([name, prop]: [string, any]) => ({
        id: name,
        name,
        type: prop.type || 'unknown'
      }));

      return columns;
    } catch (error) {
      log.error('Failed to get Notion database schema', {
        integrationId,
        sourceId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  async fetchRecords(integrationId: string, config: DirectorySyncConfig): Promise<DirectoryRecord[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      const databaseId = config.source.id;
      const composio = await getClient();
      const allRecords: DirectoryRecord[] = [];
      let nextCursor: string | undefined;

      do {
        const queryResp = await composio.tools.execute('NOTION_QUERY_DATABASE', {
          userId: integration.userId,
          connectedAccountId: integration.connectedAccountId,
          arguments: {
            database_id: databaseId,
            page_size: 100,
            ...(nextCursor && { start_cursor: nextCursor })
          }
        }) as NotionApiResponse;

        const recordsData = queryResp?.data?.response_data || queryResp?.data || {};
        const records = recordsData.results || [];

        // Convert Notion records to DirectoryRecord format
        for (const record of records) {
          const properties = record.properties || {};
          const recordData: DirectoryRecord = {};
          
          // Extract property values
          for (const [key, prop] of Object.entries(properties)) {
            const propValue = prop as any;
            let value: any = null;

            // Extract value based on property type
            if (propValue.type === 'title' && propValue.title?.[0]?.plain_text) {
              value = propValue.title[0].plain_text;
            } else if (propValue.type === 'rich_text' && propValue.rich_text?.[0]?.plain_text) {
              value = propValue.rich_text[0].plain_text;
            } else if (propValue.type === 'email' && propValue.email) {
              value = propValue.email;
            } else if (propValue.type === 'phone_number' && propValue.phone_number) {
              value = propValue.phone_number;
            } else if (propValue.type === 'url' && propValue.url) {
              value = propValue.url;
            } else if (propValue.type === 'select' && propValue.select?.name) {
              value = propValue.select.name;
            } else if (propValue.type === 'multi_select' && propValue.multi_select) {
              value = propValue.multi_select.map((s: any) => s.name).join(', ');
            }

            if (value !== null) {
              recordData[key] = value;
            }
          }

          allRecords.push(recordData);
        }

        nextCursor = recordsData.next_cursor;
      } while (nextCursor);

      log.info('Fetched Notion records for directory sync', {
        integrationId,
        databaseId,
        recordCount: allRecords.length
      });

      return allRecords;
    } catch (error) {
      log.error('Failed to fetch Notion records', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
};

