export interface IntegrationFile {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
  type: string;
  size: number;
  sourceId?: string;
  metadata?: any;
}

export { type NotionPage } from './providers/notion';
export { type SlackMessage } from './providers/slack';
export { type DiscordMessage } from './providers/discord';
export { type GoogleDocsDocument } from './providers/googledocs';
export { type AirtableRecord } from './providers/airtable';
