import crypto from 'crypto';
import { linksProvider, createIntegrationProvider, type SyncProvider, type SyncProviderName } from './providers';

function rid() {
  return (crypto as any).randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

const providers: Record<SyncProviderName, SyncProvider> = {
  links: linksProvider,
  notion: createIntegrationProvider('notion'),
  gmail: createIntegrationProvider('gmail'),
  slack: createIntegrationProvider('slack'),
  discord: createIntegrationProvider('discord'),
  calendar: createIntegrationProvider('calendar'),
};

export async function runSync(provider: SyncProviderName, userId: string, params: Record<string, any> = {}) {
  const p = providers[provider];
  if (!p) throw new Error('Unknown provider');
  const run: any = {
    id: rid(),
    provider,
    userId,
    createdAt: Date.now(),
  };
  let stats: Record<string, any> = {};
  const update = async (patch: any) => {
    if (patch.stats) stats = { ...stats, ...patch.stats };
  };
  await p.start(run, params, update);
  return { stats };
}

export function getProvider(name: SyncProviderName) {
  return providers[name];
}
