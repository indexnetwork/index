import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';

import { log } from '../log';

const logger = log.lib.from('composio.client');

type ComposioLangchain = Composio<LangchainProvider>;

let client: ComposioLangchain | null = null;
let authConfigMap: Record<string, string> | null = null;

/**
 * Returns the lazily-initialized Composio SDK client.
 * @returns The configured Composio client with LangChain provider
 * @throws If COMPOSIO_API_KEY environment variable is not set
 */
export function getComposioClient(): ComposioLangchain {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new Error('COMPOSIO_API_KEY is not set');
    }
    client = new Composio({ apiKey, provider: new LangchainProvider() });
  }
  return client;
}

/**
 * Fetches all enabled auth configs from Composio and builds a toolkit→authConfigId map.
 * Cached after first successful call. Keeps the first enabled config encountered per toolkit.
 * @returns Toolkit slug → authConfigId map (empty object on transient failure, allowing retry)
 */
export async function getAuthConfigMap(): Promise<Record<string, string>> {
  if (authConfigMap) return authConfigMap;

  const composio = getComposioClient();
  try {
    const response = await composio.authConfigs.list();
    const map: Record<string, string> = {};
    for (const item of response.items) {
      const slug = item.toolkit?.slug;
      if (slug && item.status === 'ENABLED' && !map[slug]) {
        map[slug] = item.id;
      }
    }
    authConfigMap = map;
    logger.info('Loaded auth config map', { toolkits: Object.keys(map) });
  } catch (err) {
    logger.warn('Failed to load auth configs, sessions will use Composio defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }

  return authConfigMap;
}
