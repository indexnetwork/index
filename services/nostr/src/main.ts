import { npub } from '@indexnetwork/nostr';

import { startApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await startApp(config);
console.log(`[nostr] relay listening on :${app.server.port}${config.publicUrl ? ` (public ${config.publicUrl})` : ''}`);
console.log(`[nostr] relay key ${npub(config.relayKey.pubkey)}`);
console.log(`[nostr] host key  ${npub(config.hostKey.pubkey)}`);
console.log(`[nostr] discovery ${app.host.discovery.name}; buzz bridge ${config.buzz ? config.buzz.relayUrl : 'off'}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.stop().then(() => process.exit(0));
  });
}
