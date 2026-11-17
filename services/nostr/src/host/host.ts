/**
 * The Index host on Nostr.
 *
 * It holds one key and plays the parts the Index API plays today:
 *
 * - **Discovery**: reads public and network-only intents from the relay, and
 *   incognito intents wrapped to it, and opens negotiations between them.
 * - **Negotiation witness**: every turn is wrapped to the host, which checks
 *   it against Index's rules ({@link NegotiationLedger}) and relays accepted,
 *   still-signed turns to the counterparty with its verdict.
 * - **Opportunities**: when two negotiators agree, it writes one opportunity
 *   per person and connects them only after both people accept with their
 *   own keys.
 *
 * Everything it says is a signed event, so its work can be checked.
 */
import { KIND, NEGOTIATION_MAX_TURNS, NEGOTIATION_MESSAGE_LIMIT, NegotiationLedger, isIntentExpired, negotiationOpenTemplate, opportunityTemplate, parseIntent, parseOpportunityResponse, hostStatusTemplate, signAndWrap, tagValue, unwrap, type HostStatus, type Intent, type Keypair } from '@indexnetwork/nostr';
import * as nip17 from 'nostr-tools/nip17';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';

import type { Relay } from '../relay/relay.js';
import type { Discovery } from './discovery.js';
import { HostState, type StoredOpportunity } from './state.js';

const MAX_OPENINGS_PER_INTENT = 3;

export interface ConnectionNotice {
  opportunity: StoredOpportunity;
  networkName: string;
  /** Per person: what their copy of the opportunity said. */
  headlines: Map<string, string>;
}

/** Outward hooks, used by the Buzz bridge. */
export interface HostHooks {
  onOpportunity?(notice: ConnectionNotice): void | Promise<void>;
  onConnected?(notice: ConnectionNotice): void | Promise<void>;
}

export class Host {
  readonly state: HostState;
  private readonly ledgers = new Map<string, NegotiationLedger>();
  private readonly headlines = new Map<string, Map<string, string>>();
  private hooks: HostHooks[] = [];

  constructor(private readonly relay: Relay, readonly key: Keypair, readonly discovery: Discovery) {
    this.state = new HostState(relay.store.db);
    for (const stored of this.state.negotiations()) {
      const ledger = new NegotiationLedger(stored.openEvent, key.pubkey);
      for (const turn of stored.turns) ledger.apply(turn);
      this.ledgers.set(stored.id, ledger);
    }
    relay.onEvent((event) => this.handle(event));
  }

  addHooks(hooks: HostHooks): void {
    this.hooks.push(hooks);
  }

  ledger(negotiationId: string): NegotiationLedger | undefined {
    return this.ledgers.get(negotiationId);
  }

  async handle(event: NostrEvent): Promise<void> {
    if (event.kind === KIND.INTENT) {
      const parsed = parseIntent(event);
      if (parsed.ok) await this.acceptIntent(parsed.intent, event, false);
      return;
    }
    if (event.kind === KIND.DELETION) {
      this.applyDeletion(event);
      return;
    }
    if (event.kind === KIND.GIFT_WRAP && tagValue(event, 'p') === this.key.pubkey) {
      if (!this.state.markWrapSeen(event.id)) return;
      const opened = unwrap(event, this.key.secretKey);
      if (!opened.ok || !opened.signed) return;
      const inner = opened.inner;
      if (inner.kind === KIND.INTENT) {
        const parsed = parseIntent(inner, { wrapped: true });
        if (parsed.ok && parsed.intent.visibility === 'incognito') {
          // The relay can't see inside the wrap, so membership is checked here.
          const member = parsed.intent.networks.every((network) => this.relay.groups.isMember(network, parsed.intent.principal));
          if (member) await this.acceptIntent(parsed.intent, inner, true);
        }
      } else if (inner.kind === KIND.NEGOTIATION_TURN) {
        await this.handleTurn(inner);
      } else if (inner.kind === KIND.OPPORTUNITY_RESPONSE) {
        await this.handleResponse(inner);
      }
    }
  }

  private applyDeletion(event: NostrEvent): void {
    for (const tag of event.tags) {
      if (tag[0] !== 'a' || !tag[1]) continue;
      const [kind, author] = tag[1].split(':');
      if (Number(kind) === KIND.INTENT && author === event.pubkey) this.state.deactivateIntent(tag[1]);
    }
  }

  /** Active intents the host may match, parsed. */
  private intents(): Intent[] {
    const result: Intent[] = [];
    for (const { event, wrapped } of this.state.activeIntents()) {
      const parsed = parseIntent(event, { wrapped });
      if (parsed.ok && !isIntentExpired(parsed.intent)) result.push(parsed.intent);
    }
    return result;
  }

