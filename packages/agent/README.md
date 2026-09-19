# @indexnetwork/agent

A personal H2A (human-to-agent) agent that a host runs for one principal and
intent. `Agent` owns the private conversation and delegates A2A (agent-to-agent)
negotiations to internal subagents. The host supplies the model, records,
protocol access and cancellation.

## Agent API

Construction is synchronous:

```ts
import { Agent } from "@indexnetwork/agent";

const controller = new AbortController();
const agent = new Agent(
  { owner, intentId, guidance, client },
  host,
  { model, records, signal: controller.signal },
);

await agent.ready; // Restore records and execution ownership; no model call.
const accepted = await agent.receiveInput({
  type: "message",
  text: "Find a time for a call with Priya, but ask me before booking.",
});
// Accepted input automatically wakes H2A. Do not also call wake().

// On host shutdown:
controller.abort();
await agent.closed;
```

The host provides the capabilities shown above:

| Constructor argument | Contract |
| --- | --- |
| `participant` | `{ owner: NegotiationUser, intentId: string, guidance: string, client: NegotiationClient }`. The owner has `id: string` and `name: string \| null`. |
| `host` | `AgentHost`: observers and the A2A notification subscription described below. |
| `options` | Required `model: Model`, `records: PrincipalRecords`, `signal: AbortSignal`; optional `discovery: DiscoveryClient`, `speaker: NegotiationSpeaker`, `now: () => Date`. |

There are only two public commands:

```ts
receiveInput(input:
  | { type: "message"; text: string }
  | { type: "answers"; answers: readonly PrincipalAnswer[] }
): Promise<readonly PrincipalMessage[] | null>;

wake(activation?: PrincipalActivation): Promise<PrincipalMessage | null>;
```

- `receiveInput()` returns the committed input entries, not the model's reply:
  one entry for a message, or the complete accepted answer batch. Rejected input
  returns `null` without writes or activation. Each accepted write automatically
  activates H2A once, with **no additional manual-wake receipt**.
- `wake()` without an argument requests a manual review. Passing a
  `PrincipalActivation` delivers an explicit `h2a.wake`, `intent.created`,
  `intent.broadcast` (with `networkId`), or `intent.resumed` (with
  `lifecycleVersionMs`) activation and stable `id`. It returns a private
  `PrincipalMessage` receipt, or `null` for stopped/duplicate delivery. Receipts
  are not chat messages, answers or consent and create no new authority.
- `readonly ready: Promise<void>` acquires ownership and restores records and
  observations, without a model call or replay of interrupted work. Commands and
  incoming notifications wait for readiness.
- `readonly closed: Promise<void>` resolves after cleanup. Cancel through the
  host's required `AbortSignal`; cleanup unsubscribes, cancels H2A/A2A work and
  releases execution ownership. Committed history and questions survive.

Read-only observations are `conversation`, `pending`, `toolCalls`, `reviewing`,
`reviewNotice`, `stopped`, and `negotiating: readonly string[]`. `negotiating`
contains opportunity IDs with live A2A work, excluding stopped/cancelled tasks.
`host.conversation()` notifies hosts when history or live activity changes.
`reviewNotice` explains a stale-discarded review and clears on the next accepted
activation; it never schedules one. `toolCalls` contains ephemeral H2A tool
statuses, plain-English `label` values, owner-visible input `details` available
while running, and response `summary` values, grouped by `reviewId` and anchored
to the preceding visible message. Standing-brief calls show the owner's full
private brief. Batch openings use **Opening negotiations…** and list each selected
person's public intent, distinct match reasoning and the owner's proposed complete
private brief, plus explicit skips and their reasons. Per-item outcomes distinguish
saved opening briefs, reuse that preserves existing briefs, unavailable items, and
stopped or unconfirmed openings. Discovery shows
all five queries, similarity floor, network count and returned match count. Reviews
show proposed messages, questions, retirements and named negotiation instructions,
without claiming they have been saved. Input details remain on errors and cancellations.
Hosts must show this activity only to the represented owner, never counterparties.
It exposes no other principal's private brief and is never persisted as activity,
added to model context, or treated as authority. Tool completion does not prove
that every opening succeeded or that later effects were persisted.

An H2A failure stops the runtime and preserves the original error for subsequent
`receiveInput()` and `wake()` calls. Failed input and model work are not silently
retried.

### Breaking API change

