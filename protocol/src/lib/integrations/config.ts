export interface IntegrationConfig {
  name: string;
  displayName: string;
  toolkit?: string;
  authConfigId?: string;
}

export const INTEGRATIONS = {
  notion: { 
    name: 'notion', 
    displayName: 'Notion', 
    toolkit: 'NOTION',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_NOTION
  },
  slack: { 
    name: 'slack', 
    displayName: 'Slack', 
    toolkit: 'SLACK',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_SLACK
  },
  discord: { 
    name: 'discord', 
    displayName: 'Discord', 
    toolkit: 'DISCORDBOT',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_DISCORD
  },
  airtable: { 
    name: 'airtable', 
    displayName: 'Airtable', 
    toolkit: 'AIRTABLE',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_AIRTABLE
  },
  linkedin: { 
    name: 'linkedin', 
    displayName: 'LinkedIn', 
    toolkit: 'LINKEDIN',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_LINKEDIN
  },
} as const satisfies Record<string, IntegrationConfig>;

export type IntegrationName = keyof typeof INTEGRATIONS;

export const SYNC_PROVIDERS = {
  links: { name: 'links', displayName: 'Links' },
  ...INTEGRATIONS,
} as const;

export type SyncProviderName = keyof typeof SYNC_PROVIDERS;

// Helper functions
export const getIntegrationNames = (): IntegrationName[] => Object.keys(INTEGRATIONS) as IntegrationName[];
export const getSyncProviderNames = (): SyncProviderName[] => Object.keys(SYNC_PROVIDERS) as SyncProviderName[];
export const getIntegrationConfig = (name: string): IntegrationConfig | undefined => INTEGRATIONS[name as IntegrationName];
export const getDisplayName = (name: string): string => SYNC_PROVIDERS[name as SyncProviderName]?.displayName || name;
