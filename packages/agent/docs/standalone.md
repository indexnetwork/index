# Standalone usage

- `@indexnetwork/agent` supplies one principal-scoped `AgentRunner`, both reasoning layers, and direct OpenRouter execution. Host integrations supply authenticated domain access, events, process startup, and persistence.

This guide is launcher wiring, not a second scheduler or a turnkey CLI. Supply an `AgentHost` and event transport from your integration. `Subscribe` and `runAgent` below are example-local declarations, not package exports. API, Hermes, and macOS integration remains Seref's work.

## Build and imports

From `packages/agent`, run `bun run check`. The package is a private ESM workspace; consume its root export, `@indexnetwork/agent`, rather than deep-importing source files. The build emits `dist/index.js` and TypeScript declarations, including NodeNext-compatible relative imports.

Use Bun or a Node runtime with global `fetch`, `crypto.randomUUID`, and `AbortSignal.any`, `timeout`, and `throwIfAborted`. The package has no runtime dependencies and does not read environment variables.

## Choose reasoning execution

- Supply the provider credential from the host's configuration or secret manager:

```ts
import { createExecute, OpenRouterClient } from "@indexnetwork/agent";

const execute = createExecute(new OpenRouterClient({ apiKey }));
```

Construction performs no I/O. Each actual reasoning request sends agent-prepared context to OpenRouter and its selected providers, using the host's billed API credential. Do not embed that credential in a browser bundle or source control.

The client preserves v2's ordered defaults: `google/gemini-3.7-flash`, `google/gemini-3.8-flash`, and `anthropic/claude-haiku-4.5`. Optional `models` replaces them with one to three nonblank IDs. Optional `timeout` replaces the 120,000-millisecond deadline for **one request**, including its response body; it is not a deadline for the entire wake. No client-side retries are added. OpenRouter owns model/provider failover.

