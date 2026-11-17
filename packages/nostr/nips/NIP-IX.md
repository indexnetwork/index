NIP-IX
======

Index: Intents, Negotiations and Opportunities
----------------------------------------------

`draft` `optional` `relay`

**Depends on**: NIP-01, NIP-09, NIP-11, NIP-17, NIP-29, NIP-40, NIP-42, NIP-44, NIP-59, NIP-OA (Buzz `docs/nips/NIP-OA.md`)

## Abstract

This NIP defines how Index Network's discovery protocol runs on Nostr. People (or agents acting for them) publish **intents**: what they are looking for or can offer. Intents live in **networks**, which are NIP-29 groups. An **Index host** matches intents and opens a **negotiation** between the two people's negotiators. When both negotiators agree, the host writes an **opportunity** to each person, and connects them only after both people accept with their own keys.

Every step is a signed event. Private steps travel in NIP-59 gift wraps whose inner event stays signed, so a transcript can be checked by anyone it is shown to.

## Motivation

Index's primitives are signed claims between people: "I'm looking for X", "my agent proposes we talk", "I accept". On a central API those claims are rows in one company's database. As Nostr events they are portable and verifiable, they work with any relay that stores gift wraps, and they let Index meet people where they already are, starting with Buzz communities.

## Non-Goals

- This NIP does not define how intents are matched. Matching is the host's business; the wire format only says how a negotiation is opened.
- This NIP does not define end-to-end group encryption for networks. Network-only intents rely on the relay's read policy (NIP-29 membership), like any NIP-29 group.
- This NIP does not make the host unnecessary. The host sees incognito intents and every negotiation turn, as the Index API does today.

## Terminology

- **principal**: the person an event speaks for. The author, unless the event carries a valid NIP-OA `auth` tag, in which case the owner it names.
- **negotiator**: the key that negotiates for a principal: the principal's own key, or an agent key the principal attested.
- **host**: the Index service key that opens negotiations, witnesses turns and issues opportunities. Advertised in the relay's NIP-11 document as `index.host_pubkey`.
- **signed wrap**: a NIP-59 gift wrap whose sealed payload is a complete, signed event rather than an unsigned rumor.

## Kinds

| Kind | Name | Signer | Class | Travels |
|------|------|--------|-------|---------|
| `31641` | Intent | principal or attested agent | addressable (`d`) | plain (public, network_only) or signed wrap (incognito, private) |
| `4641` | Negotiation opening | host | regular | signed wrap to each negotiator |
| `4642` | Negotiation turn | negotiator | regular | signed wrap to the host (and optionally the counterparty) |
| `4643` | Opportunity | host | regular | signed wrap to each person (and their negotiator) |
| `4644` | Opportunity response | the person's own key | regular | signed wrap to the host |
| `4645` | Host status | host | regular | signed wrap |

Index also uses NIP-29 kinds `9000`, `9001`, `9007`, `9021`, `9022`, `39000`, `39001`, `39002` for networks, `1059`/`13` for wraps, and NIP-17 kind `14` for the introduction message.

Kind allocation was checked against the upstream NIPs registry and Buzz's `crates/buzz-core/src/kind.rs` (which reserves 40000–49999) on 2026-11-17.

## Signed Wraps

A signed wrap is NIP-59 with one change: the sealed payload is a signed event.

1. The author signs the inner event normally.
2. The author creates a kind `13` seal signed by the same key, whose content is the NIP-44 encryption of the inner event's JSON for the recipient.
3. A one-time key creates a kind `1059` wrap with one `p` tag (the recipient), whose content is the NIP-44 encryption of the seal's JSON.

Recipients MUST check that the seal's `pubkey` equals the inner event's `pubkey`, and MUST verify the inner event's signature. A wrap whose inner event has no signature is an ordinary NIP-17 rumor and MUST NOT be accepted for kinds `4641`–`4645` or `31641`.

## Event Formats

### kind:31641 Intent

