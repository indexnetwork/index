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
  fetchFiles?(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]>;
  fetchObjects?(userId: string, lastSyncAt?: Date): Promise<T[]>;
}

import { notionHandler } from './providers/notion';
import { slackHandler } from './providers/slack';
import { discordHandler } from './providers/discord';
import { googleCalendarHandler } from './providers/googlecalendar';
import { gmailHandler } from './providers/gmail';

export { notionHandler, processNotionPages, type NotionPage } from './providers/notion';
export { slackHandler, type SlackMessage } from './providers/slack';
export { discordHandler, type DiscordMessage } from './providers/discord';
export { googleCalendarHandler } from './providers/googlecalendar';
export { gmailHandler } from './providers/gmail';

const registry: Record<string, IntegrationHandler> = {
  notion: notionHandler,
  slack: slackHandler,
  discord: discordHandler,
  calendar: googleCalendarHandler,
  gmail: gmailHandler,
};

export const handlers = registry;

export function registerIntegration(type: string, handler: IntegrationHandler) {
  registry[type] = handler;
}
