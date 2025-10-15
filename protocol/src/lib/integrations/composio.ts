import { Composio } from '@composio/core';
import { log } from '../log';

// Re-export Composio class and types for use across codebase
export { Composio };
export type ComposioClient = Composio;

let singleton: ComposioClient | null = null;

// Allow tests to inject a mock client
export function setClient(client: ComposioClient | null) {
  singleton = client;
}

export async function getClient(): Promise<ComposioClient> {
  if (singleton) return singleton;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) log.warn('COMPOSIO_API_KEY not set; Composio may fail');
  singleton = new Composio({ apiKey });
  return singleton;
}
