# @indexnetwork/nostr

Index Network on Nostr. Event kinds, builders, validators and verification for Index's primitives (intents, networks, negotiations and opportunities), so any Nostr client, agent or relay can take part in Index discovery.

The wire format is specified in [`nips/NIP-IX.md`](./nips/NIP-IX.md). The reference relay, host and Buzz bridge live in [`services/nostr`](../../services/nostr).

## How each primitive maps

| Index | On Nostr |
|---|---|
| User | A keypair. Profile is kind 0. |
| Agent | Its own keypair, plus a NIP-OA `auth` tag from its owner (the same scheme Buzz uses). |
| Network | A NIP-29 group. `anyone` = open, `invite_only` = closed. The relay signs membership (39002). |
| Intent | Kind 31641. Public and network-only intents are plain events; incognito intents are gift-wrapped to the Index host; private intents are gift-wrapped to the owner's negotiators. |
| Negotiation | Host-signed opening (4641) and seat-signed turns (4642), in gift wraps that keep the inner event signed. `NegotiationLedger` replays them through Index's own rules. |
| Opportunity | Host-signed, one per person (4643). Only the person's own key can accept (4644). |
| Conversation | A NIP-17 introduction, or a private Buzz channel. |

## Usage

```ts
import { createIntent, createAuthTag, signAndWrap, signTurn, replayNegotiation, KIND } from '@indexnetwork/nostr';

// An agent publishes an incognito intent for its owner.
const authTag = createAuthTag(owner.secretKey, agent.pubkey, `kind=${KIND.INTENT}`);
const { publish } = createIntent(
  { id: 'rust-hire', text: 'Hiring a Rust engineer', visibility: 'incognito', networks: ['goa'] },
  agent.secretKey,
  { hostPubkey, authTag },
);
await relay.publish(publish[0]); // a gift wrap only the host can open

// Later, a negotiation turn, wrapped to the host.
const turn = signTurn({ negotiationId, previousId: openEvent.id, counterparty, turn: { action: 'propose', message: '…' }, authTag }, agent.secretKey);
await relay.publish(signAndWrap(turn, agent.secretKey, hostPubkey).wrap);

// Anyone holding the transcript can check it.
const { ledger, refused } = replayNegotiation(openEvent, [turn /* , … */], hostPubkey);
```

## What's in here

- `kinds.ts`: Index kinds (31641, 4641–4645) and the standard kinds Index uses.
- `wrap.ts`: NIP-59 gift wraps whose inner event stays signed (`signAndWrap`, `wrapSigned`, `unwrap`).
- `attestation.ts`: NIP-OA owner attestation (`createAuthTag`, `verifyAttestation`, `principalOf`), tested against Buzz's published vectors.
- `intent.ts`, `negotiation.ts`, `opportunity.ts`, `status.ts`, `network.ts`: builders and parsers per primitive.
- `buzz.ts`: the Buzz-side events (private channels, channel messages, NIP-17 cards).

## Development

```bash
bun run --cwd ../protocol build   # the negotiation rules come from @indexnetwork/protocol
bun test
bun run typecheck
```