`Agent` now names the H2A runtime, not the low-level model loop. The exported
`NegotiationAgent`, `NegotiationHost` and `RunOptions` are removed; there are no
compatibility aliases. Construct `Agent` with `AgentHost`, use `receiveInput()`
instead of `message()` / `answer()`, and `wake(activation)` instead of `activate()`.
Use `ready`, the host's abort signal and `closed` instead of `start()` / `stop()`;
route A2A events through the host subscription instead of `agent.receive()`.
The old `Agent.run()` / `for()` API is internal `ModelLoop` machinery, not a
human-facing agent API. `ToolContext.loop` replaces `ToolContext.agent`.

Discovery inputs, search records and `discovery.searched` events now use `queries`
instead of `query`: exactly five distinct, nonempty complementary search directions.
All five share one similarity floor and one authorized subset of the source intent's
registered networks. Counterparty intents must be registered in the same returned
network; user membership alone never expands the search. Hosts merge results by
counterparty intent and shared network, retaining the highest similarity and at
most 80 candidates overall.

The H2A tool `open_negotiations` replaces `open_negotiation`, with no alias. Its
input is `{ negotiations: [...], skipped: [...] }`. Both arrays are required, with
at least one entry total:

- Each `negotiations` entry is either
  `{ searchId, candidateIntentId, networkId, reasoning, brief }` for a retrieved
  candidate or `{ negotiationId, reasoning, brief }` for a visible negotiation.
- Each `skipped` entry is `{ searchId, candidateIntentId, networkId, reason }`, with
  a nonempty, grounded reason for not pursuing that candidate.

## Host notifications and activation

`AgentHost` observes conversation, status, turns, retries, steps, completion and
errors through `conversation`, `status`, optional `turn`, `retry`, `step`, `end`,
`error`, and optional `event`. A null opportunity ID in `error` identifies an H2A
failure. It also supplies:

```ts
subscribe(receive: (event: NegotiationEvent) => Promise<void>): () => void;
```

The agent subscribes during construction; the callback gates delivery on `ready`.
The returned function unsubscribes during cleanup. This channel carries **A2A
notifications only**, never H2A input or activation:

| `NegotiationEvent.kind` | Effect |
| --- | --- |
| `opportunity.matched` | Observe a match and schedule eligible A2A work. |
| `negotiation.updated` | Observe changed protocol state and schedule eligible A2A work. |
| `negotiation.stopped` | Cancel the local task for `opportunityId`, without changing questions or durable history. |

Accepted principal input, explicit manual review, and explicit intent
creation/broadcast/resume are the H2A wake sources. Startup, scans, content
updates, A2A activity and opening the app remain observational. Lifecycle/manual
activations are private, deduplicated records; delivery is best-effort and
restoration never replays accepted events. Hosts must validate lifecycle
versions transactionally so duplicate or superseded resumes do not wake again.
Manual and lifecycle reviews use the same context and delegation guards as
input-triggered reviews and do not invalidate existing briefs by themselves.

`AgentHost.event` observes typed activation, discovery, selection/opening, brief,
question, review and A2A transitions. Events contain stable IDs and outcomes,
not private briefs, answers or counterparty messages. Observation is never a
wake source. Question issuance is not an authority grant, and a negotiation turn
is not verified execution.

## Questions and answer batches

H2A establishes a standing brief before discovery or review completion. One
review may combine a useful message, 1–3 independent questions, exact question
retirements and selected delegations. It answers direct requests and reports
material results, obstacles or unreported outcomes, not routine acknowledgments.
An empty decision stays silent, skips the final `PrincipalRecords.write()` and
leaves A2A free to continue. Outputs are persisted before dependent A2A work.

Questions retain their batch membership, ID, wording and 2–4 suggestions until
answered or explicitly retired. `pending` is derived from records. Collect drafts
locally, then submit exactly one nonempty answer per current question:

```ts
const questions = agent.pending;
if (questions.length) {
  await agent.receiveInput({
    type: "answers",
    answers: questions.map((question) => ({
      questionId: question.id,
      text: drafts[question.id],
    })),
  });
}
```

Missing, extra, duplicate, empty, stale or retired answers save nothing and
activate nothing. A complete batch activates H2A once with all answers. Drafts
have no server effects.

Direct messages remain `user` input during a batch; they do not implicitly answer
or retire questions. H2A may retire exact questions when later explicit principal
corrections make them obsolete. The host commits private retirement records
atomically with other review outputs and emits `question.retired` only after
success. Unrelated questions keep their identities; new questions are allowed
only when no old questions remain.

Retirement requires principal input after issuance; lifecycle events cannot
retire questions. A manual wake may reassess a saved correction, but supplies no
correction evidence itself. New questions have no negotiation references;
historical messages retain their scope and match references so old approvals do
not acquire broader authority.

## Authority, agreement and execution