The content is the intent in plain words (at most 2000 characters).

| Tag | Required | Meaning |
|-----|----------|---------|
| `d` | yes | Intent id (`[A-Za-z0-9._:-]{1,128}`). Republishing the same `d` replaces the intent. |
| `visibility` | yes | `public`, `network_only`, `incognito` or `private`. |
| `h` | for `network_only` | A network the intent is shared into. One tag per network. |
| `expiration` | no | NIP-40 expiry. |
| `auth` | no | NIP-OA tag when an agent publishes for its owner. |
| `alt` | no | NIP-31 description. |

By visibility:

- `public`: published plain. Anyone may read it.
- `network_only`: published plain with at least one `h` tag. Relays MUST serve it only to authenticated members of one of its networks.
- `incognito`: never published plain. Sent as a signed wrap to the host only. The host MAY match it, MUST NOT reveal its text to the counterparty, and MUST check the principal is a member of each `h` network.
- `private`: never published plain and never matched. Sent as signed wraps to the principal's own negotiators.

```json
{
  "kind": 31641,
  "pubkey": "<agent>",
  "tags": [
    ["d", "rust-hire"],
    ["visibility", "network_only"],
    ["h", "goa"],
    ["auth", "<owner>", "kind=31641", "<sig>"],
    ["alt", "Index intent"]
  ],
  "content": "Hiring a Rust engineer to build a Nostr relay"
}
```

Deleting an intent is a NIP-09 kind `5` with an `a` tag `31641:<author>:<d>`.

### kind:4641 Negotiation opening

Signed by the host and sent to both negotiators. Content is JSON:

```json
{
  "negotiationId": "<uuid>",
  "networkId": "goa",
  "seats": [
    { "principal": "<hex>", "negotiator": "<hex>", "intent": { "address": "31641:<author>:<d>", "text": null, "visibility": "incognito" } },
    { "principal": "<hex>", "negotiator": "<hex>", "intent": { "address": "31641:<author>:<d>", "text": "Hiring a Rust engineer…", "visibility": "network_only" } }
  ],
  "maxTurns": 12,
  "messageLimit": 4000
}
```

Tags: `["negotiation", <uuid>]`, `["h", <network>]`, one `p` per principal. The first seat moves first. `text` is null when the counterparty may not read the intent.

### kind:4642 Negotiation turn

Signed by a seat's principal or by its negotiator. Content is JSON `{ "action": "propose" | "counter" | "accept" | "decline", "message": "…", "clientTurnId"?: "<uuid>" }`.

Tags: `["negotiation", <uuid>]`, `["e", <previous>, "", "reply"]` where `<previous>` is the id of the last accepted turn or of the opening, `["p", <counterparty principal>]`, and `auth` when an agent signs.

A turn is accepted when it passes Index's negotiation rules (`decideNegotiationTurn` in `@indexnetwork/protocol`):

- only the seat whose turn it is may move;
- `counter` cannot open a round;
- `accept` answers the other seat's standing `propose`;
- `propose` cannot restate the other seat's standing `propose`;
- `decline`, or the last turn of a round (`maxTurns`), pauses the pair until a seat moves again;
- `accept` settles the negotiation as agreed.

A turn whose `e` tag names anything but the current head is refused as `raced`. Re-sending an accepted turn, or a turn with a `clientTurnId` already committed by that seat, is a no-op.

### kind:4643 Opportunity

Signed by the host, one per person, each framed for its recipient. Content is JSON `{ opportunityId, negotiationId, networkId, recipient, counterparty, headline, reasoning, agreedTurnId }`. Tags: `["opportunity", <uuid>]`, `["negotiation", <uuid>]`, `["e", <agreedTurnId>, "", "root"]`, `["p", <recipient>]`.

### kind:4644 Opportunity response

Content is JSON `{ "opportunityId": "<uuid>", "decision": "accept" | "decline" }`. Tags: `["opportunity", <uuid>]`, `["e", <opportunity event id>, "", "reply"]`.

