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

import { notionHandler } from './notion';

export const handlers: Record<string, IntegrationHandler> = {
  notion: notionHandler,
};

