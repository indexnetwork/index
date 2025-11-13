export interface IntegrationDefinition {
  type: string;
  name: string;
  userIntegration: boolean;
  indexIntegration: boolean;
  requiresDirectoryConfig: boolean;
  enabled: boolean;
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  { type: 'slack', name: 'Slack', userIntegration: false, indexIntegration: true, requiresDirectoryConfig: false, enabled: true },
  { type: 'discord', name: 'Discord', userIntegration: false, indexIntegration: true, requiresDirectoryConfig: false, enabled: false },
  { type: 'notion', name: 'Notion', userIntegration: true, indexIntegration: true, requiresDirectoryConfig: true, enabled: true },
  { type: 'airtable', name: 'Airtable', userIntegration: true, indexIntegration: true, requiresDirectoryConfig: true, enabled: true },
  { type: 'googledocs', name: 'Google Docs', userIntegration: true, indexIntegration: true, requiresDirectoryConfig: true, enabled: false },
];

export type IntegrationName = 'slack' | 'discord' | 'notion' | 'airtable' | 'googledocs';

export const getIndexIntegrations = () => 
  INTEGRATIONS.filter(i => i.indexIntegration && i.enabled);

export const getUserIntegrations = () => 
  INTEGRATIONS.filter(i => i.userIntegration && i.enabled);

// Get array of integration configs for UI display (backward compatibility)
export const getIntegrationsList = () => {
  return INTEGRATIONS.map(config => ({
    id: null, // Will be set when connected
    type: config.type as IntegrationName,
    name: config.name,
    connected: false, // Default, will be updated from API
    indexId: null
  }));
};
