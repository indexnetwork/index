import { npub } from '@indexnetwork/nostr';
import { Github, KeyRound, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as nip19 from 'nostr-tools/nip19';

import { IntentsPanel, MessagesPanel, NegotiationsPanel, NetworksPanel, OpportunitiesPanel, WirePanel } from './components/panels.js';
import { CopyButton, type Names } from './components/ui.js';
import { IndexClient } from './lib/client.js';
import { importKey, loadKey, resetKeys } from './lib/keys.js';
import { DemoPartner } from './lib/partner.js';

const DEFAULT_RELAY = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'wss://nostr-production.up.railway.app';
const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? 'https://docs-production-81b7b3df.up.railway.app/nostr';
const TABS = ['intents', 'networks', 'negotiations', 'opportunities', 'messages', 'wire'] as const;
type Tab = typeof TABS[number];

function relayUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get('relay');
  return fromQuery && /^wss?:\/\//.test(fromQuery) ? fromQuery : DEFAULT_RELAY;
}

export function App() {
  const url = useMemo(relayUrl, []);
  const client = useMemo(() => new IndexClient(url, loadKey()), [url]);
  const partner = useMemo(() => new DemoPartner(url), [url]);
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const [tab, setTab] = useState<Tab>(() => (TABS as readonly string[]).includes(location.hash.slice(1)) ? location.hash.slice(1) as Tab : 'intents');
  const [intro, setIntro] = useState(() => localStorage.getItem('index-nostr:intro-dismissed') !== '1');
  const [keyMenu, setKeyMenu] = useState(false);

  useEffect(() => {
    void client.start();
    if (DemoPartner.used) void partner.start();
    return () => { client.close(); partner.client.close(); };
  }, [client, partner]);
  useEffect(() => { location.hash = tab; }, [tab]);

  const names: Names = useMemo(() => ({
    [client.pubkey]: 'You',
    [partner.pubkey]: 'Demo partner',
    ...(state.hostPubkey ? { [state.hostPubkey]: 'Index host' } : {}),
  }), [client.pubkey, partner.pubkey, state.hostPubkey]);

  const counts: Partial<Record<Tab, number>> = {
    negotiations: state.negotiations.filter((negotiation) => negotiation.awaiting === negotiation.me && !negotiation.outcome).length,
    opportunities: state.opportunities.filter((opportunity) => opportunity.status === 'pending').length,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="flex items-center gap-3">
          <img src="/logo-black-full.svg" alt="Index Network" className="h-6" />
          <span className="chip bg-accent-soft text-accent">on Nostr · preview</span>
        </div>
        <div className="relative flex items-center gap-3 text-sm">
          <span className={`inline-block h-2 w-2 rounded-full ${state.status === 'connected' ? 'bg-emerald-500' : state.status === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} title={state.error ?? state.status} />
          <button type="button" className="btn-ghost" onClick={() => setKeyMenu(!keyMenu)}><KeyRound size={14} /> {npub(client.pubkey).slice(0, 14)}…</button>
          {keyMenu && <KeyMenu client={client} onClose={() => setKeyMenu(false)} />}
        </div>
      </header>

      {state.status === 'error' && <div className="card mb-6 border-red-200 bg-red-50 text-sm text-red-700">{state.error}</div>}

      {intro && (
        <div className="card relative mb-6 space-y-2 bg-white">
          <button type="button" className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-900" onClick={() => { setIntro(false); localStorage.setItem('index-nostr:intro-dismissed', '1'); }}><X size={16} /></button>
          <h1 className="text-xl font-semibold">Index, running on Nostr</h1>
          <p className="text-sm text-neutral-600">Everything here is a signed Nostr event on <span className="font-mono text-xs">{url}</span>. This browser holds your key. Try it:</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600">
            <li><button type="button" className="underline" onClick={() => setTab('networks')}>Join or create a network</button> (a NIP-29 group).</li>
            <li>Publish an intent into it. Pick <em>incognito</em> to see the other side match it without reading it.</li>
            <li>Press <strong>Demo partner</strong> on your intent. A second key in this tab answers it.</li>
            <li>Watch the host open a negotiation. Accept their proposal, then accept the opportunity.</li>
            <li>You're introduced in Messages. The <button type="button" className="underline" onClick={() => setTab('wire')}>wire</button> tab shows every event.</li>
          </ol>
        </div>
      )}

      <nav className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50/90 px-4 backdrop-blur">
        {TABS.map((name) => (
          <button key={name} type="button" onClick={() => setTab(name)} className={`relative whitespace-nowrap px-3 py-3 text-sm capitalize ${tab === name ? 'font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-900'}`}>
            {name}
            {counts[name] ? <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs text-white">{counts[name]}</span> : null}
            {tab === name && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-neutral-900" />}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'intents' && <IntentsPanel client={client} state={state} names={names} partner={partner} />}
        {tab === 'networks' && <NetworksPanel client={client} state={state} />}
        {tab === 'negotiations' && <NegotiationsPanel client={client} state={state} names={names} />}
        {tab === 'opportunities' && <OpportunitiesPanel client={client} state={state} names={names} />}
        {tab === 'messages' && <MessagesPanel client={client} state={state} names={names} />}
        {tab === 'wire' && <WirePanel state={state} />}
      </main>

      <footer className="mt-16 flex flex-wrap gap-4 text-xs text-neutral-500">
        <span>{state.relayName || 'Index relay'}</span>
        <a className="hover:text-neutral-900" href={url.replace(/^ws/, 'http')} target="_blank" rel="noreferrer">Relay page</a>
        <a className="hover:text-neutral-900" href={DOCS_URL} target="_blank" rel="noreferrer">Docs</a>
        <a className="inline-flex items-center gap-1 hover:text-neutral-900" href="https://github.com/indexnetwork/index/blob/dev/packages/nostr/nips/NIP-IX.md" target="_blank" rel="noreferrer"><Github size={12} /> NIP-IX</a>
      </footer>

      <div className="fixed bottom-4 left-1/2 z-20 w-full max-w-md -translate-x-1/2 space-y-2 px-4">
        {state.notices.map((notice) => <div key={notice} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">{notice}</div>)}
      </div>
    </div>
  );
}

function KeyMenu({ client, onClose }: { client: IndexClient; onClose: () => void }) {
  const [reveal, setReveal] = useState(false);
  const nsec = nip19.nsecEncode(client.key.secretKey);
  return (
    <div className="card absolute right-0 top-11 z-30 w-80 space-y-3 shadow-lg">
      <div>
        <div className="text-xs text-neutral-500">Your public key</div>
        <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{npub(client.pubkey)}</span><CopyButton value={npub(client.pubkey)} /></div>
      </div>
      <div>
        <div className="text-xs text-neutral-500">Secret key (stored in this browser only)</div>
        {reveal
          ? <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{nsec}</span><CopyButton value={nsec} /></div>
          : <button type="button" className="text-xs underline" onClick={() => setReveal(true)}>Reveal nsec</button>}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
        <button type="button" className="btn-ghost" onClick={() => {
          const value = prompt('Paste an nsec or hex secret key');
          if (!value) return;
          try { importKey(value); location.reload(); } catch { alert('That is not a valid secret key.'); }
        }}>Import key</button>
        <button type="button" className="btn-ghost" onClick={() => { if (confirm('Start over with new keys? Your current key and local intents are deleted from this browser.')) { resetKeys(); location.reload(); } }}><RefreshCw size={14} /> New identity</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
