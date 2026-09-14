# @indexnetwork/client

Index HTTP for an agent-bound API key. One class, eight calls, no model or loop.

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
| `INDEX_EXECUTOR_ID` | Optional. Fences `submitTurn` and `sendPrincipal`. |

`new IndexClient({ baseUrl?, apiKey?, executorId? })` fills the same fields. Refuse to construct with no key. Trailing `/` is stripped. Paths are `/api/...`. No `Authorization` header.

## Calls

| Method | HTTP |
|---|---|
| `me()` | `GET /api/auth/me` → `{ id, name, intro, location, timezone, profileConfirmed }` (memoized) |
| `listIntents(limit?)` | `POST /api/intents/list` → `{ id, statement, status }[]` |
| `listNegotiations()` | `GET /api/negotiations?state=open` |
| `getNegotiation(id)` | `GET /api/negotiations/:id` |
| `submitTurn(id, turn)` | `POST /api/negotiations/:id/turns` |
| `events(onEvent)` | `GET /api/events` SSE. Returns a stop handle. |
| `principalInbox(intentId)` | `GET /api/conversations/agent/messages?intentId=` |
| `sendPrincipal(intentId, entries)` | `POST /api/conversations/agent/h2a?executorId=` |

`sendPrincipal` requires an executor id. `submitTurn` needs `expectedTurnCount`. Handshake `{ type: "connected" }` is not passed to `onEvent`.

`wakesHost` is true only for `negotiation.opened`, `negotiation.turn`, and `principal.input`.

Non-2xx throws `ApiError` (`status`, `error`). A 2xx body that is not JSON throws a distinct `Error`. JSON methods do not retry. The stream reconnects until stopped.
