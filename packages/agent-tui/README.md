# @indexnetwork/agent-tui

A terminal testing platform for personal agents. It displays one pane per selected
user, with an intent selector and an independent H2A conversation for each
user–intent pair. Two expanded users also display their selected intents' A2A
conversation. Agent behavior is
owned by `@indexnetwork/agent`; participation rules belong to
`@indexnetwork/protocol`.

## Run a scenario

From the repository root:

```bash
bun install
bun --env-file=.env.development run agent:tui
```

The launcher runs from this package and loads the agent, discovery, and protocol
source entry points through `tsconfig.json`. It does not rebuild shared `dist`
directories or depend on them remaining present during another workspace build.

Requires an interactive terminal and two provider keys, supplied through your
shell or the root gitignored `.env.development`:

- `OPENROUTER_API_KEY` for H2A and A2A conversational models.
- `TYPESAFE_API_KEY` for direct intent-pair matching with TypeSafe `jev-1.13.0`.

Choose a JSON scenario with Up/Down + Enter or a click. The chooser displays
filenames in alphabetical order, starting with the five-user cofounder scenario.
The six bundled scenarios have 5–10 users and 5–14 discoverable intents, with
**no pre-created negotiations**. Loading a scenario emits one `intent.created`
event per intent. Each intent's H2A first saves its standing brief, making that
fixture discoverable. After a completed review, the runtime scores all eligible
pairs and walks the descending ranking to open up to 10 new negotiations per intent
per matching run using that saved brief, without a model selection/skip step.
No initial chat message is required. Agents and opened negotiations run independently
of the visible board. Changing users, intents, or collapsed panes only changes
what you see.

Override the conversational model client's ordered model list with one to three
OpenRouter IDs (this does not change the TypeSafe evaluator):

```bash
bun --env-file=.env.development run agent:tui google/gemini-3.8-flash anthropic/claude-haiku-4.5
```

The model client owns rate-limit waiting and model switching. No HTTP server,
Redis, or database are required for the scenario host. Ctrl+C stops
all agents and saves a private Markdown transcript in a temporary directory.
Each scenario launch creates fresh fixture intents and starts their discovery.
Re-delivering the same creation event within a run does not activate H2A twice.
This is not a restoration wake: loading existing backend records still stays idle.

### Failed H2A messages

An H2A failure stops that runtime. Later sends show the original failure and keep
your draft; they do not silently retry model work. Fix the cause and restart the
scenario. An OpenRouter `401` / `User not found` is a provider authentication error,
not a missing fictional user. TypeSafe authentication failures concern the separate
`TYPESAFE_API_KEY`; there is no embedding fallback. Exported keys can override the project's env file;
to use both keys from `.env.development` without inherited overrides, run:

```bash
env -u OPENROUTER_API_KEY -u TYPESAFE_API_KEY bun --env-file=.env.development run agent:tui
```

### Discovery pipeline

The lab runs the same `CandidateDiscovery({ database, evaluator })` implementation
as the API, with in-memory scenario data and `TypeSafeIntentEvaluator`. Matching
accepts only the requested `networkIds`; it directly compares the source intent
with **every ready peer intent** in the authorized shared scope. There are no
fixture/query embeddings, cosine search, query generation, or pre-scoring shortlists.
Scoring is exhaustive; only the subsequent new openings are bounded.
Both intents must be registered in the returned network; a user's other network
memberships never widen the scope.

All fixture intents belong to one simulated network, but each becomes eligible
only after its in-memory standing brief commits. The database port's
`listIntentCandidates` enumerates all ready intents owned by other users in that
network. The shared pipeline enforces scope, readiness and membership checks,
then returns `networkIds`, `sourcePayload` and all still-eligible scored candidates
in descending `matchProbability` order, with public `reasoning` recording evaluation
provenance, not a generated pair-specific explanation. TypeSafe `jev-1.13.0`
evaluates the two public intent payloads and optional shared network context;
there is no pass/fail threshold or `0.8` cutoff. Private scenario `instructions`, H2A history,
standing briefs and counterpart private context are never sent to the evaluator.
Public names can be returned with candidates, but are not evaluator inputs.
There is no rejection-history lookup or `recentlyRejected` candidate flag.

