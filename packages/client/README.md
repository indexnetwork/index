# @indexnetwork/client

Index HTTP for an agent-bound API key. One class, ten calls, no model or loop.

```ts
import { IndexClient, wakesHost } from "@indexnetwork/client";

const client = new IndexClient();
const stop = client.events((event) => {
  if (wakesHost(event)) void client.listNegotiations();
});
```

## Env

| Variable | Role |
|---|---|
| `INDEX_API_URL` | Origin. Default `http://localhost:3001`. |
| `INDEX_API_KEY` | Required. Sent as `x-api-key`. |
| `INDEX_AGENT_ID` | Optional. Fences `submitTurn`, `sendPrincipal`, and `events`. |

`new IndexClient({ baseUrl?, apiKey?, agentId? })` fills the same fields. Refuse to construct with no key. Trailing `/` is stripped. Paths are `/api/...`. No `Authorization` header.

## Calls

| Method | HTTP |
|---|---|
| `me()` | `GET /api/auth/me` → `{ id, name, intro, location, timezone, profileConfirmed }` (memoized) |
| `listIntents(limit?)` | `POST /api/intents/list` → `{ id, statement, status }[]` |
| `discover(intentId, query)` | `POST /api/intents/:id/discover` → `{ intentId, userId, name, statement, networkId, score }[]` |
| `createOpportunities(intentId, counterparties)` | `POST /api/intents/:id/opportunities` → `{ opportunityId }[]` |
| `listNegotiations()` | `GET /api/negotiations?state=open` |
| `getNegotiation(id)` | `GET /api/opportunities/:id/negotiation` |
| `submitTurn(id, turn)` | `POST /api/opportunities/:id/negotiation/turns` |
| `events(onEvent)` | `GET /api/events` SSE, with `?consumer=` when an agent id is set. Returns a stop handle. |
| `principalInbox(intentId)` | `GET /api/conversations/agent/messages?intentId=` |
| `sendPrincipal(intentId, entries)` | `POST /api/conversations/agent/h2a?agentId=` |

`sendPrincipal` requires an agent id. `submitTurn` needs `expectedTurnCount`. Handshake `{ type: "connected" }` reaches `onEvent` on every connect and reconnect, after the unseen messages behind it have been replayed: it is where a caller recovers whatever it missed while the stream was down.

`discover` writes nothing; `createOpportunities` is idempotent on the pair, so a counterparty that already shares an opportunity reports that one. Both need an active signal the key's owner owns.

`wakesHost` is true only for `negotiation.turn` and `principal.input`.

Non-2xx throws `ApiError` (`status`, `error`). A 2xx body that is not JSON throws a distinct `Error`. JSON methods do not retry. The stream reconnects until stopped.
