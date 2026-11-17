/**
 * A demo partner: a second identity, running in this tab, that answers your
 * intent so you can watch the whole loop alone.
 *
 * It joins your network, publishes an intent that echoes yours (so the
 * preview's word-overlap matcher pairs you), and then plays its seat on
 * autopilot: it proposes when it moves first, accepts your proposals,
 * accepts the opportunity, and says hello once you're introduced. Everything
 * it does is ordinary signed Nostr from its own key.
 */
import type { Intent } from '@indexnetwork/nostr';

import { IndexClient, type ClientState } from './client.js';
import { loadPartnerKey } from './keys.js';

export class DemoPartner {
  readonly client: IndexClient;
  private acted = new Set<string>();
  private greeted = new Set<string>();
  private started: Promise<void> | null = null;

  constructor(relayUrl: string) {
    this.client = new IndexClient(relayUrl, loadPartnerKey(), 'demo partner');
    this.client.subscribe(() => void this.autopilot(this.client.state));
  }

  get pubkey(): string { return this.client.pubkey; }

  /** Whether this browser has used a demo partner before (so it should resume its autopilot on load). */
  static get used(): boolean {
    return localStorage.getItem('index-nostr:partner-used') === '1';
  }

  start(): Promise<void> {
    localStorage.setItem('index-nostr:partner-used', '1');
    this.started ??= this.client.start();
    return this.started;
  }

  /**
   * Answer `intent`: get into its networks (joining open ones, or being added
   * by `owner` when it administers an invite-only one), then publish a
   * matching intent there.
   */
  async answer(intent: Intent, owner: IndexClient): Promise<void> {
    await this.start();
    const networks = intent.networks.length > 0 ? intent.networks : owner.state.networks.filter((network) => network.members.includes(owner.pubkey)).map((network) => network.id);
    if (networks.length === 0) throw new Error('join a network first, so the partner has somewhere to meet you');
    const shared: string[] = [];
    for (const id of networks) {
      const network = owner.state.networks.find((candidate) => candidate.id === id);
      if (network?.members.includes(this.pubkey)) { shared.push(id); continue; }
      if (network?.open) {
        await this.client.joinNetwork(id).catch(() => undefined);
        shared.push(id);
      } else if (network?.admins.includes(owner.pubkey)) {
        await owner.addMember(id, this.pubkey);
        shared.push(id);
      }
    }
    if (shared.length === 0) throw new Error('the partner can\'t get into that network: it is invite-only and you are not an admin');
    // Let the membership land before posting into it.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await this.client.publishIntent({ text: `I can help with this: ${intent.text}`, visibility: 'network_only', networks: shared });
  }

  private async autopilot(state: ClientState): Promise<void> {
    if (state.status !== 'connected') return;
    for (const negotiation of state.negotiations) {
      if (negotiation.awaiting !== this.pubkey || negotiation.outcome) continue;
      const key = `${negotiation.id}:${negotiation.headId}`;
      if (this.acted.has(key)) continue;
      this.acted.add(key);
      const last = negotiation.turns.at(-1);
      const turn = last && last.seat !== this.pubkey && last.action === 'propose'
        ? { action: 'accept' as const, message: 'Yes. Let\'s get an introduction.' }
        : { action: 'propose' as const, message: 'I think we can help each other here. Shall we talk?' };
      await delay(900);
      await this.client.sendTurn(negotiation, turn).catch(() => this.acted.delete(key));
    }
    for (const opportunity of state.opportunities) {
      if (opportunity.status !== 'pending' || this.acted.has(opportunity.content.opportunityId)) continue;
      this.acted.add(opportunity.content.opportunityId);
      await delay(1200);
      await this.client.respond(opportunity, 'accept').catch(() => this.acted.delete(opportunity.content.opportunityId));
    }
    for (const opportunity of state.opportunities) {
      if (opportunity.status !== 'connected' || this.greeted.has(opportunity.content.opportunityId)) continue;
      this.greeted.add(opportunity.content.opportunityId);
      await delay(1500);
      await this.client.sendMessage([opportunity.content.counterparty], 'Hi! I\'m the demo partner. This message is a NIP-17 DM, encrypted to you and signed by my key.').catch(() => undefined);
    }
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
