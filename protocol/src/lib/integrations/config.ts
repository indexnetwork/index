export interface IntegrationConfig {
  name: string;
  displayName: string;
  toolkit?: string;
  authConfigId?: string;
  capabilities: {
    // Can this integration be used for personal intent generation?
    userIntegration: boolean;
    // Can this integration be used for index with attribution?
    indexIntegration: boolean;
    // What sync modes are supported for index integrations?
    indexSyncModes?: {
      attribution?: boolean;    // Extract users from content (Slack, Discord)
      directorySync?: boolean;  // Map database/table to members (Notion, Airtable, Docs)
    };
  };
  enabled: boolean; // Global enable/disable flag
}

export const INTEGRATIONS = {
  slack: { 
    name: 'slack',
    displayName: 'Slack',
    toolkit: 'SLACK',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_SLACK,
    capabilities: {
      userIntegration: false,
      indexIntegration: true,
      indexSyncModes: { attribution: true }
    },
    enabled: true
  },
  discord: { 
    name: 'discord',
    displayName: 'Discord',
    toolkit: 'DISCORDBOT',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_DISCORD,
    capabilities: {
      userIntegration: false,
      indexIntegration: true,
      indexSyncModes: { attribution: true }
    },
    enabled: false // Disabled for now
  },
  notion: { 
    name: 'notion',
    displayName: 'Notion',
    toolkit: 'NOTION',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_NOTION,
    capabilities: {
      userIntegration: true,   // Can generate intents for single user
      indexIntegration: true,   // Can sync directory
      indexSyncModes: { directorySync: true }
    },
    enabled: true
  },
  airtable: { 
    name: 'airtable',
    displayName: 'Airtable',
    toolkit: 'AIRTABLE',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_AIRTABLE,
    capabilities: {
      userIntegration: true,
      indexIntegration: true,
      indexSyncModes: { directorySync: true }
    },
    enabled: true
  },
  googledocs: { 
    name: 'googledocs',
    displayName: 'Google Docs',
    toolkit: 'GOOGLEDOCS',
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_GOOGLEDOCS,
    capabilities: {
      userIntegration: true,
      indexIntegration: true,
      indexSyncModes: { directorySync: true }
    },
    enabled: false // Disabled for now
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
