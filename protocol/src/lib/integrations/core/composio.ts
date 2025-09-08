
export type ComposioClient = {
  connectedAccounts: { list: (args: any) => Promise<any> };
  tools: { execute: (tool: string, args: any) => Promise<any> };
  toolkits?: { authorize: (userId: string, toolkit: string) => Promise<any> };
};

let singleton: ComposioClient | null = null;

// Allow tests to inject a mock client
export function setClient(client: ComposioClient | null) {
  singleton = client;
}

export async function getClient(): Promise<ComposioClient> {
  if (singleton) return singleton;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) log.warn('COMPOSIO_API_KEY not set; Composio may fail');
  // Lazy import to avoid cost if unused
  const { Composio } = await import('@composio/core');
  singleton = new Composio({ apiKey }) as unknown as ComposioClient;
  return singleton;
}
import { log } from '../../log';
