/**
 * The Buzz bridge: the Index host's presence in one Buzz community.
 *
 * - Mirrors a Buzz channel's relay-signed member list (kind 39002) into an
 *   Index network, so the community's members can match on Index.
 * - When an opportunity involves two community members, DMs each of them a
 *   card on Buzz (NIP-17).
 * - When both accept, opens a private Buzz channel with the two of them
 *   (kind 9007 with `p` tags) and posts the introduction there.
 *
 * It never posts Index's own kinds to Buzz: Buzz refuses kinds it doesn't know.
 */
import { addMembersTemplate, buzzChannelMessageTemplate, buzzDirectMessage, buzzPrivateChannelTemplate, KIND, parseGroupMembers, tagValue, type Keypair } from '@indexnetwork/nostr';
import type { NostrEvent } from 'nostr-tools/pure';
import type { Relay as NostrRelay } from 'nostr-tools/relay';
import { finalizeEvent } from 'nostr-tools/pure';

import { connectAuthed } from '../client.js';
import type { ConnectionNotice, Host } from '../host/host.js';
import type { Relay } from '../relay/relay.js';

export interface BuzzBridgeConfig {
  relayUrl: string;
  channelId: string;
  networkId: string;
  relayPubkey: string | null;
  /** How often to re-read the member list. Some Buzz versions don't push 39002 updates to open subscriptions. */
  refreshMs?: number;
}

export interface BuzzBridgeStatus {
  connected: boolean;
  relayUrl: string;
  channelId: string;
  networkId: string;
  members: number;
  lastSyncAt: number | null;
  lastError: string | null;
  cardsSent: number;
  channelsOpened: number;
}

export class BuzzBridge {
  private connection: NostrRelay | null = null;
  private relayPubkey: string | null;
  private channelName: string | null = null;
  private members = new Set<string>();
  private stopped = false;
  private backoff = 1000;
  private refresher: ReturnType<typeof setInterval> | null = null;
  private latestMembersAt = 0;
  readonly status: BuzzBridgeStatus;

