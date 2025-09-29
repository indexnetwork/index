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

// Separate object types for each integration
export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    global_name?: string;
  };
  timestamp: string;
  edited_timestamp?: string;
  channel_id: string;
  channel_name: string;
  embeds?: any[];
  attachments?: any[];
}

export interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  username?: string;
  real_name?: string;
  display_name?: string;
  channel_id: string;
  channel_name: string;
  bot_id?: string;
  subtype?: string;
}

export interface NotionPage {
  id: string;
  title: string;
  content: string;
  created_time: string;
  last_edited_time: string;
  created_by: {
    id: string;
    name?: string;
  };
}

export interface IntegrationHandler {
  fetchFiles?(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]>;
  fetchObjects?(userId: string, lastSyncAt?: Date): Promise<DiscordMessage[] | SlackMessage[] | NotionPage[]>;
}

import { notionHandler } from './providers/notion';
import { slackHandler } from './providers/slack';
import { discordHandler } from './providers/discord';
import { googleCalendarHandler } from './providers/googlecalendar';
import { gmailHandler } from './providers/gmail';

export { notionHandler, processNotionPages } from './providers/notion';
export { slackHandler } from './providers/slack';
export { discordHandler } from './providers/discord';
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
