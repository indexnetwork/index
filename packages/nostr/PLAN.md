# Index on Nostr: plan

Status: phase 0 shipped as a preview (this PR). Owner: TBD. Last updated 2026-11-17.

## Goal

Make Nostr the protocol underneath Index, so intents, networks, negotiations and opportunities are signed events that any client or agent can produce and check. Interoperate with Buzz (block/buzz) so Buzz communities can be Index networks and Buzz agents can negotiate Index seats, without depending on Buzz for anything Index-specific.

## Principles

- **Nostr-native, Buzz-compatible.** Index runs its own relay and its own event kinds. Buzz refuses kinds it doesn't know, so only standard events cross over: NIP-29 membership, NIP-59 gift wraps, NIP-17 DMs, private channels.
- **Same rules, any host.** Negotiations are checked by the same `decideNegotiationTurn` the API uses today. A transcript is a list of signed events anyone can replay.
- **Same trust model as today, made explicit.** The Index host still sees incognito intents and every turn. This plan does not promise private matching; it makes Index's claims portable and checkable.
- **Humans commit, agents recommend.** An agent can hold a seat with its owner's NIP-OA attestation. Only the person's own key can accept an opportunity.

## Primitive mapping

| Index | Nostr (Index relay) | Buzz |
|---|---|---|
| User | Keypair, kind 0, NIP-05 `name@index.network`; sign-in with NIP-07 / NIP-46; API calls with NIP-98 | Same key joins Buzz communities |
| Agent | Own keypair + NIP-OA `auth` tag from the owner | Buzz agents already carry NIP-OA |
| Network | NIP-29 group (9007/9021/9000/9001, relay-signed 39000–39002) | A Buzz channel's 39002 mirrors into an Index network |
| Intent | Kind 31641. Public/network-only plain; incognito wrapped to the host; private wrapped to own negotiators | Never posted to Buzz |
| Negotiation | 4641 opening (host), 4642 turns (seat), signed wraps; host relays accepted turns with 4645 | Wraps travel through Buzz unread when both agents live there |
| Opportunity | 4643 per person (host); 4644 accept/decline by the person's own key | NIP-17 card from the Index bot |
| Conversation | NIP-17 introduction | Private Buzz channel with both people |

Full wire format: [`nips/NIP-IX.md`](./nips/NIP-IX.md).

## Phases

### Phase 0: Protocol and preview (this PR)

- `@indexnetwork/nostr`: kinds, signed wraps, NIP-OA, builders/parsers, `NegotiationLedger`.
- `services/nostr`: relay + host + Buzz bridge, Dockerfile, Railway config, demo script, end-to-end tests.
- `@indexnetwork/protocol`: subpath exports for the negotiation rules.
- NIP-IX spec, READMEs, docs pages (marked preview).
- Preview deployment on its own Railway project (`index-nostr-preview`), separate from dev and prod, plus a Buzz relay from Buzz's Railway template.

Exit: the demo runs end to end against the preview; the Buzz bridge mirrors a real Buzz channel.

### Phase 1: Connect the API (the real engine)

The Nostr node stops guessing; the API does discovery and copy.

1. **Identity linking.** Add a Nostr sign-in to Better Auth (NIP-07 in the browser, NIP-46 for remote signers, NIP-98 for API calls). Store `users.nostr_pubkey` (unique). Agents get keys and NIP-OA tags issued by their owner.
2. **Intent sync.** API → relay: publish public and network-only intents as 31641 signed by a per-user delegated key or by the user's own signer. Relay → API: ingest 31641 from linked keys into `intents` (and incognito intents the host unwraps).
3. **Discovery.** Replace `LexicalDiscovery` with an adapter that calls the API's `openCounterparties`. The host keeps the Nostr side (openings, wraps, ledgers); the API decides who meets.
4. **Negotiation bridge.** Hosted negotiators (`hosted-agents`) sign turns with their own keys; `negotiations`/`negotiation_turns` store the signed event id and JSON. `NegotiationLedger` and the API's `Negotiations` capability must agree; add a contract test that replays API transcripts through the ledger.
5. **Opportunity copy.** Use the API's presenter for 4643 headline/reasoning.
6. **Storage.** Move the relay store from SQLite to Postgres (separate database), keep the NIP-01 semantics and tests.

Exit: an intent created in the web app appears on the relay, negotiates with a Nostr-native agent, and the opportunity shows in both the web app and a Nostr client.

### Phase 2: Buzz for real

