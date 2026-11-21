/**
 * A browser client for an Index relay.
 *
 * It keeps one authenticated connection, opens every gift wrap addressed to
 * this key, and derives what the UI shows: networks, intents, negotiations
 * (replayed through Index's rules on every change), opportunities and
 * messages. Every event sent or received is also logged to `wire`, so the UI
 * can show the Nostr underneath.
 */
import { KIND, addMembersTemplate, createIntent, directMessage, createNetworkTemplate, hostStatusSchema, joinNetworkTemplate, leaveNetworkTemplate, opportunityResponseTemplate, parseIntent, parseNegotiationOpen, parseOpportunity, replayNegotiation, signAndWrap, signTurn, tagValue, tagValues, unwrap, type HostStatus, type Intent, type IntentVisibility, type JoinPolicy, type Keypair, type NegotiationOpen, type OpportunityContent, type OpportunityDecision, type TurnContent } from '@indexnetwork/nostr';
import { finalizeEvent, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';

export interface NetworkView { id: string; name: string; about: string; open: boolean; members: string[]; admins: string[] }
export interface IntentView { intent: Intent; event: NostrEvent; mine: boolean; wrapped: boolean }
export interface TurnView { index: number; event: NostrEvent; seat: string; action: TurnContent['action']; message: string }
export interface NegotiationView {
  id: string; open: NegotiationOpen; openEvent: NostrEvent; turns: TurnView[]; awaiting: string | null; outcome: string | null;
  roundEnded: string | null; verified: boolean; refusedAt: number | null; headId: string; me: string | null; other: string | null; lastRejection: string | null;
}
export interface OpportunityView { content: OpportunityContent; event: NostrEvent; status: 'pending' | 'accepted' | 'declined' | 'connected' }
export interface MessageView { id: string; from: string; participants: string[]; content: string; createdAt: number }
export interface WireEntry { at: number; direction: 'out' | 'in'; kind: number; id: string; note: string; inner?: number }

export interface ClientState {
  status: 'connecting' | 'connected' | 'error';
  error: string | null;
  relayName: string;
  hostPubkey: string | null;
  networks: NetworkView[];
  intents: IntentView[];
  negotiations: NegotiationView[];
  opportunities: OpportunityView[];
  messages: MessageView[];
  wire: WireEntry[];
  notices: string[];
}

const LOCAL_INTENTS = 'index-nostr:wrapped-intents:';
const now = () => Math.floor(Date.now() / 1000);

export class IndexClient {
  state: ClientState = { status: 'connecting', error: null, relayName: '', hostPubkey: null, networks: [], intents: [], negotiations: [], opportunities: [], messages: [], wire: [], notices: [] };
  private listeners = new Set<() => void>();
  private relay: Relay | null = null;
  private groups = new Map<string, { meta?: NostrEvent; members?: NostrEvent; admins?: NostrEvent }>();
  private plainIntents = new Map<string, NostrEvent>();
  private openings = new Map<string, NostrEvent>();
  private statuses: { status: HostStatus; event: NostrEvent }[] = [];
  private opportunityEvents = new Map<string, NostrEvent>();
  private messages = new Map<string, MessageView>();
  private seenWraps = new Set<string>();
  private dirty = false;

  constructor(readonly relayUrl: string, readonly key: Keypair, readonly label = 'you') {}

  get pubkey(): string { return this.key.pubkey; }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private emit(): void {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      this.state = this.derive();
      for (const listener of this.listeners) listener();
    });
  }

  private patch(partial: Partial<ClientState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  private log(entry: Omit<WireEntry, 'at'>): void {
    this.state = { ...this.state, wire: [{ ...entry, at: Date.now() }, ...this.state.wire].slice(0, 200) };
    this.emit();
  }

  notice(text: string): void {
    this.state = { ...this.state, notices: [...this.state.notices, text].slice(-4) };
    for (const listener of this.listeners) listener();
    setTimeout(() => {
      this.state = { ...this.state, notices: this.state.notices.filter((notice) => notice !== text) };
      for (const listener of this.listeners) listener();
    }, 6000);
  }

  private starting: Promise<void> | null = null;

  /** Connect once; later calls return the same attempt. */
  start(): Promise<void> {
    this.starting ??= this.connect();
    return this.starting;
  }

  private async connect(): Promise<void> {
    try {
      const info = await fetch(this.relayUrl.replace(/^ws/, 'http'), { headers: { Accept: 'application/nostr+json' } }).then((response) => response.json()) as { name?: string; index?: { host_pubkey?: string } };
      const hostPubkey = info.index?.host_pubkey ?? null;
      if (!hostPubkey) throw new Error('this relay does not advertise an Index host');
      this.patch({ relayName: info.name ?? this.relayUrl, hostPubkey });
      const relay = await Relay.connect(this.relayUrl);
      const sign = async (template: EventTemplate) => finalizeEvent(template, this.key.secretKey);
      relay.onauth = sign;
      const deadline = Date.now() + 5000;
      while (!(relay as unknown as { challenge?: string }).challenge) {
        if (Date.now() > deadline) throw new Error('the relay sent no AUTH challenge');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await relay.auth(sign);
      relay.onclose = () => this.patch({ status: 'error', error: 'disconnected from the relay; reload to reconnect' });
      this.relay = relay;
      relay.subscribe([{ kinds: [KIND.GROUP_METADATA, KIND.GROUP_ADMINS, KIND.GROUP_MEMBERS] }], { onevent: (event) => this.onGroup(event) });
      relay.subscribe([{ kinds: [KIND.INTENT], limit: 500 }], { onevent: (event) => this.onIntent(event) });
      relay.subscribe([{ kinds: [KIND.GIFT_WRAP], '#p': [this.pubkey] }], { onevent: (event) => this.onWrap(event) });
      this.patch({ status: 'connected' });
      this.emit();
    } catch (error) {
      this.patch({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  close(): void {
    this.relay?.close();
  }

  // ── incoming ─────────────────────────────────────────────────────────

  private onGroup(event: NostrEvent): void {
    if (!this.state.hostPubkey) return;
    const id = tagValue(event, 'd');
    if (!id) return;
    const entry = this.groups.get(id) ?? {};
    const slot = event.kind === KIND.GROUP_METADATA ? 'meta' : event.kind === KIND.GROUP_ADMINS ? 'admins' : 'members';
    if (entry[slot] && entry[slot]!.created_at > event.created_at) return;
    entry[slot] = event;
    this.groups.set(id, entry);
    this.emit();
  }

  private onIntent(event: NostrEvent): void {
    const address = `${event.kind}:${event.pubkey}:${tagValue(event, 'd') ?? ''}`;
    const existing = this.plainIntents.get(address);
    if (existing && existing.created_at >= event.created_at) return;
    this.plainIntents.set(address, event);
    this.emit();
  }

  private onWrap(wrap: NostrEvent): void {
    if (this.seenWraps.has(wrap.id)) return;
    this.seenWraps.add(wrap.id);
    const opened = unwrap(wrap, this.key.secretKey);
    if (!opened.ok) return;
    const inner = opened.inner;
    this.log({ direction: 'in', kind: KIND.GIFT_WRAP, id: wrap.id, inner: inner.kind, note: kindName(inner.kind) });
    const host = this.state.hostPubkey;
    if (inner.kind === KIND.PRIVATE_DM && !opened.signed) {
      const participants = [...new Set([inner.pubkey, ...tagValues(inner, 'p')])].sort();
      this.messages.set(inner.id ?? wrap.id, { id: inner.id ?? wrap.id, from: inner.pubkey, participants, content: inner.content, createdAt: inner.created_at });
    } else if (opened.signed && host && inner.pubkey === host) {
      if (inner.kind === KIND.NEGOTIATION_OPEN) {
        const parsed = parseNegotiationOpen(inner, host);
        if (parsed.ok) this.openings.set(parsed.open.negotiationId, inner);
      } else if (inner.kind === KIND.HOST_STATUS) {
        try {
          const status = hostStatusSchema.parse(JSON.parse(inner.content));
          this.statuses.push({ status, event: inner });
          if (status.type === 'turn' && !status.accepted && status.rejection) this.notice(`${this.label === 'you' ? 'Your' : `${this.label}'s`} turn was refused: ${status.rejection.replaceAll('_', ' ')}`);
        } catch { /* not ours */ }
      } else if (inner.kind === KIND.OPPORTUNITY) {
        const parsed = parseOpportunity(inner, host);
        if (parsed.ok && parsed.opportunity.recipient === this.pubkey) this.opportunityEvents.set(parsed.opportunity.opportunityId, inner);
      }
    }
    this.emit();
  }

  // ── derived views ────────────────────────────────────────────────────

  private derive(): ClientState {
    const host = this.state.hostPubkey;
    const networks: NetworkView[] = [...this.groups.entries()].filter(([, entry]) => entry.meta).map(([id, entry]) => ({
      id,
      name: tagValue(entry.meta!, 'name') ?? id,
      about: tagValue(entry.meta!, 'about') ?? '',
      open: !entry.meta!.tags.some((tag) => tag[0] === 'closed'),
      members: entry.members ? tagValues(entry.members, 'p') : [],
      admins: entry.admins ? tagValues(entry.admins, 'p') : [],
    })).sort((a, b) => a.name.localeCompare(b.name));

    const intents: IntentView[] = [];
    for (const event of this.plainIntents.values()) {
      const parsed = parseIntent(event);
      if (parsed.ok) intents.push({ intent: parsed.intent, event, mine: parsed.intent.principal === this.pubkey, wrapped: false });
    }
    for (const event of this.localIntents()) {
      const parsed = parseIntent(event, { wrapped: true });
      if (parsed.ok) intents.push({ intent: parsed.intent, event, mine: true, wrapped: true });
    }
    intents.sort((a, b) => b.intent.createdAt - a.intent.createdAt);

    const negotiations: NegotiationView[] = [];
    if (host) {
      for (const [id, openEvent] of this.openings) {
        const parsed = parseNegotiationOpen(openEvent, host);
        if (!parsed.ok) continue;
        const accepted = new Map<number, NostrEvent>();
        let lastRejection: string | null = null;
        let roundEnded: string | null = null;
        for (const { status } of this.statuses) {
          if (status.type !== 'turn' || status.negotiationId !== id) continue;
          if (status.accepted && status.turn && status.turnIndex !== undefined) accepted.set(status.turnIndex, status.turn as NostrEvent);
          if (!status.accepted) lastRejection = status.rejection ?? null;
        }
        const ordered = [...accepted.entries()].sort((a, b) => a[0] - b[0]).map(([, event]) => event);
        const { ledger, refused } = replayNegotiation(openEvent, ordered, host);
        const turns: TurnView[] = ledger.turns.map((event, index) => {
          const content = JSON.parse(event.content) as TurnContent;
          const seat = parsed.open.seats.find((candidate) => candidate.principal === event.pubkey || candidate.negotiator === event.pubkey)?.principal ?? event.pubkey;
          return { index, event, seat, action: content.action, message: content.message };
        });
        const last = this.statuses.filter(({ status }) => status.type === 'turn' && status.negotiationId === id && status.accepted).at(-1)?.status;
        if (last && last.type === 'turn') roundEnded = last.roundEnded ?? null;
        const me = parsed.open.seats.find((seat) => seat.principal === this.pubkey || seat.negotiator === this.pubkey)?.principal ?? null;
        const other = parsed.open.seats.find((seat) => seat.principal !== me)?.principal ?? null;
        negotiations.push({
          id, open: parsed.open, openEvent, turns, awaiting: ledger.awaiting, outcome: ledger.outcome, roundEnded,
          verified: refused === null, refusedAt: refused ? ordered.indexOf(refused.event) : null, headId: ledger.headId, me, other, lastRejection,
        });
      }
    }
    negotiations.sort((a, b) => b.openEvent.created_at - a.openEvent.created_at);

    const opportunities: OpportunityView[] = [];
    for (const [id, event] of this.opportunityEvents) {
      const content = JSON.parse(event.content) as OpportunityContent;
      let status: OpportunityView['status'] = 'pending';
      for (const { status: entry } of this.statuses) {
        if (entry.type === 'opportunity' && entry.opportunityId === id && !entry.rejection) status = entry.status === 'pending' ? status : entry.status;
      }
      opportunities.push({ content, event, status });
    }
    opportunities.sort((a, b) => b.event.created_at - a.event.created_at);

    const messages = [...this.messages.values()].sort((a, b) => a.createdAt - b.createdAt);
    return { ...this.state, networks, intents, negotiations, opportunities, messages };
  }

  // ── local copies of wrapped intents (the relay can't show them back) ──

  private localIntents(): NostrEvent[] {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_INTENTS + this.pubkey) ?? '[]') as NostrEvent[];
    } catch {
      return [];
    }
  }

  private saveLocalIntents(events: NostrEvent[]): void {
    localStorage.setItem(LOCAL_INTENTS + this.pubkey, JSON.stringify(events));
  }

  // ── actions ──────────────────────────────────────────────────────────

  private async publish(event: NostrEvent, note: string): Promise<void> {
    if (!this.relay) throw new Error('not connected');
    this.log({ direction: 'out', kind: event.kind, id: event.id, note });
    try {
      await this.relay.publish(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice(message);
      throw error;
    }
  }

  private async publishWrapped(template: EventTemplate, recipient: string, note: string): Promise<NostrEvent> {
    const { inner, wrap } = signAndWrap(template, this.key.secretKey, recipient);
    if (!this.relay) throw new Error('not connected');
    this.log({ direction: 'out', kind: KIND.GIFT_WRAP, id: wrap.id, inner: inner.kind, note });
    await this.relay.publish(wrap);
    return inner;
  }

  async createNetwork(params: { id: string; name: string; about?: string; joinPolicy: JoinPolicy }): Promise<void> {
    await this.publish(finalizeEvent(createNetworkTemplate(params), this.key.secretKey), `create network ${params.id}`);
  }

  async joinNetwork(id: string): Promise<void> {
    await this.publish(finalizeEvent(joinNetworkTemplate(id), this.key.secretKey), `join ${id}`);
  }

  async leaveNetwork(id: string): Promise<void> {
    await this.publish(finalizeEvent(leaveNetworkTemplate(id), this.key.secretKey), `leave ${id}`);
  }

  async addMember(id: string, pubkey: string): Promise<void> {
    await this.publish(finalizeEvent(addMembersTemplate(id, [pubkey]), this.key.secretKey), `add member to ${id}`);
  }

  async publishIntent(params: { text: string; visibility: IntentVisibility; networks: string[] }): Promise<Intent> {
    const host = this.state.hostPubkey;
    if (!host) throw new Error('no Index host');
    const id = `i-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { intent, publish } = createIntent({ id, ...params }, this.key.secretKey, { hostPubkey: host, privateRecipients: [this.pubkey] });
    if (params.visibility === 'incognito' || params.visibility === 'private') {
      this.saveLocalIntents([intent, ...this.localIntents()]);
      for (const wrap of publish) {
        this.log({ direction: 'out', kind: KIND.GIFT_WRAP, id: wrap.id, inner: KIND.INTENT, note: `${params.visibility} intent` });
        await this.relay!.publish(wrap);
      }
    } else {
      await this.publish(publish[0]!, `${params.visibility} intent`);
      this.onIntent(intent);
    }
    this.emit();
    const parsed = parseIntent(intent, { wrapped: params.visibility === 'incognito' || params.visibility === 'private' });
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.intent;
  }

  async deleteIntent(view: IntentView): Promise<void> {
    const deletion = finalizeEvent({ kind: KIND.DELETION, created_at: now(), tags: [['a', view.intent.address]], content: 'withdrawn' }, this.key.secretKey);
    await this.publish(deletion, 'withdraw intent');
    this.plainIntents.delete(view.intent.address);
    this.saveLocalIntents(this.localIntents().filter((event) => event.id !== view.event.id));
    this.emit();
  }

  async sendTurn(negotiation: NegotiationView, turn: TurnContent): Promise<void> {
    const host = this.state.hostPubkey;
    if (!host || !negotiation.other) throw new Error('not a seat in this negotiation');
    const event = signTurn({ negotiationId: negotiation.id, previousId: negotiation.headId, counterparty: negotiation.other, turn }, this.key.secretKey);
    if (!this.relay) throw new Error('not connected');
    const { wrap } = { wrap: signAndWrap(event, this.key.secretKey, host).wrap };
    this.log({ direction: 'out', kind: KIND.GIFT_WRAP, id: wrap.id, inner: KIND.NEGOTIATION_TURN, note: `turn: ${turn.action}` });
    await this.relay.publish(wrap);
  }

  async respond(opportunity: OpportunityView, decision: OpportunityDecision): Promise<void> {
    const host = this.state.hostPubkey;
    if (!host) throw new Error('no Index host');
    await this.publishWrapped(opportunityResponseTemplate({ opportunityId: opportunity.content.opportunityId, opportunityEventId: opportunity.event.id, decision }), host, `opportunity: ${decision}`);
  }

  async sendMessage(recipients: string[], text: string): Promise<void> {
    if (!this.relay) throw new Error('not connected');
    for (const wrap of directMessage(this.key.secretKey, recipients, text)) {
      this.log({ direction: 'out', kind: KIND.GIFT_WRAP, id: wrap.id, inner: KIND.PRIVATE_DM, note: 'message' });
      await this.relay.publish(wrap);
    }
  }
}

export function kindName(kind: number): string {
  switch (kind) {
    case KIND.INTENT: return 'intent';
    case KIND.NEGOTIATION_OPEN: return 'negotiation opening';
    case KIND.NEGOTIATION_TURN: return 'negotiation turn';
    case KIND.OPPORTUNITY: return 'opportunity';
    case KIND.OPPORTUNITY_RESPONSE: return 'opportunity answer';
    case KIND.HOST_STATUS: return 'host status';
    case KIND.PRIVATE_DM: return 'direct message';
    case KIND.GROUP_CREATE: return 'create network';
    case KIND.GROUP_JOIN_REQUEST: return 'join network';
    case KIND.GROUP_LEAVE_REQUEST: return 'leave network';
    case KIND.GROUP_PUT_USER: return 'add member';
    case KIND.DELETION: return 'deletion';
    case KIND.GIFT_WRAP: return 'gift wrap';
    default: return `kind ${kind}`;
  }
}
