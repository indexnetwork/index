/**
 * A person's or agent's view of their gift wraps on one relay: subscribes to
 * wraps addressed to them, opens them, and lets callers wait for what they
 * expect. Used by the demo and the tests.
 */
import { KIND, parseHostStatus, unwrap, type AuthTag, type HostStatus, type Keypair } from '@indexnetwork/nostr';
import type { NostrEvent } from 'nostr-tools/pure';
import type { Relay } from 'nostr-tools/relay';

import { connectAuthed } from './client.js';

export class Inbox {
  readonly received: { inner: NostrEvent; signed: boolean }[] = [];
  private waiters: { predicate: (event: NostrEvent) => boolean; resolve: (event: NostrEvent) => void }[] = [];

  private constructor(readonly relay: Relay, readonly key: Keypair) {}

  static async open(url: string, key: Keypair, authTag?: AuthTag): Promise<Inbox> {
    const relay = await connectAuthed(url, key, { authTag });
    const inbox = new Inbox(relay, key);
    await new Promise<void>((resolve) => {
      relay.subscribe([{ kinds: [KIND.GIFT_WRAP], '#p': [key.pubkey] }], {
        onevent: (wrap) => inbox.accept(wrap),
        oneose: () => resolve(),
      });
    });
    return inbox;
  }

  private accept(wrap: NostrEvent): void {
    const opened = unwrap(wrap, this.key.secretKey);
    if (!opened.ok) return;
    this.received.push({ inner: opened.inner, signed: opened.signed });
    this.waiters = this.waiters.filter((waiter) => {
      if (!waiter.predicate(opened.inner)) return true;
      waiter.resolve(opened.inner);
      return false;
    });
  }

  /** Resolve with the first received (or future) inner event matching `predicate`. */
  waitFor(predicate: (event: NostrEvent) => boolean, label = 'event', timeoutMs = 5000): Promise<NostrEvent> {
    const existing = this.received.find((entry) => predicate(entry.inner));
    if (existing) return Promise.resolve(existing.inner);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      this.waiters.push({ predicate, resolve: (event) => { clearTimeout(timer); resolve(event); } });
    });
  }

  /** Wait for a host status matching `predicate`. */
  async waitForStatus(hostPubkey: string, predicate: (status: HostStatus) => boolean, label = 'host status'): Promise<HostStatus> {
    const event = await this.waitFor((inner) => {
      const status = parseHostStatus(inner, hostPubkey);
      return status !== null && predicate(status);
    }, label);
    return parseHostStatus(event, hostPubkey)!;
  }

  close(): void {
    this.relay.close();
  }
}
