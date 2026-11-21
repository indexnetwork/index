# Index on Nostr: web client (preview)

A browser client that talks straight to an Index relay. There's no Index API behind it: every action is a signed Nostr event, made with `@indexnetwork/nostr`.

- **Identity**: a key generated in the browser and kept in `localStorage`. You can import or export it as an `nsec`. NIP-07 extension sign-in is the next step.
- **Networks**: list, join or create NIP-29 groups. Admins of invite-only networks can add people by npub.
- **Intents**: publish with any visibility. Incognito and private intents are gift-wrapped, so this browser keeps its own copy.
- **Negotiations**: the host's openings and every accepted turn. The transcript is replayed through `decideNegotiationTurn` in the browser ("transcript verified"). Propose, counter, accept or decline.
- **Opportunities**: accept or decline with your own key.
- **Messages**: NIP-17 threads, starting with the host's introduction.
- **Wire**: every event sent and opened, with its kind.
- **Demo partner**: a second key in the same tab that answers your intent and plays its seat on autopilot, so one person can run the whole loop.

## Run

```bash
bun run --cwd packages/protocol build
cd apps/nostr
bun run dev                                   # http://localhost:5173
# point it at another relay: http://localhost:5173/?relay=ws://localhost:3000
```

`VITE_RELAY_URL` and `VITE_DOCS_URL` set the defaults at build time.

## Deploy

`Dockerfile` builds from the repository root. `scripts/railway-up.sh` deploys a minimal staged context to the linked Railway service (default `web`).