The agent runtime walks the full ranking until up to **10 new negotiations per
intent per matching run** are created or the candidates are exhausted, using the
current standing brief. Existing/reused, terminal, and unavailable sessions do not
consume the new-opening budget; lower-ranked candidates remain available to fill it.
H2A does not choose or skip individual matching candidates and does not compose
candidate-specific briefs before these automatic openings. The host executes
openings sequentially, rechecking both intents' standing readiness and
existing authorization/context fences, and atomically saves each new session with
its opening brief before A2A. Unsettled sessions are reused without overwriting
their briefs. A `source.kind === 'match'` request never reopens a terminal session;
only `reopen_negotiation` targeting a known latest terminal session by
`negotiationId` can create a successor. Exact created-request replays reconcile to their original
session, even after it settles. An unavailable item may allow later items to
continue; stale authorization/context or an uncertain write stops the remainder
without a blind retry. Earlier committed openings remain valid. Inbound A2A
standing-brief fallback is unchanged and never wakes H2A.

Launching a scenario makes real OpenRouter conversation and TypeSafe evaluation
requests, which can incur provider charges and rate limits. Exhaustive evaluation
scales with ready peer intents and may repeat on later matching calls. It does not
exercise database or Redis behavior or change live Index records.

## Bundled scenarios

All personas are fictional. The scenarios explore social discovery through
complementary needs, shared interests, and useful next steps. They include promising
overlaps, adjacent interests that need clarification, and plausible mismatches in
goals, availability, experience, location, or commitment. Similar wording can hide
different goals, while different wording can describe a useful connection.

| Scenario | Purpose | Users | Intents |
| --- | --- | --- | --- |
| [05-users-05-intents-cofounders-and-project-collaborators.json](scenarios/05-users-05-intents-cofounders-and-project-collaborators.json) | Explore complementary engineering, design, and research skills; distinguish a possible cofounder relationship from paid work or a bounded side project. | 5 | 5 |
| [06-users-08-intents-research-and-learning-peers.json](scenarios/06-users-08-intents-research-and-learning-peers.json) | Connect related research questions, study partners, and reciprocal methods learning; clarify prediction versus causal understanding and academic versus community goals. | 6 | 8 |
| [07-users-09-intents-creative-collaborators.json](scenarios/07-users-09-intents-creative-collaborators.json) | Bring writers, musicians, filmmakers, and designers together around complementary practices; explore medium, creative credit, paid briefs, and experimental work. | 7 | 9 |
| [08-users-10-intents-local-friendships-and-activity-partners.json](scenarios/08-users-10-intents-local-friendships-and-activity-partners.json) | Help newcomers and residents find friendship through walks, food, games, and other activities; clarify pace, travel, schedules, and comfort with a first meeting. | 8 | 10 |
| [09-users-12-intents-career-mentors-and-industry-peers.json](scenarios/09-users-12-intents-career-mentors-and-industry-peers.json) | Explore career transitions, bounded mentorship, reciprocal learning, and professional community; distinguish peer support and mentoring from recruiting. | 9 | 12 |
| [10-users-14-intents-community-and-climate-projects.json](scenarios/10-users-14-intents-community-and-climate-projects.json) | Connect organizers, volunteers, and specialists around repair, summer comfort, and community energy; clarify resources, authority, and local versus commercial climate goals. | 10 | 14 |

The respective intent counts per user are `1,1,1,1,1`, `2,2,1,1,1,1`,
`2,2,1,1,1,1,1`, `2,2,1,1,1,1,1,1`, `2,2,2,1,1,1,1,1,1`, and
`2,2,2,2,1,1,1,1,1,1`. These are discovery candidates, not preselected opportunities.
Matching excludes the principal's own intents. The runtime walks the descending
score ranking to open up to 10 new negotiations per intent per matching run under
the standing brief. Repeated matches reuse unsettled sessions and do not reopen
terminal ones; neither consumes the new-opening budget.

