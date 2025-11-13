import { getClient } from '../composio';
import { getIntegrationById } from '../integration-utils';
import { log } from '../../log';
import type { DirectorySyncProvider, Source, Column, DirectoryRecord } from '../directory-sync';
import type { DirectorySyncConfig } from '../../schema';

interface GoogleSheetsSpreadsheet {
  id: string;
  name?: string;
  sheets?: Array<{
    properties: {
      sheetId: number;
      title: string;
    };
  }>;
}

interface GoogleSheetsApiResponse {
  data?: {
    response_data?: any;
    spreadsheets?: GoogleSheetsSpreadsheet[];
    values?: any[][];
    sheets?: Array<{
      properties: {
        sheetId: number;
        title: string;
      };
    }>;
  };
  error?: string;
  successful?: boolean;
}

export const googledocsDirectoryProvider: DirectorySyncProvider = {
  async listSources(integrationId: string): Promise<Source[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      const composio = await getClient();
      
      // List spreadsheets (this would need a specific Composio action)
      // For now, return empty - this will be implemented when Google Docs directory sync is enabled
      log.warn('Google Docs directory sync not yet implemented', { integrationId });
      
      return [];
    } catch (error) {
      log.error('Failed to list Google Sheets spreadsheets', {
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
        throw new Error('Sheet ID is required for Google Sheets');
      }

      const composio = await getClient();
      
      // Get first row as headers
      const valuesResp = await composio.tools.execute('GOOGLESHEETS_GET_VALUES', {
        userId: integration.userId,
        connectedAccountId: integration.connectedAccountId,
        arguments: {
          spreadsheet_id: sourceId,
          range: `${subSourceId}!1:1`
        }
      }) as GoogleSheetsApiResponse;

      const values = valuesResp?.data?.response_data?.values ||
                    valuesResp?.data?.values ||
                    [];

      const headers = values[0] || [];
      const columns: Column[] = headers.map((name: string, index: number) => ({
        id: String(index),
        name: String(name || `Column ${index + 1}`),
        type: 'string'
      }));

      return columns;
    } catch (error) {
      log.error('Failed to get Google Sheets schema', {
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

      const spreadsheetId = config.source.id;
      const sheetId = config.source.subId;
      if (!sheetId) {
        throw new Error('Sheet ID is required for Google Sheets directory sync');
      }

      const composio = await getClient();
      
      // Get all values from the sheet (skip header row)
      const valuesResp = await composio.tools.execute('GOOGLESHEETS_GET_VALUES', {
        userId: integration.userId,
        connectedAccountId: integration.connectedAccountId,
        arguments: {
          spreadsheet_id: spreadsheetId,
          range: `${sheetId}!A:ZZ`
        }
      }) as GoogleSheetsApiResponse;

      const values = valuesResp?.data?.response_data?.values ||
                    valuesResp?.data?.values ||
                    [];

      if (values.length === 0) {
        return [];
      }

      const headers = values[0];
      const allRecords: DirectoryRecord[] = [];

      // Convert rows to records
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const record: DirectoryRecord = {};
        
        headers.forEach((header: string, index: number) => {
          record[header] = row[index] || '';
        });

        allRecords.push(record);
      }

      log.info('Fetched Google Sheets records for directory sync', {
        integrationId,
        spreadsheetId,
        sheetId,
        recordCount: allRecords.length
      });

      return allRecords;
    } catch (error) {
      log.error('Failed to fetch Google Sheets records', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
};