  /** The networks an intent can be matched in: its own, or every network its owner is in. */
  private scope(intent: Intent): string[] {
    const networks = intent.networks.length > 0 ? intent.networks : this.relay.groups.groupsOf(intent.principal);
    return networks.filter((network) => this.relay.groups.isMember(network, intent.principal));
  }

  private async acceptIntent(intent: Intent, event: NostrEvent, wrapped: boolean): Promise<void> {
    if (intent.visibility === 'private' || isIntentExpired(intent)) return;
    this.state.upsertIntent(intent.address, event, wrapped);
    const mine = this.scope(intent);
    if (mine.length === 0) return;
    const others = this.intents().filter((other) => other.principal !== intent.principal && other.address !== intent.address);
    const scoped = others.filter((other) => this.scope(other).some((network) => mine.includes(network)));
    let opened = 0;
    for (const candidate of this.discovery.rank(intent, scoped)) {
      if (opened >= MAX_OPENINGS_PER_INTENT) break;
      const network = this.scope(candidate.intent).find((id) => mine.includes(id))!;
      if (await this.openNegotiation(intent, candidate.intent, network)) opened += 1;
    }
  }

  /**
   * Open a negotiation between two intents in a shared network. The newer
   * intent's owner moves first. Returns false if the pair already has one.
   */
  async openNegotiation(initiator: Intent, responder: Intent, networkId: string): Promise<NegotiationLedger | null> {
    const pair = [initiator.address, responder.address].sort().join('|');
    if (this.state.hasNegotiation(pair)) return null;
    const shown = (intent: Intent) => (intent.visibility === 'public' || intent.visibility === 'network_only' ? intent.text : null);
    const negotiationId = crypto.randomUUID();
    const openEvent = finalizeEvent(negotiationOpenTemplate({
      negotiationId,
      networkId,
      seats: [
        { principal: initiator.principal, negotiator: initiator.author, intent: { address: initiator.address, text: shown(initiator), visibility: initiator.visibility } },
        { principal: responder.principal, negotiator: responder.author, intent: { address: responder.address, text: shown(responder), visibility: responder.visibility } },
      ],
      maxTurns: NEGOTIATION_MAX_TURNS,
      messageLimit: NEGOTIATION_MESSAGE_LIMIT,
    }), this.key.secretKey);
    this.state.saveNegotiation(negotiationId, pair, openEvent);
    const ledger = new NegotiationLedger(openEvent, this.key.pubkey);
    this.ledgers.set(negotiationId, ledger);
    for (const negotiator of new Set([initiator.author, responder.author])) {
      await this.relay.publishTrusted(signAndWrap(openEvent, this.key.secretKey, negotiator).wrap);
    }
    return ledger;
  }

  private eligible(ledger: NegotiationLedger): boolean {
    const network = ledger.open.networkId;
    return ledger.open.seats.every((seat) => this.relay.groups.isMember(network, seat.principal) && this.state.isIntentActive(seat.intent.address));
  }

  private async handleTurn(turn: NostrEvent): Promise<void> {
    const negotiationId = tagValue(turn, 'negotiation') ?? '';
    const ledger = this.ledgers.get(negotiationId);
    if (!ledger) {
      if (/^[0-9a-f-]{36}$/.test(negotiationId)) await this.sendStatus({ type: 'turn', negotiationId, ref: turn.id, accepted: false, rejection: 'not_found' }, turn.pubkey);
      return;
    }
    ledger.setEligible(this.eligible(ledger));
    const decision = ledger.apply(turn);
    if (!decision.ok) {
      await this.sendStatus({ type: 'turn', negotiationId, ref: turn.id, accepted: false, rejection: decision.rejection, headId: ledger.headId }, turn.pubkey);
      return;
    }
    if (!decision.replayed) this.state.saveTurn(negotiationId, decision.turnIndex, turn);
    const status: HostStatus = {
      type: 'turn', negotiationId, ref: turn.id, accepted: true, turnIndex: decision.turnIndex, awaiting: decision.awaiting,
      outcome: decision.outcome, roundEnded: decision.roundEnded, headId: ledger.headId,
      turn: { id: turn.id, pubkey: turn.pubkey, created_at: turn.created_at, kind: turn.kind, tags: turn.tags, content: turn.content, sig: turn.sig },
    };
    for (const seat of ledger.open.seats) await this.sendStatus(status, seat.negotiator);
    if (!decision.replayed && decision.outcome === 'agreed') await this.createOpportunity(ledger);
  }