Multi-intent personas have separate aims and decisions within their shared private
instructions, exercising independent H2A conversations. The instructions describe
known facts, preferences, and choices that need human input, such as setting a
scope, agreeing to a meeting, or sharing creative work. Agents determine relevance
and outcomes during the run; fixtures contain no scripted transcripts or required
successful connections.

## Run against the API database

```bash
bun run --cwd services/api agent:tui
```

This local development command loads the root `.env.development`. It uses the
API's Postgres and Redis connections and real existing users, intents, matches,
and H2A messages. Run this standalone command with the normal API server stopped
so it can acquire the selected runtimes. The normal server now starts agents
automatically; both entry points use the same expiring Redis ownership keys.

Choose principal/intent sessions with Space or a click, then Enter to start.
Select intents belonging to at least two users. Select every intent you want to
switch between: the board's intent selectors offer these startup selections.
Only selected personal agents run; an unselected counterparty needs its own
runtime to respond. Each selected agent handles all its existing and newly
received matches independently of the visible board. Normal API discovery creates new matches; the TUI does not seed
users or bypass matching.

The command calls API services as the selected principals directly. This is a
trusted local testing entry point; HTTP authentication, scope checks, and human
consent gates remain enforced. A principal with a selected external negotiation
executor must release that binding before its local agent can run.

- H2A outputs commit atomically to durable records. Restart reconstructs history, exact pending questions, the standing brief and specific briefs; it does not replay model work or restore request queues.
- H2A activates only for accepted input, explicit manual Wake, or creation/broadcast. Inbound A2A uses the standing brief without waking H2A and pauses independently when it lacks facts or authority.
- Redis ownership prevents competing hosted runtimes. PostgreSQL owner locks and context/turn fences prevent stale effects during executor handover. Ctrl+C releases ownership while retaining records; a crashed process's key expires after 60 seconds.

