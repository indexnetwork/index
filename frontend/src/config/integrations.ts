export interface IntegrationConfig {
  name: string;
  displayName: string;
  toolkit?: string;
}

export const INTEGRATIONS = {
  notion: { name: 'notion', displayName: 'Notion', toolkit: 'NOTION' },
  slack: { name: 'slack', displayName: 'Slack', toolkit: 'SLACK' },
  discord: { name: 'discord', displayName: 'Discord', toolkit: 'DISCORDBOT' },
  airtable: { name: 'airtable', displayName: 'Airtable', toolkit: 'AIRTABLE' },
  linkedin: { name: 'linkedin', displayName: 'LinkedIn', toolkit: 'LINKEDIN' },
} as const;

export type IntegrationName = keyof typeof INTEGRATIONS;

// Get array of integration configs for UI display
export const getIntegrationsList = () => {
  return Object.entries(INTEGRATIONS).map(([type, config]) => ({
    id: null, // Will be set when connected
    type: type as IntegrationName,
    name: config.displayName,
    connected: false, // Default, will be updated from API
    indexId: null
  }));
};
