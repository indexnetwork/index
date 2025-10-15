import { log } from '../log';

// Type for Composio client - will be properly typed after dynamic import
export type ComposioClient = any;

let singleton: ComposioClient | null = null;

// Allow tests to inject a mock client
export function setClient(client: ComposioClient | null) {
  singleton = client;
}

export async function getClient(): Promise<ComposioClient> {
  if (singleton) return singleton;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) log.warn('COMPOSIO_API_KEY not set; Composio may fail');
  
  // Dynamic import to handle ESM/CommonJS compatibility
  const { Composio } = await import('@composio/core');
  singleton = new Composio({ apiKey });
  return singleton;
}
