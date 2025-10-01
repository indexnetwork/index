export interface IntegrationConfig {
  name: string;
  displayName: string;
  toolkit?: string;
}

export const INTEGRATIONS = {
  notion: { name: 'notion', displayName: 'Notion', toolkit: 'NOTION' },
  slack: { name: 'slack', displayName: 'Slack', toolkit: 'SLACK' },
  discord: { name: 'discord', displayName: 'Discord', toolkit: 'DISCORDBOT' },
  linkedin: { name: 'linkedin', displayName: 'LinkedIn', toolkit: 'LINKEDIN' },
} as const;

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
