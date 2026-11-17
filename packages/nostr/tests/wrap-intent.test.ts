import { describe, expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools/pure';
import * as nip17 from 'nostr-tools/nip17';

import { createAuthTag } from '../src/attestation.js';
import { createIntent, parseIntent } from '../src/intent.js';
import { generateKeypair } from '../src/keys.js';
import { KIND } from '../src/kinds.js';
import { signAndWrap, unwrap } from '../src/wrap.js';

const host = generateKeypair();
const alice = generateKeypair();

describe('signed gift wraps', () => {
  test('round-trip keeps the inner event signed and hides it from others', () => {
    const { inner, wrap } = signAndWrap({ kind: KIND.NEGOTIATION_TURN, created_at: 1, tags: [], content: 'hi' }, alice.secretKey, host.pubkey);
    expect(wrap.kind).toBe(KIND.GIFT_WRAP);
    expect(wrap.pubkey).not.toBe(alice.pubkey);
    expect(wrap.tags).toEqual([['p', host.pubkey]]);
    const opened = unwrap(wrap, host.secretKey);
    expect(opened.ok && opened.signed && opened.inner.id).toBe(inner.id);
    expect(unwrap(wrap, generateKeypair().secretKey)).toEqual({ ok: false, reason: 'undecryptable' });
  });

  test('opens ordinary NIP-17 DMs as unsigned', () => {
    const wrap = nip17.wrapEvent(alice.secretKey, { publicKey: host.pubkey }, 'hello');
    const opened = unwrap(wrap, host.secretKey);
    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.signed).toBe(false);
  });
});

describe('intents', () => {
  test('public and network-only intents go out in the clear', () => {
    const pub = createIntent({ id: 'i1', text: 'Looking for a Rust engineer', visibility: 'public' }, alice.secretKey, { hostPubkey: host.pubkey });
    expect(pub.publish).toEqual([pub.intent]);
    const parsed = parseIntent(pub.intent);
    expect(parsed.ok && parsed.intent.principal).toBe(alice.pubkey);

    const net = createIntent({ id: 'i2', text: 'Need a designer', visibility: 'network_only', networks: ['goa'] }, alice.secretKey, { hostPubkey: host.pubkey });
    const parsedNet = parseIntent(net.publish[0]!);
    expect(parsedNet.ok && parsedNet.intent.networks).toEqual(['goa']);
    expect(() => createIntent({ id: 'i3', text: 'x', visibility: 'network_only' }, alice.secretKey, { hostPubkey: host.pubkey })).toThrow();
  });

  test('incognito intents only reach the host, and are refused in the clear', () => {
    const inc = createIntent({ id: 'i4', text: 'Quietly hiring', visibility: 'incognito', networks: ['goa'] }, alice.secretKey, { hostPubkey: host.pubkey });
    expect(inc.publish).toHaveLength(1);
    expect(inc.publish[0]!.kind).toBe(KIND.GIFT_WRAP);
    expect(parseIntent(inc.intent)).toEqual({ ok: false, reason: 'incognito intents must be gift-wrapped' });
    const opened = unwrap(inc.publish[0]!, host.secretKey);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(parseIntent(opened.inner, { wrapped: true }).ok).toBe(true);
  });

  test('private intents go to the owner\'s negotiators only', () => {
    const negotiator = generateKeypair();
    const priv = createIntent({ id: 'i5', text: 'Not now', visibility: 'private' }, alice.secretKey, { hostPubkey: host.pubkey, privateRecipients: [negotiator.pubkey] });
    expect(priv.publish[0]!.tags).toEqual([['p', negotiator.pubkey]]);
    expect(() => createIntent({ id: 'i6', text: 'x', visibility: 'private' }, alice.secretKey, { hostPubkey: host.pubkey })).toThrow();
  });

  test('an attested agent publishes for its owner', () => {
    const agent = generateKeypair();
    const authTag = createAuthTag(alice.secretKey, agent.pubkey, `kind=${KIND.INTENT}`);
    const pub = createIntent({ id: 'i7', text: 'Agent-written intent', visibility: 'public' }, agent.secretKey, { hostPubkey: host.pubkey, authTag });
    const parsed = parseIntent(pub.intent);
    expect(parsed.ok && [parsed.intent.principal, parsed.intent.agent]).toEqual([alice.pubkey, agent.pubkey]);
  });

  test('rejects tampered and malformed intents', () => {
    const pub = createIntent({ id: 'i8', text: 'x', visibility: 'public' }, alice.secretKey, { hostPubkey: host.pubkey });
    expect(parseIntent({ ...pub.intent, content: 'changed' }).ok).toBe(false);
    const noVisibility = finalizeEvent({ kind: KIND.INTENT, created_at: 1, tags: [['d', 'x']], content: 'x' }, alice.secretKey);
    expect(parseIntent(noVisibility).ok).toBe(false);
  });
});

describe('Buzz DMs', () => {
  test('use current timestamps and open as NIP-17 rumors', async () => {
    const { buzzDirectMessage } = await import('../src/buzz.js');
    const bob = generateKeypair();
    const wraps = buzzDirectMessage(host.secretKey, [bob.pubkey], 'hello from Index');
    expect(wraps).toHaveLength(2); // Bob's copy and the sender's
    const now = Math.floor(Date.now() / 1000);
    for (const wrap of wraps) expect(Math.abs(wrap.created_at - now)).toBeLessThan(5);
    const opened = unwrap(wraps.find((wrap) => wrap.tags[0]![1] === bob.pubkey)!, bob.secretKey);
    expect(opened.ok && !opened.signed && opened.inner.content).toBe('hello from Index');
  });
});
