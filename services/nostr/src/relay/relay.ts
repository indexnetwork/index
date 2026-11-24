/**
 * The Index relay: NIP-01 over WebSocket, NIP-42 AUTH, NIP-11 info, NIP-29
 * networks, and the read/write policy in `policy.ts`.
 *
 * In-process listeners (the Index host, the Buzz bridge) see every stored
 * event through {@link Relay.onEvent} and publish their own signed events
 * through {@link Relay.publishTrusted}, which skips AUTH but not signature
 * checks.
 */
import { KIND, isValidEvent, principalOf, tagValue } from '@indexnetwork/nostr';
import { matchFilter, type Filter } from 'nostr-tools/filter';
import type { NostrEvent } from 'nostr-tools/pure';

import { Groups } from './groups.js';
import { GROUP_REQUEST_KINDS, canRead, checkWrite, type Viewer } from './policy.js';
import { EventStore } from './store.js';

const MAX_SUBSCRIPTIONS = 32;
const MAX_FILTERS = 10;
const AUTH_WINDOW = 10 * 60;

export interface Connection extends Viewer {
  id: number;
  challenge: string;
  subscriptions: Map<string, Filter[]>;
  send(message: unknown[]): void;
}

export type IngestResult = { ok: boolean; message: string };
type Listener = (event: NostrEvent) => void | Promise<void>;

export class Relay {
  readonly groups: Groups;
  private readonly connections = new Set<Connection>();
  private readonly listeners: Listener[] = [];
  private nextId = 1;

  constructor(readonly store: EventStore, readonly relayKey: { secretKey: Uint8Array; pubkey: string }, private readonly publicUrl: string | null) {
    this.groups = new Groups(store.db, relayKey);
  }

  /** Called for every newly stored event, in order. */
  onEvent(listener: Listener): void {
    this.listeners.push(listener);
  }

  connect(send: (message: unknown[]) => void): Connection {
    const connection: Connection = {
      id: this.nextId++,
      challenge: crypto.randomUUID(),
      pubkey: null,
      principal: null,
      subscriptions: new Map(),
      send,
    };
    this.connections.add(connection);
    send(['AUTH', connection.challenge]);
    return connection;
  }

  disconnect(connection: Connection): void {
    this.connections.delete(connection);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Handle one raw client message. */
  async handle(connection: Connection, raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      connection.send(['NOTICE', 'invalid: message is not JSON']);
      return;
    }
    if (!Array.isArray(message) || typeof message[0] !== 'string') {
      connection.send(['NOTICE', 'invalid: expected a JSON array']);
      return;
    }
    switch (message[0]) {
      case 'EVENT': {
        const event = message[1] as NostrEvent;
        const result = await this.ingest(event, connection);
        connection.send(['OK', event?.id ?? '', result.ok, result.message]);
        return;
      }
      case 'REQ':
        this.subscribe(connection, message[1], message.slice(2));
        return;
      case 'CLOSE':
        if (typeof message[1] === 'string') connection.subscriptions.delete(message[1]);
        return;
      case 'AUTH': {
        const event = message[1] as NostrEvent;
        const result = this.authenticate(connection, event);
        connection.send(['OK', event?.id ?? '', result.ok, result.message]);
        return;
      }
      default:
        connection.send(['NOTICE', `invalid: unsupported message ${message[0]}`]);
    }
  }

  private authenticate(connection: Connection, event: NostrEvent): IngestResult {
    if (!event || event.kind !== KIND.CLIENT_AUTH || !isValidEvent(event)) return { ok: false, message: 'invalid: not a valid AUTH event' };
    if (tagValue(event, 'challenge') !== connection.challenge) return { ok: false, message: 'invalid: wrong challenge' };
    if (Math.abs(event.created_at - Math.floor(Date.now() / 1000)) > AUTH_WINDOW) return { ok: false, message: 'invalid: AUTH event is stale' };
    if (this.publicUrl) {
      const relayTag = tagValue(event, 'relay');
      if (!relayTag || hostOf(relayTag) !== hostOf(this.publicUrl)) return { ok: false, message: 'invalid: AUTH is for a different relay' };
    }
    // NIP-AA (Buzz): an agent may authenticate with its owner's NIP-OA tag and read as its owner.
    const { principal } = principalOf(event);
    connection.pubkey = event.pubkey;
    connection.principal = principal;
    return { ok: true, message: '' };
  }

  /** Validate, apply and store a client event. */
  async ingest(event: NostrEvent, viewer: Viewer): Promise<IngestResult> {
    const verdict = checkWrite(event, viewer, this.groups);
    if (!verdict.ok) return { ok: false, message: verdict.reason };
    if (GROUP_REQUEST_KINDS.has(event.kind)) {
      const applied = this.groups.apply(event, viewer.principal!);
      if (!applied.ok) return { ok: false, message: applied.reason };
      await this.persist(event);
      for (const state of applied.emitted) await this.persist(state);
      return { ok: true, message: '' };
    }
    const saved = await this.persist(event);
    return saved ? { ok: true, message: '' } : { ok: true, message: 'duplicate: already have this event' };
  }

  /** Publish an event signed by a trusted in-process key (the host or the relay). */
  async publishTrusted(event: NostrEvent): Promise<boolean> {
    if (!isValidEvent(event)) throw new Error('refusing to publish an invalid event');
    return this.persist(event);
  }

  /** Publish relay-signed group state produced outside a client request (the Buzz bridge's sync). */
  async publishState(events: NostrEvent[]): Promise<void> {
    for (const event of events) await this.persist(event);
  }

  private async persist(event: NostrEvent): Promise<boolean> {
    const saved = this.store.save(event);
    if (!saved.stored) return false;
    this.broadcast(event);
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        console.error('[relay] listener failed', error);
      }
    }
    return true;
  }

  private broadcast(event: NostrEvent): void {
    for (const connection of this.connections) {
      if (!canRead(event, connection, this.groups)) continue;
      for (const [id, filters] of connection.subscriptions) {
        if (filters.some((filter) => matchFilter(filter, event))) connection.send(['EVENT', id, event]);
      }
    }
  }

  private subscribe(connection: Connection, id: unknown, rawFilters: unknown[]): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
      connection.send(['NOTICE', 'invalid: subscription id must be 1-64 characters']);
      return;
    }
    const filters = rawFilters.filter((filter): filter is Filter => typeof filter === 'object' && filter !== null && !Array.isArray(filter)).slice(0, MAX_FILTERS);
    if (filters.length === 0) {
      connection.send(['CLOSED', id, 'invalid: no filters']);
      return;
    }
    if (!connection.subscriptions.has(id) && connection.subscriptions.size >= MAX_SUBSCRIPTIONS) {
      connection.send(['CLOSED', id, 'rate-limited: too many subscriptions']);
      return;
    }
    // Gift wraps are only ever served to their recipient, so asking for them needs AUTH first.
    const wantsWraps = filters.some((filter) => filter.kinds?.includes(KIND.GIFT_WRAP));
    if (wantsWraps && !connection.pubkey) {
      connection.send(['CLOSED', id, 'auth-required: authenticate to read gift wraps']);
      return;
    }
    connection.subscriptions.set(id, filters);
    const seen = new Set<string>();
    for (const filter of filters) {
      for (const event of this.store.query(filter)) {
        if (seen.has(event.id) || !canRead(event, connection, this.groups)) continue;
        seen.add(event.id);
        connection.send(['EVENT', id, event]);
      }
    }
    connection.send(['EOSE', id]);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^ws/, 'http')).host.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