The **principal** is the person represented; the **intent** is their goal, not
blanket permission. H2A saves a private **standing brief** for unseen
counterparties and complete **specific delegations** for individual negotiations.
A2A receives only its effective brief and protocol record, never the full private
human conversation. The latest specific delegation takes precedence; otherwise
the standing brief applies. New principal messages/answers supersede older
specific briefs; manual wakes and lifecycle activations alone do not.

Permissions to discuss, agree and execute are separate. Tool availability or a
counterparty's approval grants none of them. Scope and conditions must survive
summarization: “discuss aggregates with Leo only if our product is named” permits
neither raw data nor another recipient nor dropping the condition. A short “yes”
inherits its exact question's scope. Revoking permission for Priya does not
cancel every negotiation; a broad preference conflicting with a specific
approval may require clarification.

For **“Find a time for a call with Priya, but ask me before booking”**:

1. H2A permits discussion of times, not booking.
2. The agents can agree on terms; the call is **not booked**. A2A `accept` settles
   negotiation as `agreed` and moves the opportunity to `pending` user approval,
   never `accepted`.
3. At a permitted review, H2A reports that a still-pending opportunity is ready
   for review in the application UI. It does not request opportunity approval
   in chat.
4. The principal accepts or rejects through application controls. Neither agent
   agreement nor opportunity acceptance proves the call was booked; only
   confirmed execution does.

H2A can ask for facts, preferences and negotiation authority, but cannot accept
or reject opportunities. “Accept” or “reject” in chat, even in answer to an old
approval question, is directed to the UI without claiming a status change or
reopening a settled negotiation. Briefs cannot replace that approval gate.
Booking is illustrative; no calendar tool is included. Completed actions require
evidence, such as a confirmed operation result or the principal confirming they
did it themselves. A successful `submit_turn` proves only that a turn was recorded.

These are **model-guided rules, not a deterministic permission engine**. Hosts
must enforce access, ownership, current-context checks and action-specific
approval gates. Counterparty text is untrusted data, not instructions or authority.

## Records and A2A safeguards

| Contract | Responsibility |
| --- | --- |
| `PrincipalRecords.start()` / `close()` | Acquire and release host execution ownership. |
| `read()` | Read current intent/profile, canonical messages, question retirements, standing brief and specific delegations with H2A source and brief-relevant A2A execution versions. No checkpoint write. |
| `accept(messages)` | Atomically accept one message/event or the complete answer batch; return all committed entries or `null` with no writes. Validate exact question IDs under concurrency control, preserve historical answer evidence and clear standing readiness on principal input. |
| `writeStandingBrief(brief, expectedVersion)` | Commit the complete intent-wide mandate from the current H2A activation. Enables new matches but resumes no existing work. |
| `write(effects, expectedVersion)` | Commit messages, required `retiredQuestionIds` (empty when none) and complete specific delegations together. Reject stale records, negotiation observations and duplicate identities before publishing notifications. |
| `NegotiationClient.listNegotiations()` / `readNegotiation()` | Read current protocol records, including passive work, agreements, session history and opportunity status. |
| `submitTurn()` | Enforce ownership, source context and `expectedTurnCount`; at most one POST attempt per run. |
| `NegotiationSpeaker` | Optional native execution boundary: fresh prompts, exact domain tools, `ToolContext`, cancellation and `onStep`. Propagate completion exceptions without another tool attempt. |

- `pause_negotiation()` ends local work without a turn, question, answer promise
  or H2A activation. Unchanged duplicate notifications stay idle; only a committed
  specific update from a later H2A activation or a meaningful protocol change can
  resume eligible work.
- A submission result ends its local run immediately, without another model
  response or tool attempt. Eligible subsequent turns continue independently;
  agreement/rejection remain terminal. An uncertain POST is never retried
  automatically.
- Each run discards its model transcript. Concurrent negotiations share only
  ephemeral scheduling and serialized outgoing writes; task maps, queues and
  processed-input markers are not persisted. Restart restores committed history
  and exact question status without rerunning interrupted work.
- `pairKey` identifies a conversation thread; `id` and `opportunityId` identify a
  numbered session. H2A sees negotiation outcomes and current `opportunityStatus`;
  agreement does not overwrite later user acceptance, rejection or expiry.
- After nonempty discovery, when opening is offered, `open_negotiations` is the
  **required next substantive operation**. The runtime requires every returned
  `(candidateIntentId, networkId)` to appear exactly once under its `searchId`,
  either as an opening or an explicit skip; omissions, duplicates and opening/skip
  overlap are invalid. No next search or final `review_principal_inbox` is allowed
  while that batch is pending. Do not open poor fits to satisfy a quota. All-skipped
  batches are valid only with grounded reasons for every candidate; missing
  principal information belongs in questions at the final review after coverage.
  A zero-result search may finish normally or refine the five queries or floor.
