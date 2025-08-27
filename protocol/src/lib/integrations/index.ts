export interface IntegrationFile {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
  type: string;
  size: number;
}

export interface IntegrationHandler {
  fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]>;
}

import { notionHandler } from './providers/notion';
import { slackHandler } from './providers/slack';
import { discordHandler } from './providers/discord';

export { notionHandler } from './providers/notion';
export { slackHandler } from './providers/slack';
export { discordHandler } from './providers/discord';

const registry: Record<string, IntegrationHandler> = {
  notion: notionHandler,
  slack: slackHandler,
  discord: discordHandler,
};

export const handlers = registry;

export function registerIntegration(type: string, handler: IntegrationHandler) {
  registry[type] = handler;
}