- One bounded `Execute` run checks principal facts, requirement contradictions, and ask-before boundaries, then writes the turn or stall explanation. Tools enforce protocol actions, the standing decision, responder-only acceptance, and one output; evidence judgments are model reasoning, not deterministic guarantees.
- A successful negotiation `submit_turn` or `stall` ends execution immediately. Invalid calls still receive feedback within the three-step budget; no completion is spent acknowledging a recorded result. Principal-agent tools remain nonterminal so a wake can perform its remaining work.
- The negotiator receives the current intent, confirmed profile, scoped H2A conversation, brief, counterpart intent, and complete negotiation turns with agent authorship. Explicit principal evidence can supply facts omitted from the brief; agent summaries cannot establish facts or permission. Entries scoped to other opportunities and unconfirmed profile fields are excluded.
- Source fields appear once in the prompt. Instructions contain policy and date guidance; the negotiation metadata excludes the repeated brief, counterpart intent, latest-turn text, and turn summary. Principal prompts carry `principalIntent` and confirmed profile data, with pending questions referenced by ID instead of repeating their text.
- Standalone `negotiate()` callers supply `conversation` in oldest-first order and complete `turns` with `speaker: "our_agent" | "counterparty_agent"`, `action`, and `message`. `AgentRunner` assembles these from its existing host reads.
- `TypeSafeClient` remains available for explicit comparisons; it is not a runner dependency. It defaults to `jev-latest`, accepts optional `model` and `timeout` settings, and neither retries nor reads environment variables. Normal agent execution needs no TypeSafe credential.
- For Hermes, supply an external implementation of `Execute`. Native execution must use the supplied permitted tools. See [Native execution](#native-execution) below; the package does not implement Hermes sessions or transport.

## Connect, reconcile, and stop

Your transport must forward only normalized events for this principal. It must observe the promise returned by `onReconnect`, clean up a partially opened subscription if startup fails, honor cancellation during connection, and return an unsubscribe function once connected. `onReconnect` is for later reconnections; the launcher performs the initial reconciliation itself.

```ts
import {
  AgentRunner,
  type AgentEvent,
  type AgentHost,
  type Execute,
} from "@indexnetwork/agent";

type Subscribe = (
  callbacks: {
    onEvent: (event: AgentEvent) => void;
    onReconnect: () => Promise<void>;
  },
  abortSignal: AbortSignal,
) => Promise<() => void>;

export async function runAgent(
  host: AgentHost,
  execute: Execute,
  subscribe: Subscribe,
  shutdown: AbortSignal,
): Promise<void> {
  shutdown.throwIfAborted();
  const runner = new AgentRunner({
    host,
    execute,
    log: (line) => console.log(line),
    onError: (error) => console.error("Agent work failed", error),
  });
  const stop = () => runner.stop();
  let unsubscribe: (() => void) | undefined;
  shutdown.addEventListener("abort", stop, { once: true });

  try {
    unsubscribe = await subscribe({
      onEvent: (event) => runner.handle(event),
      onReconnect: () => runner.reconcile(),
    }, shutdown);
    shutdown.throwIfAborted();
    await runner.reconcile();

    await new Promise<void>((resolve) => {
      if (shutdown.aborted) resolve();
      else shutdown.addEventListener("abort", () => resolve(), { once: true });
    });
  } finally {
    runner.stop();
    shutdown.removeEventListener("abort", stop);
    unsubscribe?.();
  }
}
```

- Call `runAgent(host, execute, subscribe, shutdown)` from your process entry point. Supply `shutdown` from a process-owned `AbortController`; abort it on shutdown. The host owns subscriptions, credentials, domain I/O, and process termination.

Connect event delivery before the initial reconciliation so notifications can arrive during its reads. The runner supports that overlap, but connection alone does not guarantee gap-free delivery: your transport must still account for events missed while disconnected.

Subscription and initial reconciliation failures reject the launcher and run its cleanup. Later reconciliation failures reject the `onReconnect()` promise; the transport must observe and handle that rejection. A shutdown during startup may also reject the launcher; the caller must observe that promise. After successful startup, shutdown ends the wait and stops/unsubscribes. **None of this drains background work.** Already-started host operations may finish, and persisted effects are not rolled back. The host decides when it is safe to tear down database/HTTP resources or exit.

## Supply authoritative host operations

One `AgentHost` represents one principal for the entire lifetime of the runner. Its operations validate current ownership and authorization, including which agent may act; constructor-time identity is not a permission snapshot.

| Operation | Host obligation |
|---|---|
| `getProfile()` | Return the principal's current profile and confirmation status. Only confirmed facts enter reasoning as facts. |
| `getIntent(intentId)` | Return the current intent and lifecycle status, or reject. Only `ACTIVE` is eligible for new reasoning. |
| `listIntents()` | Return the principal's intents. The runner selects active IDs for reconciliation. |
| `getConversation(intentId)` | Return the conversation ID and raw messages in oldest-first order, including bookkeeping. An empty message list is valid; a failed read is not an empty conversation. |
| `listNegotiations()` | Return the principal's open negotiation summaries. |
| `getNegotiation(opportunityId)` | Return current status, turn ownership, ordered turns, counterparty data, and authoritative protocol permissions/limits. |
| `findCounterparties(intentId, query, limit)` | Perform authorized candidate retrieval; return scores and person/intent/network identifiers. |
| `createOpportunities(intentId, picks)` | Create or resolve the selected opportunities and return their authoritative IDs. |
| `appendMessages(intentId, messages)` | Durably append the supplied batch in order before resolving. Subsequent reads must see successful writes; do not report success from an in-memory fallback. |
| `submitTurn(opportunityId, turn)` | Atomically validate `expectedTurnCount`, current authorization, lifecycle eligibility, and protocol permissions before persisting. Return the post-submission record or reject. |

Reads of individual records return a record or reject; do not fabricate missing context. Genuine empty lists remain valid. Writes may fail after reasoning, because current permissions or turn counts can change while it runs. Runner context-read, conversation-publication, and turn-submission failures reject through the caller or `onError`, without automatic retries or fabricated stalls. Errors from discovery/opportunity-creation operations inside a reasoning tool instead follow the ordinary tool-feedback contract; they still must not silently fall back to memory.

### Conversation persistence

`appendMessages` receives structured `PrincipalMessage` entries; `getConversation` returns raw `ConversationMessage` records. Preserve IDs, timestamps, question references, wire scopes, and match references when mapping between them:

- Put message text in text parts, e.g. `parts: [{ kind: "text", text: entry.text }]`; reconstruction does not take text from metadata.
- Preserve the structured entry under `metadata.principalMessage` and the associated intent ID in metadata. Attribute runner-written entries to the agent; principal input/answers must retain their principal authorship.
- Keep exact agent bookkeeping prefixes: `Brief: `, `Decision: `, and `Stall: `, including their trailing spaces. These are ordinary persisted messages, not a separate instruction store. Keep them in read history even though the runner excludes them from the model-facing H2A transcript.
- Preserve `kind: "expire"` and its original `questionId`; retirement is not an answer. Persisted scope `match` refers to an opportunity. Reconstruction uses the first match reference.
- A principal answer releases existing in-memory holds through its event but does not delete the persisted stall. A subsequent valid standing decision clears that stall during reconstruction.

A completed instruction write must be readable before its negotiation starts. The runner can start that negotiation while the principal wake continues; serializing every operation behind the entire wake would defeat that behavior. `set_brief` records an instruction, not guaranteed startup or settlement: current eligibility, holds, protocol permissions, and later failures still apply.

## Forward persisted changes, not snapshots

Persist the change **before** calling `onEvent`. Every event contains `intentId`; only `negotiation.turn` also requires `opportunityId`. There is no conversation text or lifecycle-status field in an `AgentEvent`.

| Event | What it requests |
|---|---|
| `principal.input` | Release this intent's existing holds and request a principal wake. It does not retry every released negotiation directly. |
| `intent.created` | Request a wake using the new persisted intent. |
| `intent.updated` | Request a wake after a content edit. Filter internal metadata updates out; do not echo agent bookkeeping writes as principal input. |
| `intent.lifecycle` | Request the normal wake path, which reads current status and skips inactive intents. It does not abort a run already reasoning. |
| `negotiation.turn` | Request only the affected negotiation with fresh permissions and its standing instruction. |

`handle()` returns after scheduling/coalescing, **not after reasoning or persistence**. One wake per intent runs at a time with at most one coalesced follow-up; new wake events do not abort it. Negotiation notifications arriving while that opportunity is in flight are dropped, not queued. Different intents and opportunities may overlap. Transport acknowledgments must not treat `handle()` as a completed job or a durable enqueue.

## H2A replies

The principal agent replies to unaddressed human input through `note_principal`,
including greetings and status questions that require no negotiation changes.
Plain model text outside tool calls is not a persisted reply. Host-result notes
are context, not responses to the principal or authorization. An empty list of
open negotiations does not justify repeating discovery for a greeting or status
request. Wakes without unaddressed input or useful work may still remain silent.

## Request a manual wake

Call `runner.wake(intentId)` when the principal explicitly requests fresh H2A
reasoning without sending a message or answer. Do not simulate `principal.input`
or an intent-change event for this action. It uses the same scheduler and fresh
host reads as event-triggered wakes: one active wake per intent and at most one
coalesced follow-up, without cancelling the active run. Inactive intents skip
reasoning, and stopped runners ignore requests.

The call returns immediately; failures go to `onError`. The request itself saves
no conversation entry, answers no question, and releases no negotiation hold.
Normal agent actions still use their existing publication and decision rules.
A wake may remain silent and does not guarantee a question or new negotiation.

## Reconciliation and delivery limits

- The first `reconcile()` adopts existing active intents silently, even if there are none. It does not wake every existing intent.
- Later reconciliations remove missing/inactive IDs and wake newly active ones. Successful wake reads also keep that ID membership current; it is not a domain-context or authorization cache.
- Each reconciliation recovers eligible **turn-zero** negotiations awaiting the principal through normal scheduling. It does not replay missed principal input, recover later-turn work, or reconstruct a lost durable job queue.
- Overlapping reconciliation calls serialize their reads. Each promise resolves after its own membership update and recovery scheduling, not background reasoning completion. Its read failures reject the promise; scheduled-work failures go to `onError`.
- Reconciliation is not atomic: already completed membership changes or scheduled wakes are not undone if a later read fails. There is no automatic retry.

The host owns missed-event replay, delivery acknowledgments, reconciliation triggers, and cross-process ownership. Do not run competing runners for the same principal and assume their maps provide exclusivity. `expectedTurnCount` protects final submission from stale turns; it does not make reasoning or conversation writes exactly-once.

The runner's active runs, coalesced requests, and holds disappear on shutdown. Persisted conversations, instructions, stalls, and negotiations remain host-owned. An explicit in-memory host can serve as a local sandbox, but it is not a production storage fallback and does not publish records to Index or update the macOS app. This guide does not add one.

## Native execution

An external `Execute` implementation must:

- Consume the agent-prepared `instructions`, `prompt`, and tools without introducing another agent policy or bypassing the package-owned handlers.
- Bound the whole run using `maxSteps`: 8 for `wake`, 1 for `brief`, and 3 for `negotiate`. One step is a response followed by its requested tool calls. Stop early on no calls or a successful terminal tool, and keep outputs already collected at the cap.
- Await each response's tools sequentially. After a tool with `terminal: true` succeeds, end the whole run without executing remaining calls or requesting another model response. Otherwise, send string results unchanged; JSON-serialize other values, using null for no value. Unknown tools, invalid JSON, and ordinary handler errors become tool feedback inside the remaining budget, including errors from terminal tools. JSON Schema is not a generic runtime validator.
- Reject on model failure or observed `abortSignal` cancellation; do not turn cancellation into tool feedback or retry automatically. Already-started effects need not be interruptible or reversible.
- Return `Promise<void>`; the agents own domain results collected through their handlers.
- Use `principalId`, `intentId`, `operation`, and the briefing/negotiation `opportunityId` as work metadata. Keep H2A and A2A sessions separate; use the scoped source evidence supplied in the negotiation prompt. Do not expose private conversation or brief text in counterpart messages. Native session/checkpoint management remains outside this package.

## Integration boundary

The package rewrite is not a completed API/Hermes/macOS migration. Seref owns adapting those consumers, selecting the authoritative runner per principal, enforcing the original-responder-only acceptance rule in the protocol/API, and removing v2 after migration. Existing legacy imports such as `PrincipalQuestion`, `PrincipalState`, and `PrincipalStore` are not restored as compatibility exports.

For architecture and persistence details, see [rewrite-plan.md](rewrite-plan.md). For the completed package-local implementation checklist, see [TODO.md](../TODO.md).