  private async createOpportunity(ledger: NegotiationLedger): Promise<void> {
    const agreed = ledger.agreedProposal();
    if (!agreed) return;
    const opportunityId = crypto.randomUUID();
    const [a, b] = ledger.open.seats;
    const network = this.relay.groups.get(ledger.open.networkId);
    const networkName = network?.name ?? ledger.open.networkId;
    const opportunity: StoredOpportunity = {
      id: opportunityId, negotiationId: ledger.negotiationId, networkId: ledger.open.networkId,
      parties: [a.principal, b.principal], status: 'pending', createdAt: Math.floor(Date.now() / 1000),
    };
    this.state.saveOpportunity(opportunity);
    const headlines = new Map<string, string>();
    for (const [seat, other] of [[a, b], [b, a]] as const) {
      const theirs = other.intent.text;
      const headline = clip(theirs ? `Someone in ${networkName}: ${theirs}` : `An incognito match in ${networkName}`, 280);
      const reasoning = clip(`Both negotiators agreed on: "${agreed.message}"${theirs ? '' : ' Their intent stays private until you both accept.'}`, 4000);
      headlines.set(seat.principal, headline);
      const event = finalizeEvent(opportunityTemplate({
        opportunityId, negotiationId: ledger.negotiationId, networkId: ledger.open.networkId,
        recipient: seat.principal, counterparty: other.principal, headline, reasoning, agreedTurnId: agreed.acceptTurnId,
      }), this.key.secretKey);
      for (const recipient of new Set([seat.principal, seat.negotiator])) {
        await this.relay.publishTrusted(signAndWrap(event, this.key.secretKey, recipient).wrap);
      }
    }
    this.headlines.set(opportunityId, headlines);
    for (const hooks of this.hooks) await hooks.onOpportunity?.({ opportunity, networkName, headlines });
  }

  private async handleResponse(event: NostrEvent): Promise<void> {
    const parsed = parseOpportunityResponse(event);
    if (!parsed.ok) return;
    const { response, person } = parsed;
    const opportunity = this.state.opportunity(response.opportunityId);
    if (!opportunity) return;
    // Only the person's own key counts. An agent can recommend; it cannot commit its owner.
    if (!opportunity.parties.includes(person)) {
      await this.sendStatus({ type: 'opportunity', opportunityId: opportunity.id, status: opportunity.status === 'connected' ? 'connected' : 'pending', ref: event.id, rejection: 'not_a_party' }, event.pubkey);
      return;
    }
    if (opportunity.status !== 'pending') {
      await this.sendStatus({ type: 'opportunity', opportunityId: opportunity.id, status: opportunity.status, ref: event.id }, person);
      return;
    }
    this.state.saveResponse(opportunity.id, person, response.decision, event);
    if (response.decision === 'decline') {
      this.state.setOpportunityStatus(opportunity.id, 'declined');
      // Only the person who declined hears about it; the other side just never gets an introduction.
      await this.sendStatus({ type: 'opportunity', opportunityId: opportunity.id, status: 'declined', ref: event.id }, person);
      return;
    }
    const responses = this.state.responses(opportunity.id);
    if (!opportunity.parties.every((party) => responses.get(party) === 'accept')) {
      await this.sendStatus({ type: 'opportunity', opportunityId: opportunity.id, status: 'accepted', ref: event.id }, person);
      return;
    }
    this.state.setOpportunityStatus(opportunity.id, 'connected');
    const connected = { ...opportunity, status: 'connected' as const };
    for (const party of opportunity.parties) await this.sendStatus({ type: 'opportunity', opportunityId: opportunity.id, status: 'connected', ref: event.id }, party);
    const network = this.relay.groups.get(opportunity.networkId);
    const intro = `You both said yes, so here's the introduction. You met through ${network?.name ?? opportunity.networkId} on Index. Reply here to start talking.`;
    for (const wrap of nip17.wrapManyEvents(this.key.secretKey, opportunity.parties.map((publicKey) => ({ publicKey })), intro, 'Index introduction')) {
      await this.relay.publishTrusted(wrap);
    }
    const notice = { opportunity: connected, networkName: network?.name ?? opportunity.networkId, headlines: this.headlines.get(opportunity.id) ?? new Map() };
    for (const hooks of this.hooks) await hooks.onConnected?.(notice);
  }

  private async sendStatus(status: HostStatus, recipient: string): Promise<void> {
    const { wrap } = signAndWrap(hostStatusTemplate(status, recipient), this.key.secretKey, recipient);
    await this.relay.publishTrusted(wrap);
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
