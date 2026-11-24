/** A small authenticated relay client for the bridge, the demo and tests. */
import type { AuthTag, Keypair } from '@indexnetwork/nostr';
import { Relay } from 'nostr-tools/relay';
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure';

/**
 * Connect and answer the relay's NIP-42 challenge.
 *
 * @param authTag - A NIP-OA tag, so an agent authenticates as acting for its owner (NIP-AA).
 */
export async function connectAuthed(url: string, key: Keypair, options: { authTag?: AuthTag; timeoutMs?: number } = {}): Promise<Relay> {
  const relay = await Relay.connect(url);
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  // nostr-tools keeps the challenge privately; wait for it to arrive after the socket opens.
  while (!(relay as unknown as { challenge?: string }).challenge) {
    if (Date.now() > deadline) throw new Error(`${url} sent no AUTH challenge`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const sign = async (template: EventTemplate) => {
    const tags = options.authTag ? [...template.tags, [...options.authTag]] : template.tags;
    return finalizeEvent({ ...template, tags }, key.secretKey);
  };
  await relay.auth(sign);
  relay.onauth = sign;
  return relay;
}