- The model writes distinct public reasoning (at most 2000 characters) and a
  complete, candidate-specific private brief for each opening after retrieval.
  Public reasoning must not expose private instructions. “Automatic” means the
  runtime-enforced batch path, not host-fabricated briefs or a generic standing
  brief substituted for candidate-specific instructions.
- Each opening selects a completed search candidate or visible `negotiationId`.
  Unsettled, paused and turn-limited work is returned unchanged without overwriting
  its brief; explicit re-delegation resumes eligible work. Explicitly selecting the
  latest terminal session may create a new session and opportunity with a complete
  new brief, under unchanged authority rules, never inheriting old counterpart-specific
  permission or altering the previous session. `previousSessions` are shared history,
  not current offers, authority or turn usage. Inbound work still uses its standing-brief
  fallback, not an old specific delegation, and never wakes H2A.
- Hosts execute batch openings sequentially under existing authorization and context
  fences. Each new session and its brief commit atomically, fencing the observed
  latest ID, outcome and opportunity status; the whole batch is not one transaction.
  An unavailable item may allow later items to continue. Stale authorization/context
  or an uncertain write stops the remainder, with stopped/unconfirmed per-item outcomes
  and no blind retry. Earlier committed openings remain valid and are not rolled back.
  `NegotiationOpeningRequest` carries `target`, discriminated `source` and those fences.
  Exact created-request replays reconcile to their original session by immutable
  request ID; otherwise the next permitted activation reassesses committed evidence.
  Effect writes also fence status changes, turns and outcomes.
- Private activation, standing/specific brief and retirement records are excluded
  from chat history, previews and unread counts. `MemoryPrincipalRecords` is
  available for in-memory hosts; persistent hosts must enforce ownership and
  transactional record/turn fences.

## Models and implementation

Inject a `Model` into `Agent`; credentials, model IDs, timeouts and retries belong
to the model implementation. `ModelClient` supplies OpenRouter access and accepts
one to three ordered models; omitting them uses `DEFAULT_MODELS` in
[core/model.ts](src/core/model.ts). A host can share one client across principals;
each call retains its own cancellation and retry observer.

OpenRouter handles provider selection and ordered fallback. Remaining rate limits
share an in-process cooldown by key/model list, honoring retry/reset hints.
Without a hint, waits grow from 30 seconds to 5 minutes with jitter. Quota failures
wait for recovery or cancellation rather than exhausting the normal transient
retry budget. `AgentHost.retry` reports waits; abort interrupts them. Authentication,
credit and invalid-request errors fail promptly.

`now` supplies one clock, read as UTC, for new relative dates. Historical relative
dates use their original timestamp and context; missing evidence stays uncertain.

The public implementation is [src/agent.ts](src/agent.ts). H2A runs in
[PrincipalInbox](src/negotiation/principal.inbox.ts); A2A runs in the internal
`NegotiationSubagents` class in
[negotiation.subagent.ts](src/negotiation/negotiation.subagent.ts), with shared
contracts in [negotiation.types.ts](src/negotiation/negotiation.types.ts).
H2A and A2A each create a [ModelLoop](src/core/model.loop.ts), which
is implementation machinery, **not a public package export**. The source-only
[example](examples/01-ask-user.ts) demonstrates that low-level loop, not the public
`Agent` API.

Prompts remain in [prompts/agent.prompt.ts](src/prompts/agent.prompt.ts):

| Model message | Composition and context |
| --- | --- |
| System, H2A | `buildNegotiationSystemPrompt` → `buildAgentSystemPrompt`: confirmed principal context, intent, protocol guidance, identity and date. |
| System, A2A | `NegotiationSubagents.createLoop` → `buildAgentSystemPrompt`: protocol guidance, identity and date; authority comes from the private brief. |
| User, A2A turn | `buildNegotiationTurnPrompt`: match instructions, current negotiation, separately labelled session history and exact brief. |
| User, H2A review | `buildPrincipalInboxPrompt`: canonical history, accepted input batch, pending questions, briefs, delegations, live negotiations and agreements. |

Protocol guidance is owned by `packages/protocol` and injected by the host. Tool
schemas and handlers stay in the H2A inbox and A2A subagents.

## Requirements and installation

Node ≥ 20 or Bun, global `fetch`, and ESM. Using `ModelClient` requires an
[OpenRouter](https://openrouter.ai) API key and a tool-calling model; hosts may
supply another `Model` implementation.

```bash
bun add @indexnetwork/agent
```