The host MUST only count a response signed by the person's own key. An agent's NIP-OA attestation is not enough: Index never connects two people unless both humans commit.

### kind:4645 Host status

The host's verdict, sent as a signed wrap. Content is JSON, one of:

- `{ "type": "turn", negotiationId, ref, accepted, rejection?, turnIndex?, awaiting?, outcome?, roundEnded?, headId?, turn? }`. On an accepted turn the host sends it to both negotiators and includes the signed `turn`, so the counterparty receives it even if the seat wrapped it only to the host.
- `{ "type": "opportunity", opportunityId, status: "pending" | "accepted" | "declined" | "connected", ref?, rejection? }`. A decline is reported only to the person who declined.

When both people accept, the host sends each a NIP-17 kind `14` message introducing them.

## Networks

A network is a NIP-29 group whose id is the network id. Join policy `anyone` is an open group (a kind `9021` join request is granted); `invite_only` is a `closed` group (admins add members with kind `9000`). The relay signs `39000`, `39001` and `39002`. Membership in that state is what decides who may read a network's intents and who may publish into it.

## Relay Behavior

An Index relay:

- MUST require NIP-42 AUTH for every write, and accept writes only from the authenticated key (gift wraps excepted, whose author is a one-time key).
- MUST refuse kinds `4641`–`4645` outside a gift wrap.
- MUST refuse a kind `31641` with `h` tags unless its principal is a member of each network, and refuse incognito or private intents in the clear.
- MUST serve gift wraps only to the authenticated recipient, and `network_only` intents only to authenticated members.
- SHOULD accept AUTH events carrying a NIP-OA tag (Buzz's NIP-AA) and treat the connection as reading for the owner.
- MUST advertise the host key as `index.host_pubkey` in its NIP-11 document.

## Interoperability with Buzz

Buzz relays refuse kinds they do not know, so Index kinds are never posted to a Buzz relay in the clear. What crosses over:

- **Members**: a Buzz channel's relay-signed `39002` mirrors into an Index network.
- **Turns and opportunities**: signed wraps (`1059`) are stored by Buzz without being read.
- **Cards**: NIP-17 DMs from the Index host.
- **Conversations**: once both people accept, the host opens a private Buzz channel (`9007` with `visibility=private` and `p` tags for both people).

Buzz agents already carry NIP-OA attestations, so a Buzz agent can negotiate an Index seat without new keys.

Observed against a Buzz 0.2.0 relay (Railway template, November 2026):

- Wraps and seals sent to Buzz MUST use current timestamps. Buzz refuses events "too far from server time", so NIP-59's backdating can't be used there.
- A `9000` or `9007` that names several people adds only the first. Add one person per event.
- Updated `39002` member lists are not pushed to open subscriptions. Re-read them periodically.
- With `BUZZ_REQUIRE_AUTH_TOKEN=false`, a pubkey must still be a relay member (NIP-43 kind `9030`, sent by the relay owner or an admin) before it can authenticate.

## Security Considerations

- The host sees incognito intents and every turn. This matches the Index API's trust model today; it is not end-to-end private matching.
- Network-only intents are protected by relay policy, not encryption. A relay operator can read them.
- NIP-OA `created_at` conditions constrain the agent's self-declared timestamp; hosts that need freshness must enforce it separately.
- Signed wraps give up NIP-59's deniability on purpose. Do not use them for conversation.

## Privacy Considerations

- Wrap timestamps are randomized up to two days in the past, as in NIP-59.
- The `p` tag of a wrap reveals the recipient to the relay. Negotiation traffic between two people is therefore visible as traffic, though not as content.
- An agent's NIP-OA tag publicly links agent and owner keys.

## Reference Implementation

`@indexnetwork/nostr` (event builders, signed wraps, NIP-OA, the negotiation ledger) and `services/nostr` (relay, host and Buzz bridge) in github.com/indexnetwork/index.
