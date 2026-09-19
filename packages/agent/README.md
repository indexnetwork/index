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
  `intent.broadcast` (with `networkId`), `intent.revised` (with
  `revisionVersionMs` and `fingerprint`), or `intent.resumed` (with
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
`reviewNotice` explains an interrupted review or automatic matching and clears on
the next accepted activation; it never schedules one. `toolCalls` contains
ephemeral H2A tool **and runtime matching** activity: statuses, plain-English
`label` values, owner-visible `details` and response `summary` values, grouped by
`reviewId` and anchored to the preceding visible message. Standing-brief calls
show the owner's full private brief. Automatic activity uses
`name: 'match_counterparties'`, labelled **Matching counterparties automatically**;
it is not a model tool. It shows the authorized network count, the standing brief
copied to new sessions, each scored pair's public intent, match probability and
public reasoning in descending score order. Per-pair summaries distinguish opened,
reused without a brief change, unavailable, not attempted after the new-opening
budget is filled or the run is interrupted, and unconfirmed writes.
Stale context and stale scope are reported explicitly, separately from unconfirmed
writes. `status: 'error'` or `'cancelled'` describes a stopped matching run, not a
rollback of earlier openings. Deliberate terminal reopening uses
`name: 'reopen_negotiation'`, labelled **Reopening a terminal negotiation**.
Reviews show proposed messages, questions, retirements and named negotiation
instructions without claiming they have been saved. Details remain on errors and
cancellations.
Hosts must show this activity only to the represented owner, never counterparties.
It exposes no other principal's private brief and is never persisted as activity,
added to model context, or treated as authority. Tool completion does not prove
that every opening succeeded or that later effects were persisted.

An H2A failure stops the runtime and preserves the original error for subsequent
`receiveInput()` and `wake()` calls. Interrupted writes or matching stop the current
review's remaining work without cancelling committed delegations. A later failure
also preserves A2A scheduling for earlier committed openings. Failed work is not
silently retried.

### Breaking API change (1.0.0)

`Agent` now names the H2A runtime, not the low-level model loop. The exported
`NegotiationAgent`, `NegotiationHost` and `RunOptions` are removed; there are no
compatibility aliases. Construct `Agent` with `AgentHost`, use `receiveInput()`
instead of `message()` / `answer()`, and `wake(activation)` instead of `activate()`.
Use `ready`, the host's abort signal and `closed` instead of `start()` / `stop()`;
route A2A events through the host subscription instead of `agent.receive()`.
The old `Agent.run()` / `for()` API is internal `ModelLoop` machinery, not a
human-facing agent API. `ToolContext.loop` replaces `ToolContext.agent`.

Matching now runs automatically after a completed H2A review, including an empty
`review_principal_inbox` decision, rather than depending on a model tool call.
There is no model-authored retrieval or candidate-selection stage.

- `DiscoveryInput = { networkIds: string[] }` replaces `CandidateQuery`.
  `SearchRecord` and the internal selection/skip input types are removed.
- `DiscoveryCandidate` retains identity, payload, summary, profile and network
  context. `matchProbability: number` replaces `similarity`; `reasoning: string`
  is public match provenance. `recentlyRejected` is removed.
- `DiscoveryClient.openNegotiation` is required when discovery is supplied.
  `AgentOptions.discovery` itself remains optional; no-discovery hosts still work.
- `NegotiationOpeningRequest.source` is
  `{ kind: 'match'; matchId: string; probability: number }` or
  `{ kind: 'negotiation'; negotiationId: string }`. All target, context, source
  message, authorized scope and latest-session fences remain required and unchanged.
  `openingRequestKey()` fingerprints the new source shape; old request keys are
  not a replay compatibility path.
- The model tools `discover_counterparties` and `open_negotiations` are removed.
  The only explicit opening tool is `reopen_negotiation`, taking exactly
  `{ negotiationId, reasoning, brief }` for a visible latest terminal session.

The host matching port is:

```ts
interface DiscoveryClient {
  scope(signal: AbortSignal): Promise<DiscoveryScope>;
  discoverCounterparties(
    input: DiscoveryInput,
    scopeVersion: string,
    signal: AbortSignal,
  ): Promise<{ candidates: DiscoveryCandidate[] }>;
  openNegotiation(
    request: NegotiationOpeningRequest,
    signal: AbortSignal,
  ): Promise<OpenNegotiationResult>;
}
```

The runtime supplies **all** authorized networks, once per completed review,
including broadcast reviews. With no authorized networks it records that no scan
ran. TypeSafe scores every eligible public intent/network pair; the host returns
all still-eligible scored pairs in descending `matchProbability` order with
public-safe reasoning, without a pass/fail threshold or `0.8` cutoff. Both intents
must be registered in the returned network. There are no search queries, embedding
retrieval, or model-selected candidates. The runtime walks the full ranking
sequentially until **up to 10 new negotiations per intent per matching run** are
created or the candidates are exhausted. Existing/reused, terminal, and unavailable
sessions do not consume the new-opening budget; this is not a first-ten-candidates
limit.
For each new session, `request.brief` is the exact current `standingBrief.brief`
and `request.reasoning` is the exact `candidate.reasoning`. Hosts must atomically
save the initial delegation with the session, never rebrief reused sessions, and
never automatically reopen a terminal pair. A terminal match returns
`{ status: 'unavailable' }`; only an explicit `source.kind: 'negotiation'` may
reopen it. An `opened` result with `delegationId` confirms a newly saved opening
brief; an `opened` result without it means unchanged existing work.

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
creation/broadcast/material-revision/resume are the H2A wake sources. Startup,
scans, generic `intent.updated` invalidations (including `markSearched`), A2A
activity and opening the app remain observational. Lifecycle/manual activations
are private, deduplicated records; delivery is best-effort and restoration never
replays accepted events. Hosts validate lifecycle versions transactionally so
duplicate or superseded activations do not wake again. Manual and lifecycle
reviews use the same context and delegation guards as input-triggered reviews;
the receipt itself grants no permission, answers or question retirement.

Material edits publish `intent.revised` only after the payload/summary fingerprint
changes and the update commits. The activation is:

```ts
{
  type: 'intent.revised',
  id: `intent.revised:${intentId}:${revisionVersionMs}:${fingerprint}`,
  revisionVersionMs, // The committed intent.updatedAt in milliseconds.
  fingerprint,       // computeIntentFingerprint(payload, summary).
}
```

The user-event frame carries `{ intentId, revisionVersionMs, fingerprint }` in
`data`. Before accepting it, the API locks the owned active intent and compares
both the revision timestamp and fingerprint to that row, then validates the
stable receipt ID. Stale revisions are rejected and an existing receipt ID cannot
activate H2A again. Material writes already clear standing-brief readiness; the
review establishes the current brief before automatic matching. External runners
refresh the intent before waking on revisions and broadcasts. Generic update
invalidations never request matching.

`AgentHost.event` observes typed activation, matching/opening, brief, question,
review and A2A transitions. Events contain IDs and outcomes, not private briefs,
answers or counterparty messages. Observation is never a wake source. Question
issuance is not an authority grant, and a negotiation turn is not verified execution.

#### Event changes for hosts and TUI

- `discovery.searched` is now exactly
  `{ type: 'discovery.searched', inputId, matchId, networkIds, candidateIntentIds }`.
  `matchId` is the automatic activity's `PrincipalToolCall.id`, shared by that
  run's match-source opening requests. The event reports completed matching,
  not successful openings. No search text or cutoff is emitted.
- `candidate.evaluated` is removed; there is no semantic selection event.
- `negotiation.opened` retains
  `{ type, inputId, opportunityId, candidateIntentId, networkId }` and now fires
  only for a newly committed opening delegation, not unchanged session reuse.
- `delegation.brief_saved` keeps its existing fields and `source: 'opening'`
  for each committed initial brief. `source: 'review'` still means an explicit
  update to existing work.
- `h2a.review_completed` keeps its fields and reports saved H2A effects **before**
  runtime matching begins. Its `delegatedIds` are the review's explicit updates,
  not later automatic openings. All other event shapes are unchanged.
- Matching interruption details and per-pair results live in `toolCalls` and
  `reviewNotice`, not a new event union. Matching can stop while earlier
  `negotiation.opened` events remain valid and their A2A work is scheduled.

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
- H2A establishes a current standing brief, then completes its review, including
  messages, questions, retirements and explicit existing-session delegations. The
  runtime reads the post-write context version and validates the original principal
  source, execution evidence and standing brief before automatic matching. A stale
  or unconfirmed review must not launch matching against old evidence.
- Matching scores every eligible pair across all authorized networks once and
  walks all still-eligible results in descending score order, without a score
  threshold or model selection, until up to 10 new negotiations per intent per
  matching run are created. Existing/reused, terminal, and unavailable sessions
  do not consume that budget. Each new session receives an unchanged copy of the
  current standing brief; public provenance comes only from host match reasoning.
  Missing facts or authority remain explicit limits in that brief, so A2A can pause
  rather than inventing permission.
- Automatic matches reuse unsettled work without updating or rescheduling its
  established brief and never reopen terminal pairs. Only `reopen_negotiation` can
  deliberately create a new session from the latest visible terminal negotiation,
  with new public reasoning and a complete private brief. It cannot select unseen
  pairs or unsettled sessions. New sessions never inherit old counterpart-specific
  authority or change previous settlements. `previousSessions` are shared history,
  not current offers, authority or turn usage. Inbound work still uses its standing
  fallback and never wakes H2A.
- The runtime awaits each opening sequentially, refreshing canonical principal
  records and negotiations after each response before attempting the next pair.
  Each new session and initial brief commit atomically under source-message,
  context, scope and latest-session ID/outcome/opportunity-status fences; the whole
  batch is not one transaction. Unavailable pairs allow the remaining work to
  continue. Stale scope/context or uncertain writes stop the remainder distinctly,
  without a retry or rollback. Earlier confirmed openings and review delegations
  still schedule eligible A2A, even when later matching stops. An uncertain opening
  is not treated as confirmed work; a later activation must inspect saved evidence.
  Exact created-request replays reconcile by immutable request identity. Effect
  writes also fence status changes, turns and outcomes.
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
