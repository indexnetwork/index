# Index Network Hermes Plugin

The Index plugin connects Hermes to Index on macOS through the signed **Index Connector**. The Index macOS app is optional: Hermes can connect, operate, reconnect, and disconnect without it.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Open the **Index** dashboard and select **Connect to Index**. The connector opens the browser, uses PKCE S256 and an exact `http://127.0.0.1:<49152-65535>/callback` callback, and stores the resulting dedicated `idxh_` credential only in the connector Keychain identity. The dashboard, plugin files, Hermes environment, browser JavaScript, logs, and connector responses never receive or persist that credential.

The owner approves the exact six normal-product capabilities:

- `manage:identity`
- `manage:premises`
- `manage:intents`
- `manage:networks`
- `manage:opportunities`
- `manage:negotiations`

They do **not** grant account security, billing, account deletion, credential or permission administration, or agent administration. The credential expires after 30 days, warns during its final seven days, and has no refresh token or silent renewal. Reconnect repeats browser approval and rotates the generation. Expired, stale, paused, or revoked Hermes activity leaves Index as the negotiation fallback.

Existing Hermes installations with historical plaintext configuration are forced through secure relogin: owned schedules are paused, the historical configuration is scrubbed and verified absent, and legacy authority is revoked before a replacement becomes active. If cleanup or revocation is uncertain, the connector is recovery-only; use its status/retry-disconnect path rather than treating the connection as active.

## Modes and capability boundary

`full` (the default) registers the normal Index tool/dashboard surface through the connector. `negotiator` registers exactly four handlers:

1. `index_agent_me`
2. `index_pickup_negotiation`
3. `index_respond_negotiation`
4. `index_consult_owner`

The negotiator is not a reduced version of the full six-action credential. It is a separate server-enforced scheduled-execution boundary: pickup/respond/consult require the selected agent, exact generation, native hidden one-shot run authority, and the closed action contracts. `INDEX_PLUGIN_MODE=negotiator` is fail-closed for unknown non-empty values. It has no dashboard, broad MCP wrappers, hook, command, or orchestrator skill.

## Connector boundary

Production uses only the verified connector at one of two fixed paths:

- `/Applications/Index Connector.app/Contents/MacOS/IndexConnector`
- `~/Applications/Index Connector.app/Contents/MacOS/IndexConnector`

The plugin rejects symlinks, unsafe ownership/modes, mismatched CMS release metadata, Team ID, bundle/designated requirement, hash, protocol version, build mode, or endpoint environment. It uses JSON lines protocol v1 with exactly `hello`, `status`, `authorize.start`, `authorize.poll`, `rest`, `mcp`, and `disconnect`; responses are correlated, bounded, and recursively secret-free. Connector forwarding has fixed production HTTPS endpoints, exact REST/MCP allowlists, 30-second ordinary request deadlines, 8 MiB upload limit, and bounded SSE/resource queues. No caller may supply an endpoint, header, credential, or arbitrary connector executable.

A source-only development transport exists for CI/headless development only and needs **both** `INDEX_PLUGIN_DEVELOPMENT_TRANSPORT=1` and the unshipped `.index-plugin-development` source marker. It is excluded from published packages and is not a production configuration.

## Owner controls and recovery

Owners use the website's connected-agent view to see nonsecret installation identity, granted actions, health, heartbeat, expiry, and whether Index is covering. They can pause (deselects Hermes but preserves an active credential), revoke (idempotently removes installation authority), or reconnect (fresh browser authorization only). The connector's `disconnect` is recovery-only when needed: it retains its Keychain item until the server's exact revocation receipt and any required denial probe are confirmed, then deletes it and clears nonsecret recovery state.

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/connector_protocol.py
python3 tests/migration.py
python3 tests/smoke.py
python3 tests/gateway.py
```

`plugin.yaml` is the static package capability union; package registration applies the runtime mode boundary. Do not edit `desktop/dist/plugin.js` manually.
