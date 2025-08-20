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
import { slackHandler } from './slack';

export { notionHandler } from './notion';
export { slackHandler } from './slack';

const registry: Record<string, IntegrationHandler> = {
  notion: notionHandler,
  slack: slackHandler,
};

export const handlers = registry;

export function registerIntegration(type: string, handler: IntegrationHandler) {
  registry[type] = handler;
}
