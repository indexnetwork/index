# Index Nostr node

One process that runs Index on Nostr:

- **Relay**: NIP-01, NIP-11, NIP-42 AUTH, NIP-29 networks, NIP-09 deletion, NIP-40 expiry, with Index's read/write policy (see [NIP-IX](../../packages/nostr/nips/NIP-IX.md#relay-behavior)). SQLite storage.
- **Index host**: matches intents, opens negotiations, checks every turn against Index's negotiation rules, writes opportunities, and introduces people once both accept.
- **Buzz bridge** (optional): mirrors a Buzz channel's members into an Index network, DMs opportunity cards on Buzz, and opens a private Buzz channel when two people connect.

```
           ┌──────────── Index Nostr node ─────────────┐
 clients ──┤ relay (policy, NIP-29 groups, SQLite)      │
 & agents  │   │ onEvent / publishTrusted               │
           │ host (discovery → negotiation → opportunity)├── Buzz bridge ──► Buzz relay
           └────────────────────────────────────────────┘   (members in, cards & channels out)
```

## Run it

```bash
# from the repo root
bun install
bun run --cwd packages/protocol build
cd services/nostr
bun run dev                     # ws://localhost:3000, throwaway keys
bun scripts/demo.ts             # walk the whole loop against it
```

Open http://localhost:3000 for the relay page, or request it with `Accept: application/nostr+json` for NIP-11.

### Docker

```bash
docker build -f services/nostr/Dockerfile -t index-nostr .
bun services/nostr/scripts/keygen.ts > nostr.env
docker run -p 3000:3000 -v index-nostr:/data --env-file nostr.env index-nostr
```

### Railway

`railway.toml` builds `services/nostr/Dockerfile` from the repo root and health-checks `/health`. Attach a volume at `/data`. Railway mounts volumes as root, so set `RAILWAY_RUN_UID=0` on the service.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP and WebSocket port. |
| `DATA_DIR` | `./data` (`/data` in the image) | Where `relay.sqlite` lives. |
| `PUBLIC_URL` | unset | The public `wss://` URL. When set, AUTH events must name this host. |
| `RELAY_SECRET_KEY` | throwaway in dev, required in production | Signs NIP-29 group state. Hex or `nsec`. Don't rotate it: it is the relay's identity. |
| `HOST_SECRET_KEY` | throwaway in dev, required in production | The Index host's key: opens negotiations, signs opportunities, and is the bot on Buzz. |
| `RELAY_NAME` | `Index relay (preview)` | NIP-11 name. |
| `DISCOVERY` | `lexical` | `lexical` runs the preview's word-overlap matcher; `off` leaves matching to an external discovery service. |
| `DISCOVERY_THRESHOLD` | `0.2` | Minimum overlap for the lexical matcher. |
| `BUZZ_RELAY_URL` | unset | Buzz relay to bridge (`wss://…`). The bridge is off unless this and `BUZZ_CHANNEL_ID` are set. |
| `BUZZ_CHANNEL_ID` | unset | The Buzz channel (UUID) whose members form the community. The host key must be able to read it. |
| `BUZZ_NETWORK_ID` | `buzz` | The Index network the channel mirrors into. |
| `BUZZ_RELAY_PUBKEY` | from NIP-11 | The Buzz relay's signing key, to check member lists. |

## HTTP

| Path | |
|---|---|
| `GET /` | Relay page (HTML), or NIP-11 with `Accept: application/nostr+json`. NIP-11 includes `index.host_pubkey`. |
| `GET /health` | Liveness plus host counts and Buzz bridge status. |
| `GET /networks` | Networks and member counts. |
| `GET /.well-known/nostr.json` | NIP-05 names `index` (host) and `relay`. |

## Tests

```bash
bun test   # relay policy, the full loop, and the Buzz bridge against a second relay instance
```

## Preview limits

- Discovery is a word-overlap stand-in. Production discovery stays in the Index API (embeddings, `openCounterparties`) and will drive the host instead.
- Opportunity copy is templated. Production copy comes from the API's opportunity presenter.
- One SQLite file, one node. Fine for a preview; production would move the store to Postgres.