  constructor(private readonly config: BuzzBridgeConfig, private readonly relay: Relay, private readonly host: Host, private readonly key: Keypair) {
    this.relayPubkey = config.relayPubkey;
    this.status = { connected: false, relayUrl: config.relayUrl, channelId: config.channelId, networkId: config.networkId, members: 0, lastSyncAt: null, lastError: null, cardsSent: 0, channelsOpened: 0 };
    host.addHooks({
      onOpportunity: (notice) => this.sendCards(notice),
      onConnected: (notice) => this.openChannel(notice),
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.refresher) clearInterval(this.refresher);
    this.refresher = null;
    this.connection?.close();
    this.connection = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      this.relayPubkey ??= await fetchRelayPubkey(this.config.relayUrl);
      if (!this.relayPubkey) throw new Error('the Buzz relay advertises no signing key (NIP-11 self/pubkey); set BUZZ_RELAY_PUBKEY');
      const connection = await connectAuthed(this.config.relayUrl, this.key);
      this.connection = connection;
      this.status.connected = true;
      this.status.lastError = null;
      this.backoff = 1000;
      connection.onclose = () => {
        this.status.connected = false;
        this.connection = null;
        if (this.refresher) clearInterval(this.refresher);
        this.refresher = null;
        this.retry();
      };
      this.read(connection, false);
      if (this.refresher) clearInterval(this.refresher);
      this.refresher = setInterval(() => {
        if (this.connection) this.read(this.connection, true);
      }, this.config.refreshMs ?? 15_000);
    } catch (error) {
      this.status.connected = false;
      this.status.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[buzz] ${this.status.lastError}`);
      this.retry();
    }
  }

  /** Subscribe to the channel's metadata and members; `once` closes after the stored events (a refresh). */
  private read(connection: NostrRelay, once: boolean): void {
    const subscription = connection.subscribe([{ kinds: [KIND.GROUP_METADATA, KIND.GROUP_MEMBERS], '#d': [this.config.channelId] }], {
      onevent: (event) => this.onState(event),
      oneose: () => { if (once) subscription.close(); },
    });
  }

  private onState(event: NostrEvent): void {
    if (event.kind === KIND.GROUP_METADATA && event.pubkey === this.relayPubkey) {
      this.channelName = tagValue(event, 'name') ?? this.channelName;
      return;
    }
    const members = parseGroupMembers(event, this.relayPubkey!);
    if (!members || members.createdAt < this.latestMembersAt) return;
    this.latestMembersAt = members.createdAt;
    void this.sync(members.members);
  }

  private retry(): void {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 60_000);
    setTimeout(() => void this.connect(), delay);
  }

  /** Mirror the Buzz channel's members into the Index network. The bridge's own key stays a member as the network's admin. */
  async sync(members: string[]): Promise<void> {
    this.members = new Set(members);
    const name = this.channelName ? `Buzz · ${this.channelName}` : 'Buzz community';
    const result = this.relay.groups.sync(this.config.networkId, members, { name, about: `Mirrors Buzz channel ${this.config.channelId} on ${this.config.relayUrl}`, createdBy: this.key.pubkey });
    await this.relay.publishState(result.emitted);
    this.status.members = this.members.size;
    this.status.lastSyncAt = Math.floor(Date.now() / 1000);
  }

  private inCommunity(notice: ConnectionNotice): boolean {
    return notice.opportunity.parties.every((party) => this.members.has(party));
  }

  private async publish(events: { kind: number }[]): Promise<void> {
    if (!this.connection) throw new Error('not connected to Buzz');
    for (const event of events) await this.connection.publish(event as Parameters<NostrRelay['publish']>[0]);
  }

  private async sendCards(notice: ConnectionNotice): Promise<void> {
    if (!this.connection || !this.inCommunity(notice)) return;
    try {
      for (const party of notice.opportunity.parties) {
        const headline = notice.headlines.get(party) ?? 'A new match';
        const text = `New opportunity on Index (${notice.networkName}).\n\n${headline}\n\nOpen it in your Index client to accept or decline.`;
        await this.publish(buzzDirectMessage(this.key.secretKey, [party], text));
        this.status.cardsSent += 1;
      }
    } catch (error) {
      this.status.lastError = `cards: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async openChannel(notice: ConnectionNotice): Promise<void> {
    if (!this.connection || !this.inCommunity(notice)) return;
    try {
      const channelId = crypto.randomUUID();
      const create = finalizeEvent(buzzPrivateChannelTemplate({
        channelId,
        name: `index-intro-${notice.opportunity.id.slice(0, 8)}`,
        about: `An introduction from Index, matched in ${notice.networkName}.`,
        members: [...notice.opportunity.parties],
      }), this.key.secretKey);
      await this.publish([create]);
      // Older Buzz relays add only the first person a 9007/9000 names, so add each person on their own too.
      for (const party of notice.opportunity.parties) {
        await this.publish([finalizeEvent(addMembersTemplate(channelId, [party]), this.key.secretKey)]).catch(() => undefined);
      }
      const hello = finalizeEvent(buzzChannelMessageTemplate(channelId, 'You both said yes on Index, so here is the introduction. Say hello!'), this.key.secretKey);
      await this.publish([hello]);
      this.status.channelsOpened += 1;
    } catch (error) {
      this.status.lastError = `channel: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/** Read a relay's signing key from its NIP-11 document (`self`, falling back to `pubkey`). */
export async function fetchRelayPubkey(relayUrl: string): Promise<string | null> {
  const httpUrl = relayUrl.replace(/^ws(s?):\/\//, 'http$1://');
  const response = await fetch(httpUrl, { headers: { Accept: 'application/nostr+json' } });
  if (!response.ok) return null;
  const info = await response.json() as { self?: unknown; pubkey?: unknown };
  const key = typeof info.self === 'string' ? info.self : typeof info.pubkey === 'string' ? info.pubkey : null;
  return key && /^[0-9a-f]{64}$/.test(key) ? key : null;
}