For single-user testing through normal HTTP authentication and the web app,
see [the API's live testing instructions](../../services/api/README.md#personal-agents-and-live-web-testing).

## Controls

| Control | Action |
| --- | --- |
| Users button / Ctrl+U | Open the board roster; Space/click toggles users, Enter applies, Esc cancels |
| Click the intent header / Ctrl+T | Choose that user's intent with Up/Down + Enter or a click; Esc cancels |
| Full-width Wake above the input | Review current context without a chat message, submitting drafts or invalidating A2A briefs |
| Top-border [−] / Ctrl+O | Collapse a chat, keeping at least one expanded |
| Click a collapsed user | Expand and focus their selected intent |
| Up/Down, Enter | Choose a suggested answer as a local draft; move to the next unanswered question |
| Tab / Shift+Tab | Cycle users in roster order, expanding collapsed chats; include A2A only when visible |
| Ctrl+N | Cycle pair/network threads between the selected intents while A2A is visible |
| Enter in the text box | Draft the displayed answer, or send a direct message in message mode |
| Ctrl+Left / Ctrl+Right | Switch questions without losing drafts |
| Ctrl+S / Submit all answers | Submit the complete batch atomically |
| Ctrl+G | Switch between the batch and direct-message input |
| Custom reply / click the text box | Write an answer in your own words |
| Esc | Return from custom editing to choices, or close a selector |
| Ctrl+J | Insert a newline |
| Mouse wheel / PgUp / PgDn | Scroll the selected history |
| Ctrl+C | Stop the local run |

An H2A pane names its running activity with the shared agent's plain-English label:
**Matching counterparties automatically…** for runtime matching and automatic
openings, or **Reopening a terminal negotiation…** for deliberate reopening.
While a review is in flight with no activity executing, it says
**Preparing the next step…** instead. If a concurrent
negotiation change makes the final H2A effects stale, the pane says the review was
unfinished and asks for a fresh message; it never retries or wakes H2A automatically.
The A2A pane still shows **Thinking…** and identifies the agents currently processing
that match, such as `Alice Morgan's Agent`. These indicators track runtime activity
rather than the last reported status; they clear on completion, pause, failure or
shutdown. They do not block editing, create history entries or wake agents.

Each H2A review's tool calls and automatic matching activity share one bordered
box alongside the conversation. `match_counterparties` is a runtime activity, not
a model-callable search or selection tool. New boxes start expanded, showing each call's plain-English label, `running`,
`completed`, `error` or `cancelled` status, input details and outcome/error summary.
Details appear while the tool runs and remain visible on failure or cancellation.
Click to collapse or expand the full sequence; your choice is retained across live
updates and intent switches. Collapsed headers show the latest action, status and
call count. Matching activity shows authorized networks, scored counterpart
intents in descending score order, match probabilities and automatic opening
outcomes, not generated queries
or model-selected/skipped candidates. Explicit reopening activity shows the known
session, public reasoning and the owner's complete private brief. Per-item outcomes
distinguish saved openings, reuse without brief changes, unavailable items, items
not attempted after the new-opening budget is filled, and stopped or unconfirmed
openings. Only the pane owner's private brief is shown,
including the full brief being saved; counterpart information
is public names and intents, not their private briefs. Activity is owner-only, never
sent to counterparties. These are ephemeral live-session observations, not chat
messages, model evidence or persisted history; they are excluded from transcript
exports. Completed means the tool call returned, not that every opening succeeded
or every later review effect committed.

A2A action labels use blue for **propose**, amber for **counter**, green for
**accept** and red for **decline**. Message text stays neutral. Sessions share one
pair thread, with chronological dividers showing each outcome and opportunity status.
Prior sessions are history, never current offers; live activity belongs to the latest
session. Opening a successor preserves H2A questions and answer/message drafts.

Every supplied user starts on the board with their first supplied intent selected.
The roster requires at least two distinct users. Expanded chats share the width
equally, targeting at least 40 columns each. Overflow collapses from the end of
roster order while preserving the focused user. A 24-column scrollable list shows
collapsed users, their selected intent, and counts of pending questions across their
intents. Names and question indicators highlight only while a question awaits input. Selecting a collapsed user displaces another
chat if needed.
Widening restores automatically collapsed chats; manually collapsed chats stay
collapsed until selected.

A2A appears between exactly two expanded users, including when other users are
collapsed. The two chats share space with A2A, becoming narrower when needed to
keep the negotiation visible. With one or three or more expanded users, A2A is
hidden. An unmatched pair shows an empty A2A pane.

Each user–intent pair retains its agent, draft, history and scroll position,
suggested-answer selection, pending questions, and in-flight sends through intent,
roster, and layout changes. Questions keep their batch membership, ID, wording and
suggestions while you draft. A selection or custom answer is not sent until every
question has an answer and you submit the complete batch. New questions have no
negotiation references. **Wake** calls `Agent.wake()` for the selected
intent. Its private `h2a.wake` receipt requests review of existing context without
adding a chat message, answering a question, granting authority or invalidating
A2A briefs. Pending questions and both answer and message drafts remain intact.
H2A decides whether to reply, ask or update briefs; after a completed review, the
runtime matches ready peers under the standing brief. Wake does not directly
resume A2A. Only explicit Wake, fixture-creation events, accepted messages
and answers activate H2A in the scenario host. Selecting users/intents, expanding
chats, tool observations and negotiation updates do not activate it. A2A continues
independently under a current brief, ending each local run immediately after its
submission result. A stall waits for the next permitted H2A review and an explicit
specific-brief update. Settled sessions stay terminal; H2A can deliberately start a
new session in the same conversation without changing earlier terms or approvals.

## Scenario format

Add a JSON file under `scenarios/`:

```json
{
  "users": [
    {
      "id": "alice", "name": "Alice",
      "instructions": "I am a frontend engineer. Ask before committing me to work.",
      "intents": [
        { "id": "prototype", "intent": "Find a design partner" },
        { "id": "research", "intent": "Find a researcher for an accessibility prototype" }
      ]
    },
    {
      "id": "bob", "name": "Bob",
      "instructions": "I am a product designer. Ask before committing me to work.",
      "intents": [
        { "id": "prototype", "intent": "Find an engineering partner" },
        { "id": "content", "intent": "Find a plain-language content designer" }
      ]
    }
  ]
}
```

User IDs must be unique, and intent IDs must be unique within each user. All shown
fields are required, with at least two users and at least one intent per user.
The `intents` array replaces the previous single `intent` field. Scenario
`instructions` are shared private context for that user's intent agents, injected
as each agent's `principalContext`. The API host
instead supplies confirmed profile fields, the current intent, and that intent's
stored H2A conversation. Neither host invents profile facts from an intent.

## Host injection

`mountNegotiationTui(renderer, host)` takes a `NegotiationTuiHost`: selectable
principal/intent entries, agent conversation/input handles, observed match records,
and a change event. It reads `reviewing` and `negotiating.includes(opportunityId)`
for live activity, and `toolCalls` for ephemeral H2A tool cards. The shared agent
supplies each call's `label`, owner-scoped input `details` and outcome/error `summary`
for inbox review, standing-brief saving, matching with automatic opening, and
explicit terminal-session reopening. Details can include the owner's full private
brief, authorized networks, public counterpart intents, probabilities and reasoning.
Opening summaries include per-item outcomes, including stopped or unconfirmed
openings. The view renders these fields as plain text with line breaks, without
interpreting domain data or feeding activity back as model evidence. Tool completion does not confirm
later review effects were persisted. Messages and complete answer batches go
through `Agent.receiveInput()`, which persists accepted input and schedules one H2A
review. The view neither selects models nor schedules negotiations.
`NegotiationLab(scenario, { model, evaluator })` implements this interface with
in-memory storage, the shared discovery pipeline, and the protocol capability.
Version `0.13.0` replaces the former `embedder` option with a required
`IntentPairEvaluator`; the CLI constructs `TypeSafeIntentEvaluator(TYPESAFE_API_KEY)`.
OpenRouter still supplies the conversational `model`.
The lab retains `discovery.searched` events as `{ inputId, matchId, networkIds,
candidateIntentIds }` in `lab.events`; there are no `candidate.evaluated`
selected/skipped events. Labels and activity summaries come directly from the
agent runtime rather than TUI-specific discovery handlers.
Construction initializes each `Agent` immediately; `agent.ready` covers ownership
and hydration without model work. After mounting the board, `lab.start()` awaits
readiness and announces its newly created fixture intents through
`Agent.wake({ type: 'intent.created', id })`; the normal backend uses the same agent
entry point for `IntentService.create()`'s post-commit `intent.created` event.
`ApiNegotiationHost` in `services/api` implements the view interface with API services
and durable agent sessions. The libraries do not import one another; each host
composes them.

Each `AgentHost.subscribe()` registers an A2A event listener during construction
and returns a disposer. The lab delivers match and turn notifications to those
listeners, never to a public agent event method. `lab.stop(opportunityId)` delivers
`negotiation.stopped` to cancel only that match; `lab.stop()` aborts the injected
signal and awaits every agent's `closed` promise to drain work and close records.

The protocol advertises available actions, validates submissions against the
current turn count, enforces 12 total A2A turns, and leaves an exhausted match
undecided. A2A agreement moves an opportunity to pending human review.

The library build keeps workspace dependencies external and clears these source
aliases for declarations, so the API-backed TUI still uses normal package exports.

```bash
bun run --cwd packages/agent check
bun run --cwd packages/discovery build
bun run --cwd packages/protocol build
bun run --cwd packages/agent-tui check
bun run --cwd packages/agent-tui build
```
