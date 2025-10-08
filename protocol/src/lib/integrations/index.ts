export interface IntegrationFile {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
  type: string;
  size: number;
  sourceId?: string; // Optional source ID for tracking specific sources (links, files, etc.)
  metadata?: any; // Optional metadata for provider-specific data (e.g., original message data)
}


export interface IntegrationHandler<T = any> {
  fetchFiles?(integrationId: string, lastSyncAt?: Date): Promise<IntegrationFile[]>;
  fetchObjects?(integrationId: string, lastSyncAt?: Date): Promise<T[]>;
  processObjects?(objects: T[], integration: { id: string; indexId: string }): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }>;
}

import { notionHandler } from './providers/notion';
import { slackHandler } from './providers/slack';
import { discordHandler } from './providers/discord';

export { notionHandler, processNotionPages, type NotionPage } from './providers/notion';
export { slackHandler, type SlackMessage } from './providers/slack';
export { discordHandler, type DiscordMessage } from './providers/discord';

const registry: Record<string, IntegrationHandler> = {
  notion: notionHandler,
  slack: slackHandler,
  discord: discordHandler,
};

export const handlers = registry;

export function registerIntegration(type: string, handler: IntegrationHandler) {
  registry[type] = handler;
}
