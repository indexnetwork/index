/** Wires the relay, host and bridge together and serves HTTP + WebSocket. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { INDEX_KINDS } from '@indexnetwork/nostr';
import type { Server, ServerWebSocket } from 'bun';

import { BuzzBridge } from './bridge/buzz.js';
import type { Config } from './config.js';
import { LexicalDiscovery, NoDiscovery } from './host/discovery.js';
import { Host } from './host/host.js';
import { renderLanding } from './landing.js';
import { Relay, type Connection } from './relay/relay.js';
import { EventStore } from './relay/store.js';

const VERSION = '0.1.0';

export interface App {
  relay: Relay;
  host: Host;
  bridge: BuzzBridge | null;
  server: Server<{ connection: Connection | null }>;
  url: string;
  stop(): Promise<void>;
}

export async function startApp(config: Config): Promise<App> {
  const inMemory = config.dataDir === ':memory:';
  if (!inMemory) mkdirSync(config.dataDir, { recursive: true });
  const store = new EventStore(inMemory ? ':memory:' : join(config.dataDir, 'relay.sqlite'));
  const relay = new Relay(store, config.relayKey, config.publicUrl);
  const discovery = config.discovery === 'lexical' ? new LexicalDiscovery(config.discoveryThreshold) : new NoDiscovery();
  const host = new Host(relay, config.hostKey, discovery);
  const bridge = config.buzz ? new BuzzBridge(config.buzz, relay, host, config.hostKey) : null;

  const nip11 = () => ({
    name: config.relayName,
    description: 'Index Network on Nostr: intents, networks, negotiations and opportunities as signed events.',
    pubkey: config.relayKey.pubkey,
    self: config.relayKey.pubkey,
    software: 'https://github.com/indexnetwork/index/tree/dev/services/nostr',
    version: VERSION,
    supported_nips: [1, 9, 11, 17, 29, 40, 42, 44, 59],
    limitation: { auth_required: false, restricted_writes: true, max_subscriptions: 32, max_limit: 500, max_message_length: 131072 },
    index: { host_pubkey: config.hostKey.pubkey, kinds: INDEX_KINDS, discovery: discovery.name },
  });

  let publicUrl = config.publicUrl;
  const server = Bun.serve<{ connection: Connection | null }>({
    port: config.port,
    fetch(request, server) {
      const url = new URL(request.url);
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        if (server.upgrade(request, { data: { connection: null } })) return undefined;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
      if (url.pathname === '/' && request.headers.get('accept')?.includes('application/nostr+json')) {
        return Response.json(nip11(), { headers: { ...cors, 'Content-Type': 'application/nostr+json' } });
      }
      if (url.pathname === '/health') {
        return Response.json({ ok: true, version: VERSION, connections: relay.connectionCount, host: host.state.counts(), buzz: bridge?.status ?? null }, { headers: cors });
      }
      if (url.pathname === '/.well-known/nostr.json') {
        return Response.json({ names: { index: config.hostKey.pubkey, relay: config.relayKey.pubkey } }, { headers: cors });
      }
      if (url.pathname === '/networks') {
        return Response.json(relay.groups.list().map((group) => ({ ...group, members: relay.groups.members(group.id).length })), { headers: cors });
      }
      if (url.pathname === '/') {
        const relayUrl = publicUrl ?? `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
        return new Response(renderLanding({
          relayName: config.relayName,
          relayUrl,
          relayPubkey: config.relayKey.pubkey,
          hostPubkey: config.hostKey.pubkey,
          discovery: discovery.name,
          networks: relay.groups.list().map((group) => ({ id: group.id, name: group.name, joinPolicy: group.joinPolicy, members: relay.groups.members(group.id).length })),
          counts: host.state.counts(),
          buzz: bridge ? { connected: bridge.status.connected, relayUrl: bridge.status.relayUrl, members: bridge.status.members } : null,
        }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('Not found', { status: 404 });
    },
    websocket: {
      maxPayloadLength: 256 * 1024,
      open(ws: ServerWebSocket<{ connection: Connection | null }>) {
        ws.data.connection = relay.connect((message) => ws.send(JSON.stringify(message)));
      },
      async message(ws, message) {
        if (ws.data.connection) await relay.handle(ws.data.connection, typeof message === 'string' ? message : new TextDecoder().decode(message));
      },
      close(ws) {
        if (ws.data.connection) relay.disconnect(ws.data.connection);
      },
    },
  });

  const url = `ws://localhost:${server.port}`;
  publicUrl ??= null;
  if (bridge) await bridge.start();
  return {
    relay, host, bridge, server, url,
    async stop() {
      bridge?.stop();
      server.stop(true);
      store.close();
    },
  };
}
