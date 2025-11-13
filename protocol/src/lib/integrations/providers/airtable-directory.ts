import { getClient } from '../composio';
import { getIntegrationById } from '../integration-utils';
import { log } from '../../log';
import type { DirectorySyncProvider, Source, Column, DirectoryRecord } from '../directory-sync';
import type { DirectorySyncConfig } from '../../schema';

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
    response_data?: any;
    bases?: AirtableBase[];
    tables?: AirtableTable[];
    records?: Array<{
      id: string;
      fields: Record<string, any>;
    }>;
    offset?: string;
  };
  error?: string;
  successful?: boolean;
}

const RECORD_LIMIT = 100; // Airtable API pagination limit

export const airtableDirectoryProvider: DirectorySyncProvider = {
  async listSources(integrationId: string): Promise<Source[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      const composio = await getClient();
      const bases: AirtableBase[] = [];
      let offset: string | undefined;

      do {
        const basesResp = await composio.tools.execute('AIRTABLE_LIST_BASES', {
          userId: integration.userId,
          connectedAccountId: integration.connectedAccountId,
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

      // For each base, fetch tables to include in subSources
      const sources: Source[] = [];
      for (const base of bases) {
        try {
          const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
            userId: integration.userId,
            connectedAccountId: integration.connectedAccountId,
            arguments: { baseId: base.id }
          }) as AirtableApiResponse;

          const schemaData = schemaResp?.data?.response_data;
          const tables = schemaData?.tables || [];

          sources.push({
            id: base.id,
            name: base.name || base.id,
            subSources: tables.map(table => ({
              id: table.id,
              name: table.name || table.id
            }))
          });
        } catch (error) {
          log.warn('Failed to fetch tables for base', {
            baseId: base.id,
            error: error instanceof Error ? error.message : String(error)
          });
          // Still add base without subSources
          sources.push({
            id: base.id,
            name: base.name || base.id
          });
        }
      }

      return sources;
    } catch (error) {
      log.error('Failed to list Airtable bases', {
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

      if (!subSourceId) {
        throw new Error('Table ID is required for Airtable');
      }

      const composio = await getClient();
      const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
        userId: integration.userId,
        connectedAccountId: integration.connectedAccountId,
        arguments: { baseId: sourceId }
      }) as AirtableApiResponse;

      const schemaData = schemaResp?.data?.response_data;
      if (!schemaData?.tables) {
        throw new Error('No tables found in base');
      }

      const table = schemaData.tables.find((t: AirtableTable) => t.id === subSourceId);
      if (!table) {
        throw new Error('Table not found');
      }

      const columns: Column[] = (table.fields || []).map(field => ({
        id: field.id,
        name: field.name,
        type: field.type
      }));

      return columns;
    } catch (error) {
      log.error('Failed to get Airtable table schema', {
        integrationId,
        sourceId,
        subSourceId,
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

      const baseId = config.source.id;
      const tableId = config.source.subId;
      if (!tableId) {
        throw new Error('Table ID is required for Airtable directory sync');
      }

      const composio = await getClient();
      const allRecords: DirectoryRecord[] = [];
      let recordOffset: string | undefined;

      do {
        const recordsResp = await composio.tools.execute('AIRTABLE_LIST_RECORDS', {
          userId: integration.userId,
          connectedAccountId: integration.connectedAccountId,
          arguments: {
            baseId,
            tableIdOrName: tableId,
            pageSize: RECORD_LIMIT,
            ...(recordOffset && { offset: recordOffset })
          }
        }) as AirtableApiResponse;

        const recordsData = recordsResp?.data?.response_data;
        if (!recordsData?.records) {
          break;
        }

        // Convert Airtable records to DirectoryRecord format
        for (const record of recordsData.records) {
          allRecords.push(record.fields);
        }

        recordOffset = recordsData.offset;
      } while (recordOffset);

      log.info('Fetched Airtable records for directory sync', {
        integrationId,
        baseId,
        tableId,
        recordCount: allRecords.length
      });

      return allRecords;
    } catch (error) {
      log.error('Failed to fetch Airtable records', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
};

