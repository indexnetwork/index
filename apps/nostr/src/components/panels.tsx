import { INTENT_VISIBILITIES, KIND, type IntentVisibility } from '@indexnetwork/nostr';
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, Bot, Lock, MessageSquare, Send, ShieldAlert, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import type { ClientState, IndexClient, IntentView, NegotiationView, OpportunityView } from '../lib/client.js';
import { kindName } from '../lib/client.js';
import type { DemoPartner } from '../lib/partner.js';
import { CopyButton, Empty, KindChip, Section, VisibilityChip, who, type Names } from './ui.js';

const VISIBILITY_HELP: Record<IntentVisibility, string> = {
  public: 'A plain event anyone can read.',
  network_only: 'A plain event the relay shows only to members of the networks you pick.',
  incognito: 'Encrypted to the Index host only. The other side never sees the text.',
  private: 'Encrypted to your own key. Never matched.',
};

// ── Intents ────────────────────────────────────────────────────────────

export function IntentsPanel({ client, state, names, partner }: { client: IndexClient; state: ClientState; names: Names; partner: DemoPartner }) {
  const myNetworks = state.networks.filter((network) => network.members.includes(client.pubkey));
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<IntentVisibility>('network_only');
  const [networks, setNetworks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [partnerFor, setPartnerFor] = useState<string | null>(null);
  const selected = networks.filter((id) => myNetworks.some((network) => network.id === id));
  const needsNetwork = visibility === 'network_only' && selected.length === 0;
  const mine = state.intents.filter((view) => view.mine);
  const others = state.intents.filter((view) => !view.mine);

  const submit = async () => {
    setBusy(true);
    try {
      await client.publishIntent({ text, visibility, networks: selected });
      setText('');
    } catch { /* surfaced as a notice */ } finally {
      setBusy(false);
    }
  };

  const callPartner = async (view: IntentView) => {
    setPartnerFor(view.intent.address);
    try {
      await partner.answer(view.intent, client);
      client.notice('The demo partner posted a matching intent. Watch Negotiations.');
    } catch (error) {
      client.notice(error instanceof Error ? error.message : String(error));
    } finally {
      setPartnerFor(null);
    }
  };

  return (
    <div className="space-y-8">
      <Section title="New intent" hint="What you're looking for or can offer. Signed with your key, kind 31641.">
        <div className="card space-y-3">
          <textarea className="input min-h-20" placeholder="e.g. Looking for a designer to shape onboarding for a Nostr client" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
          <div className="flex flex-wrap items-center gap-2">
            {INTENT_VISIBILITIES.map((option) => (
              <button key={option} type="button" onClick={() => setVisibility(option)} className={`chip border ${visibility === option ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600'}`}>
                {option.replace('_', '-')}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">{VISIBILITY_HELP[visibility]}</p>
          {visibility !== 'private' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-500">Networks:</span>
              {myNetworks.length === 0 && <span className="text-neutral-400">join one in Networks first</span>}
              {myNetworks.map((network) => (
                <label key={network.id} className="chip cursor-pointer border border-neutral-200 bg-white">
                  <input type="checkbox" checked={selected.includes(network.id)} onChange={(event) => setNetworks(event.target.checked ? [...selected, network.id] : selected.filter((id) => id !== network.id))} />
                  {network.name}
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={busy || !text.trim() || needsNetwork} onClick={() => void submit()}>
              <Send size={14} /> Publish
            </button>
          </div>
        </div>
      </Section>

      <Section title="Your intents" hint="Incognito and private intents are encrypted, so the relay can't show them back. This browser keeps your copy.">
        {mine.length === 0 ? <Empty>No intents yet.</Empty> : (
          <div className="space-y-2">
            {mine.map((view) => (
              <div key={view.event.id} className="card flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p>{view.intent.text}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <VisibilityChip visibility={view.intent.visibility} />
                    {view.wrapped && <span className="chip bg-neutral-100"><Lock size={10} /> gift-wrapped</span>}
                    {view.intent.networks.map((id) => <span key={id}>#{state.networks.find((network) => network.id === id)?.name ?? id}</span>)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {view.intent.visibility !== 'private' && (
                    <button type="button" className="btn-ghost" disabled={partnerFor !== null} onClick={() => void callPartner(view)} title="Spawn a demo partner that answers this intent">
                      <Bot size={14} /> {partnerFor === view.intent.address ? 'Calling…' : 'Demo partner'}
                    </button>
                  )}
                  <button type="button" className="btn-ghost" onClick={() => void client.deleteIntent(view)} title="Withdraw (NIP-09 deletion)"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="In your networks" hint="Public intents, and network-only intents the relay shows you because you're a member.">
        {others.length === 0 ? <Empty>Nothing visible yet.</Empty> : (
          <div className="space-y-2">
            {others.slice(0, 50).map((view) => (
              <div key={view.event.id} className="card space-y-1">
                <p>{view.intent.text}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <VisibilityChip visibility={view.intent.visibility} />
                  <span>{who(view.intent.principal, names)}</span>
                  {view.intent.agent && <span className="chip bg-amber-50 text-amber-700"><Bot size={10} /> via agent</span>}
                  {view.intent.networks.map((id) => <span key={id}>#{state.networks.find((network) => network.id === id)?.name ?? id}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Networks ───────────────────────────────────────────────────────────

export function NetworksPanel({ client, state }: { client: IndexClient; state: ClientState }) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);
  const [invite, setInvite] = useState<Record<string, string>>({});
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  const create = async () => {
    const id = `${slug || 'network'}-${Math.random().toString(36).slice(2, 6)}`;
    await client.createNetwork({ id, name: name.trim(), joinPolicy: open ? 'anyone' : 'invite_only' }).catch(() => undefined);
    setName('');
  };

  const add = async (id: string) => {
    const value = (invite[id] ?? '').trim();
    try {
      const { nip19 } = await import('nostr-tools');
      const pubkey = value.startsWith('npub1') ? (nip19.decode(value).data as string) : value;
      await client.addMember(id, pubkey);
      setInvite({ ...invite, [id]: '' });
    } catch (error) {
      client.notice(error instanceof Error ? error.message : 'not a valid npub');
    }
  };

  return (
    <div className="space-y-8">
      <Section title="Networks" hint="Each network is a NIP-29 group. The relay signs who's in it, and that decides who can read network-only intents.">
        {state.networks.length === 0 ? <Empty>No networks yet. Create the first one below.</Empty> : (
          <div className="space-y-2">
            {state.networks.map((network) => {
              const member = network.members.includes(client.pubkey);
              const admin = network.admins.includes(client.pubkey);
              return (
                <div key={network.id} className="card space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{network.name}</span>
                        <span className={`chip ${network.open ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>{network.open ? 'open' : 'invite only'}</span>
                        {admin && <span className="chip bg-accent-soft text-accent">admin</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                        <Users size={12} /> {network.members.length || '?'} members · <span className="font-mono">{network.id}</span>
                      </div>
                      {network.about && <p className="mt-1 text-sm text-neutral-500">{network.about}</p>}
                    </div>
                    {member
                      ? <button type="button" className="btn-ghost" onClick={() => void client.leaveNetwork(network.id).catch(() => undefined)}>Leave</button>
                      : <button type="button" className="btn-primary" disabled={!network.open} onClick={() => void client.joinNetwork(network.id).catch(() => undefined)}>{network.open ? 'Join' : 'Invite only'}</button>}
                  </div>
                  {admin && !network.open && (
                    <div className="flex gap-2">
                      <input className="input" placeholder="npub to add" value={invite[network.id] ?? ''} onChange={(event) => setInvite({ ...invite, [network.id]: event.target.value })} />
                      <button type="button" className="btn-ghost" onClick={() => void add(network.id)}>Add</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <Section title="Create a network" hint="Kind 9007. You become its admin.">
        <div className="card flex flex-wrap items-center gap-3">
          <input className="input flex-1" placeholder="Network name" value={name} onChange={(event) => setName(event.target.value)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={open} onChange={(event) => setOpen(event.target.checked)} /> Anyone can join</label>
          <button type="button" className="btn-primary" disabled={!name.trim()} onClick={() => void create()}>Create</button>
        </div>
      </Section>
    </div>
  );
}

// ── Negotiations ──────────────────────────────────────────────────────

export function NegotiationsPanel({ client, state, names }: { client: IndexClient; state: ClientState; names: Names }) {
  return (
    <Section title="Negotiations" hint="The Index host matched your intent with someone else's. Each turn is signed by its seat and checked against Index's rules, here in your browser too.">
      {state.negotiations.length === 0 ? <Empty>No negotiations yet. Publish an intent in a network, then try the demo partner.</Empty> : (
        <div className="space-y-4">
          {state.negotiations.map((negotiation) => <Negotiation key={negotiation.id} client={client} negotiation={negotiation} names={names} />)}
        </div>
      )}
    </Section>
  );
}

function Negotiation({ client, negotiation, names }: { client: IndexClient; negotiation: NegotiationView; names: Names }) {
  const [message, setMessage] = useState('');
  const myTurn = negotiation.awaiting === negotiation.me && !negotiation.outcome;
  const paused = negotiation.awaiting === null && !negotiation.outcome;
  const last = negotiation.turns.at(-1);
  const otherSeat = negotiation.open.seats.find((seat) => seat.principal === negotiation.other);
  const canAccept = last && last.seat !== negotiation.me && last.action === 'propose';
  const act = (action: 'propose' | 'counter' | 'accept' | 'decline') => {
    void client.sendTurn(negotiation, { action, message: message.trim() || defaultMessage(action) }).then(() => setMessage('')).catch(() => undefined);
  };
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          With <span className="font-medium">{who(negotiation.other, names)}</span>
          <span className="text-neutral-500"> · their intent: </span>
          {otherSeat?.intent.text ? <span>“{otherSeat.intent.text}”</span> : <span className="chip bg-violet-50 text-violet-700">incognito</span>}
        </div>
        <div className="flex items-center gap-2">
          {negotiation.verified
            ? <span className="chip bg-emerald-50 text-emerald-700" title="Replayed through decideNegotiationTurn in this browser"><BadgeCheck size={12} /> transcript verified</span>
            : <span className="chip bg-red-50 text-red-700"><ShieldAlert size={12} /> transcript refused</span>}
          {negotiation.outcome === 'agreed' && <span className="chip bg-accent-soft text-accent">agreed</span>}
        </div>
      </div>
      <ol className="space-y-2">
        {negotiation.turns.map((turn) => (
          <li key={turn.event.id} className={`rounded-lg px-3 py-2 text-sm ${turn.seat === negotiation.me ? 'ml-8 bg-neutral-900 text-white' : 'mr-8 bg-neutral-100'}`}>
            <div className="mb-0.5 text-xs opacity-70">{turn.seat === negotiation.me ? 'You' : who(turn.seat, names)} · {turn.action}</div>
            {turn.message}
          </li>
        ))}
        {negotiation.turns.length === 0 && <li className="text-sm text-neutral-500">No turns yet. {who(negotiation.open.seats[0].principal, names)} moves first.</li>}
      </ol>
      {negotiation.lastRejection && !negotiation.outcome && <p className="text-xs text-red-600">Last refused turn: {negotiation.lastRejection.replaceAll('_', ' ')}</p>}
      {(myTurn || paused) && negotiation.me && (
        <div className="space-y-2 border-t border-neutral-100 pt-3">
          <p className="text-xs text-neutral-500">{paused ? 'This round ended. You can start a new one.' : 'Your move.'}</p>
          <input className="input" placeholder="Message (optional)" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} />
          <div className="flex flex-wrap gap-2">
            {canAccept && !paused && <button type="button" className="btn-primary" onClick={() => act('accept')}>Accept</button>}
            <button type="button" className={canAccept && !paused ? 'btn-ghost' : 'btn-primary'} onClick={() => act('propose')}>Propose</button>
            {last && !paused && <button type="button" className="btn-ghost" onClick={() => act('counter')}>Counter</button>}
            {!paused && <button type="button" className="btn-ghost" onClick={() => act('decline')}>Decline</button>}
          </div>
        </div>
      )}
      {!myTurn && !paused && !negotiation.outcome && <p className="text-xs text-neutral-500">Waiting for {who(negotiation.awaiting, names)}.</p>}
    </div>
  );
}

function defaultMessage(action: string): string {
  return action === 'accept' ? 'Agreed, let\'s be introduced.' : action === 'decline' ? 'Not a fit right now.' : action === 'counter' ? 'Can you say more about what you need?' : 'Looks like a good fit. Shall we talk?';
}

// ── Opportunities ──────────────────────────────────────────────────────

export function OpportunitiesPanel({ client, state, names }: { client: IndexClient; state: ClientState; names: Names }) {
  return (
    <Section title="Opportunities" hint="When both negotiators agree, the host signs one opportunity for each person. Only your own key can accept it.">
      {state.opportunities.length === 0 ? <Empty>No opportunities yet.</Empty> : (
        <div className="space-y-2">
          {state.opportunities.map((opportunity) => <Opportunity key={opportunity.content.opportunityId} client={client} opportunity={opportunity} names={names} />)}
        </div>
      )}
    </Section>
  );
}

function Opportunity({ client, opportunity, names }: { client: IndexClient; opportunity: OpportunityView; names: Names }) {
  const status = { pending: 'Waiting for you', accepted: 'You accepted · waiting for them', declined: 'Declined', connected: 'Connected' }[opportunity.status];
  return (
    <div className="card space-y-2">
      <div className="flex items-start justify-between gap-4">
        <p className="font-medium">{opportunity.content.headline}</p>
        <span className={`chip shrink-0 ${opportunity.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>{status}</span>
      </div>
      <p className="text-sm text-neutral-600">{opportunity.content.reasoning}</p>
      <p className="text-xs text-neutral-500">With {who(opportunity.content.counterparty, names)}</p>
      {opportunity.status === 'pending' && (
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={() => void client.respond(opportunity, 'accept').catch(() => undefined)}>Accept</button>
          <button type="button" className="btn-ghost" onClick={() => void client.respond(opportunity, 'decline').catch(() => undefined)}>Decline</button>
        </div>
      )}
    </div>
  );
}

// ── Messages ───────────────────────────────────────────────────────────

export function MessagesPanel({ client, state, names }: { client: IndexClient; state: ClientState; names: Names }) {
  const host = state.hostPubkey;
  const threads = new Map<string, typeof state.messages>();
  for (const message of state.messages) {
    const key = message.participants.filter((pubkey) => pubkey !== host).join(',');
    threads.set(key, [...(threads.get(key) ?? []), message]);
  }
  return (
    <Section title="Messages" hint="NIP-17 direct messages: encrypted, gift-wrapped, readable only by the people in the thread.">
      {threads.size === 0 ? <Empty>No messages yet. Once both people accept an opportunity, the host introduces you here.</Empty> : (
        <div className="space-y-4">
          {[...threads.entries()].map(([key, messages]) => <Thread key={key} client={client} names={names} participants={key.split(',')} messages={messages} />)}
        </div>
      )}
    </Section>
  );
}

function Thread({ client, names, participants, messages }: { client: IndexClient; names: Names; participants: string[]; messages: ClientState['messages'] }) {
  const [text, setText] = useState('');
  const others = participants.filter((pubkey) => pubkey !== client.pubkey);
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><MessageSquare size={14} /> {others.map((pubkey) => who(pubkey, names)).join(', ') || 'Note to self'}</div>
      <ol className="space-y-2">
        {messages.map((message) => (
          <li key={message.id} className={`rounded-lg px-3 py-2 text-sm ${message.from === client.pubkey ? 'ml-8 bg-neutral-900 text-white' : 'mr-8 bg-neutral-100'}`}>
            <div className="mb-0.5 text-xs opacity-70">{message.from === client.pubkey ? 'You' : who(message.from, names)}</div>
            {message.content}
          </li>
        ))}
      </ol>
      {others.length > 0 && (
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void client.sendMessage(others, text.trim()).then(() => setText('')); }}>
          <input className="input" placeholder="Write a message" value={text} onChange={(event) => setText(event.target.value)} />
          <button type="submit" className="btn-primary"><Send size={14} /></button>
        </form>
      )}
    </div>
  );
}

// ── Wire ───────────────────────────────────────────────────────────────

export function WirePanel({ state }: { state: ClientState }) {
  return (
    <Section title="On the wire" hint="Every event this page sent or opened. Private steps travel as gift wraps (kind 1059); the inner kind is what's inside.">
      {state.wire.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <div className="card divide-y divide-neutral-100 p-0">
          {state.wire.map((entry) => (
            <div key={`${entry.direction}:${entry.id}`} className="flex items-center gap-3 px-4 py-2 text-sm">
              {entry.direction === 'out' ? <ArrowUpRight size={14} className="text-accent" /> : <ArrowDownLeft size={14} className="text-emerald-600" />}
              <KindChip kind={entry.kind} />
              {entry.inner !== undefined && <span className="text-xs text-neutral-500">→ kind {entry.inner} ({kindName(entry.inner)})</span>}
              <span className="flex-1 truncate">{entry.note}</span>
              <span className="font-mono text-xs text-neutral-400">{entry.id.slice(0, 10)}</span>
              <CopyButton value={entry.id} />
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-500">Kinds: 31641 intent · 4641 negotiation opening · 4642 turn · 4643 opportunity · 4644 answer · 4645 host status · {KIND.PRIVATE_DM} DM · 9007/9021/9022/9000 networks.</p>
    </Section>
  );
}