1. Publish the Index bot as a Buzz persona pack (Open Plugin Spec layout: `.plugin/plugin.json`, `index.persona.md`, `.mcp.json` pointing at Index's MCP, a skill for publishing intents and negotiating).
2. Ship a Goose/Codex/Claude Code skill that signs turns with the agent's `BUZZ_PRIVATE_KEY` (confirm `buzz-acp` passes it through; not yet verified).
3. Bridge many communities: one bridge per (relay, channel), configured in the database instead of env vars.
4. Handle Buzz's auth modes: API tokens (`BUZZ_REQUIRE_AUTH_TOKEN`), relay membership (NIP-43), and NIP-AA for the bot.
5. Propose NIP-IX upstream to Buzz once there is usage, so Buzz clients can render intents and opportunities natively.

Exit: a Buzz community admin adds the Index bot, and members get matched without leaving Buzz.

### Phase 3: Open the network

1. Decide the public-intent question (see Open questions) before publishing public intents to relays Index doesn't run.
2. Outbox model: users' NIP-65 relay lists; the host reads intents from users' relays, not only Index's.
3. Multiple hosts: other operators run a host for their community; NIP-IX already names the host per relay.
4. Submit NIP-IX to nostr-protocol/nips as a draft.

## Packaging (following Buzz)

Buzz ships three independently versioned lanes (relay image, desktop, mobile), plain-markdown docs, custom NIPs in `docs/nips/`, a compose bundle and Helm chart for self-hosters, and a one-click Railway template. Index mirrors the parts that fit:

| Artifact | Index | Status |
|---|---|---|
| Library | `@indexnetwork/nostr` on npm (source-only today; add a `tsc` build like `@indexnetwork/client` before publishing) | Phase 1 |
| Node image | `ghcr.io/indexnetwork/nostr` from `services/nostr/Dockerfile`; tags `:main`, `:sha-<7>`, semver on `nostr-v*` | Phase 1 (CI workflow) |
| Railway template | "Index Nostr node": service + volume + `RAILWAY_RUN_UID=0` + generated keys; optional Buzz template next to it | Phase 1 |
| Compose bundle | `services/nostr/deploy/compose.yml` with Caddy TLS, like Buzz's `deploy/compose` | Phase 2 |
| Spec | `packages/nostr/nips/NIP-IX.md` in Buzz's NIP template | Done |
| Persona pack | Index bot for Buzz (Open Plugin Spec) | Phase 2 |
| Changelog | `packages/nostr/CHANGELOG.md`; node changes in the PR changelog sections | Done |

## Landing pages

On index.network (apps/web), next to the existing `/protocol`, `/hermes` and `/communities` pages:

1. **`/nostr`: Index on Nostr.** For developers. Hero: "Index speaks Nostr." The primitive mapping table, the relay URL and host npub, a 30-second "publish an intent" snippet, links to NIP-IX, the library and the docs. Live counts from `/health`.
2. **`/buzz`: Index for Buzz communities.** For community admins, shaped like `/hermes`. What the bot does (mirrors members, sends cards, opens intro channels), what it never does (post Index kinds, read channel messages), a three-step setup (add the bot's npub, pick a channel, done), and a privacy box.
3. **`/relay`: the relay page.** The node already serves a status page at `/`; give it the Index brand and link it from the footer once a stable domain exists (`relay.index.network`).
4. **Blog post: "Why we put Index on Nostr".** The trust model in plain words: what's portable now, what Index still sees, and why agents can't accept for you.
5. **Updates to existing pages.** `/protocol` gets a "Runs on Nostr" section; `/communities` gets a "Bring your Buzz community" card.

Each page needs: OG image, Plausible goal on the primary CTA, and copy review with brand. None ships before phase 1 exits; until then the docs pages carry a "Preview" badge.

## Documentation

docs.index.network (apps/docs, Vocs):

| Page | Audience | Phase |
|---|---|---|
| `nostr` (How it works → Nostr): the mapping, trust model, and preview status | everyone | 0 (this PR) |
| `integrate/nostr`: connect, AUTH, publish an intent, negotiate a seat, answer an opportunity, verify a transcript | client and agent builders | 0 (this PR) |
| `use/buzz`: add Index to a Buzz community | community admins | 0 (this PR, preview) |
| `integrate/nostr/self-host`: run your own node (Docker, Railway, env vars) | operators | 1 |
| `integrate/nostr/kinds`: generated reference from NIP-IX | builders | 1 |
| Guides: "Custom negotiator over Nostr", "Bring your own Buzz agent" | agent builders | 2 |

Repository docs: `packages/nostr/README.md`, `nips/NIP-IX.md`, `services/nostr/README.md` (this PR).

## Open questions

1. **Public intents as a commons.** Publishing public intents to open relays makes the public intent graph copyable by anyone. Decide before phase 3 whether public intents stay on Index-run relays only.
2. **Delegated keys.** Do we hold a per-user key for users without a Nostr signer, or require one? Holding keys keeps onboarding easy but makes Index a custodian.
3. **Host verdicts vs agent autonomy.** Agents can verify each other's turns without the host. Do we let two agents negotiate peer-to-peer and only show the host the final transcript?
4. **Kind numbers.** 31641 and 4641–4645 are unclaimed today; claim them upstream before phase 3.
5. **Buzz auth in production.** Which mode do real Buzz communities run (API tokens, NIP-43 membership, NIP-AA), and what does the admin have to do to admit the bot?

## Risks

- Buzz is young (0.x, launched July 2026). Interop is kept to standard NIPs so a Buzz change can't break Index's core.
- Relay policy, not encryption, protects network-only intents. Same as today's database, but worth saying on every page.
- Two engines (API and Nostr host) can drift. The ledger contract test in phase 1 is the guard.
