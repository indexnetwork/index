# @indexnetwork/client

Index HTTP for an agent-bound API key. One class, no model or loop.

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
| `INDEX_EXECUTOR_ID` | Required for external agent operation. Fences `discover`, `submitTurn`, and `sendPrincipal`. |

`new IndexClient({ baseUrl?, apiKey?, executorId? })` fills the same fields. Refuse to construct with no key. Trailing `/` is stripped. Paths are `/api/...`. No `Authorization` header.

## Calls

| Method | HTTP |
|---|---|
| `me()` | `GET /api/auth/me` → `{ id, name, intro, location, timezone, profileConfirmed }` (memoized) |
| `listIntents(limit?)` | `POST /api/intents/list` → `{ id, statement, status }[]` |
| `discover(intentId, signal?)` | `POST /api/intents/:id/discover?executorId=` with no body → newly opened `{ opportunityId }[]` |
| `listNegotiations()` | `GET /api/negotiations?state=open` |
| `getNegotiation(id)` | `GET /api/opportunities/:id/negotiation` |
| `submitTurn(id, turn)` | `POST /api/opportunities/:id/negotiation/turns` |
| `events(onEvent)` | `GET /api/events` SSE. Returns a stop handle. |
| `principalInbox(intentId)` | `GET /api/conversations/agent/messages?intentId=` |
| `sendPrincipal(intentId, entries)` | `POST /api/conversations/agent/h2a?executorId=` |

`sendPrincipal` requires an executor id. `submitTurn` needs `expectedTurnCount`. Handshake `{ type: "connected" }` is not passed to `onEvent`.

`discover` requires an active signal the key's owner owns. TypeSafe scores every
eligible public intent/network pair in its shared communities, with no pass/fail
threshold or `0.8` cutoff. The discovery library returns all still-eligible scored
pairs in descending score order; the host walks that ranking until **up to 10 new
negotiations per intent per matching run** are created or candidates are exhausted.
Existing/reused, terminal, and unavailable sessions do not consume that new-opening
budget, so this is not a first-ten-candidates limit. There are no search queries,
embedding retrieval, or caller/model-selected counterparties. Each opening rechecks
eligibility, the evaluated intent payloads, and the executor inside its transaction.
Only newly opened opportunities are returned by this endpoint; existing sessions
are not reported as new, and terminal sessions still require deliberate reopening.
If a later write fails or the executor changes, earlier committed openings remain
valid and the request fails. An optional `AbortSignal` cancels the HTTP request,
provider evaluation, and uncommitted openings. Do not blindly retry an uncertain write.

**Breaking in 0.7.0:** `discover(intentId)` now writes and returns openings rather
than candidates. `createOpportunities`, `Counterparty`, and `CounterpartyPick` are
removed, as is `POST /api/intents/:id/opportunities`. The remaining endpoint accepts
no body or `{}`; the old query, limit, and picks bodies are rejected.

`wakesHost` is true only for `negotiation.opened`, `negotiation.turn`, and `principal.input`.

Non-2xx throws `ApiError` (`status`, `error`). A 2xx body that is not JSON throws a distinct `Error`. JSON methods do not retry. The stream reconnects until stopped. It delivers explicit `intent.broadcast`
and versioned `intent.revised` frames so an external runner can refresh and
match changed signals without treating generic invalidations as wakeups.

On connection, catch-up reports every signal's open negotiations and nonzero
turns owed to this owner. On reconnect, unseen principal messages produce one
`principal.input` per signal, naming the last message in the recovered set.
Initial conversation history is a baseline, not a new principal activation.
Recovery is bounded by retained stream frames and the conversation slice the
API returns; it is not an indefinite or exactly-once execution guarantee.
