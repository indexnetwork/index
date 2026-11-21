/** The relay's human-facing page: what this is, how to connect, and live counts. */
import { INDEX_KINDS, KIND, npub } from '@indexnetwork/nostr';

export interface LandingData {
  relayName: string;
  relayUrl: string;
  relayPubkey: string;
  hostPubkey: string;
  discovery: string;
  networks: { id: string; name: string; joinPolicy: string; members: number }[];
  counts: Record<string, number>;
  buzz: { connected: boolean; relayUrl: string; members: number } | null;
}

const KIND_NAMES: Record<number, string> = {
  [KIND.INTENT]: 'Intent (addressable; plain or gift-wrapped by visibility)',
  [KIND.NEGOTIATION_OPEN]: 'Negotiation opening (host-signed, gift-wrapped)',
  [KIND.NEGOTIATION_TURN]: 'Negotiation turn (seat-signed, gift-wrapped)',
  [KIND.OPPORTUNITY]: 'Opportunity (host-signed, one per person, gift-wrapped)',
  [KIND.OPPORTUNITY_RESPONSE]: 'Accept or decline (the person\'s own key, gift-wrapped)',
  [KIND.HOST_STATUS]: 'Host verdict on a turn or opportunity (gift-wrapped)',
};

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function renderLanding(data: LandingData): string {
  const networks = data.networks.length === 0
    ? '<p class="muted">No networks yet. Create one with a NIP-29 kind 9007 event.</p>'
    : `<table><tr><th>Network</th><th>Join</th><th>Members</th></tr>${data.networks.map((network) => `<tr><td><code>${escape(network.id)}</code> ${escape(network.name)}</td><td>${network.joinPolicy === 'anyone' ? 'open' : 'invite only'}</td><td>${network.members}</td></tr>`).join('')}</table>`;
  const counts = Object.entries(data.counts).map(([name, value]) => `<div class="stat"><b>${value}</b><span>${escape(name)}</span></div>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(data.relayName)}</title>
<style>
  :root { color-scheme: light dark; --accent: #4091BB; }
  body { font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; }
  h1 { font-size: 26px; margin-bottom: 4px; } h2 { font-size: 17px; margin-top: 32px; }
  code { font: 13px ui-monospace, monospace; background: color-mix(in srgb, currentColor 8%, transparent); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
  table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); vertical-align: top; }
  .muted { opacity: .65; } .badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--accent); color: white; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; } .stat { padding: 10px 14px; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 8px; min-width: 90px; }
  .stat b { display: block; font-size: 20px; } .stat span { font-size: 12px; opacity: .7; }
  a { color: var(--accent); }
</style></head><body>
<span class="badge">Preview</span>
<h1>Index on Nostr</h1>
<p>This is a Nostr relay run by Index. Intents, networks, negotiations and opportunities are signed Nostr events here, and the Index host matches them. It interoperates with <a href="https://github.com/block/buzz">Buzz</a> communities.</p>
<h2>Connect</h2>
<table>
<tr><td>Relay</td><td><code>${escape(data.relayUrl)}</code></td></tr>
<tr><td>Relay key</td><td><code>${npub(data.relayPubkey)}</code></td></tr>
<tr><td>Index host key</td><td><code>${npub(data.hostPubkey)}</code><br><span class="muted">Wrap incognito intents, negotiation turns and opportunity answers to this key.</span></td></tr>
<tr><td>Discovery</td><td><code>${escape(data.discovery)}</code>${data.discovery === 'preview-lexical' ? ' <span class="muted">(a word-overlap stand-in for Index\'s real discovery)</span>' : ''}</td></tr>
<tr><td>Buzz bridge</td><td>${data.buzz ? `${data.buzz.connected ? 'connected to' : 'reconnecting to'} <code>${escape(data.buzz.relayUrl)}</code>, ${data.buzz.members} members mirrored` : '<span class="muted">not configured</span>'}</td></tr>
</table>
<h2>Activity</h2>
<div class="stats">${counts}</div>
<h2>Networks</h2>
${networks}
<h2>Event kinds</h2>
<table>${INDEX_KINDS.map((kind) => `<tr><td><code>${kind}</code></td><td>${escape(KIND_NAMES[kind] ?? '')}</td></tr>`).join('')}
<tr><td><code>9000–9022, 39000–39002</code></td><td>Networks as NIP-29 groups</td></tr>
<tr><td><code>1059</code></td><td>NIP-59 gift wraps (served only to their recipient)</td></tr></table>
<p class="muted">Spec: <code>packages/nostr/nips/NIP-IX.md</code> in <a href="https://github.com/indexnetwork/index">indexnetwork/index</a>. Machine-readable info: request this URL with <code>Accept: application/nostr+json</code>.</p>
</body></html>`;
}
