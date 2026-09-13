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

Requires `OPENROUTER_API_KEY` and an interactive terminal. Choose a JSON scenario
with Up/Down + Enter or a click. The chooser displays filenames in alphabetical
order, starting with the five-user cofounder scenario. The six bundled scenarios
have 5–10 users and 5–14 discoverable intents, with **no pre-created negotiations**.
Loading a scenario emits one `intent.created` event per intent. Each intent's H2A
first saves its standing brief, making that fixture discoverable, then searches and
opens only selected counterparties with complete specific briefs. No initial chat message is required.
Agents and opened negotiations run independently of the visible board. Changing users, intents, or collapsed panes only changes what you see.

Override the shared model client's ordered model list with one to three IDs:

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
not a missing fictional user. An exported key can override the project's env file;
to use the key from `.env.development` without that inherited override, run:

```bash
env -u OPENROUTER_API_KEY bun --env-file=.env.development run agent:tui
```

### Discovery pipeline

The lab runs the same `CandidateDiscovery` implementation as the API, with injected
scenario data and in-memory cosine search instead of Postgres/pgvector. Both hosts
use the shared embedding generator: OpenRouter `openai/text-embedding-3-large`,
2,000 dimensions, and identical text normalization. The first search embeds the
fixture intent statements; those vectors are reused in memory for the rest of the
run. Each H2A query gets its own embedding and similarity threshold.

All fixture intents are active members of one simulated network, but each enters candidate retrieval only after its in-memory standing brief commits. Production scope,
hydration, membership checks, deduplication and ranking run against these fixture
ports. Search returns public names and intent text, never another user's private
`instructions`. Declined local negotiations provide recent-rejection evidence.
Search alone creates nothing: H2A selects a result through `open_negotiation`, which
rechecks both intents' standing readiness and saves a new session's opening brief before A2A. Unsettled sessions are reused unchanged; a deliberate selection of a terminal session may create a new session under the same pair.
This exercises real model and embedding requests, but not database or Redis behavior.

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
Search excludes the principal's own intents. A negotiation exists only after H2A
selects a candidate through `open_negotiation`; repeated unsettled selections reuse the session.

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

**Thinking…** appears in an H2A pane while its intent review is in flight. If a
concurrent negotiation change makes the final H2A effects stale, the pane says the
review was unfinished and asks for a fresh message; it never retries or wakes H2A
automatically. The A2A pane identifies the agents currently processing that match,
such as `Alice Morgan's Agent`. These indicators track
runtime activity, including model/tool work, rather than the last reported status;
they clear on completion, pause, failure or shutdown. They do not block editing,
create history entries or wake agents.

Each H2A review's tool calls share one bordered box alongside the conversation.
It starts collapsed, showing only the latest tool name and its `running`,
`completed`, `error` or `cancelled` status. Click to expand the full sequence or
collapse it again; expansion is retained when switching intents. These are
live-session observations, not chat messages, model reasoning or persisted history;
they are excluded from transcript exports. Completed means the tool call returned,
not that every later review effect committed.

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
negotiation references. **Wake** calls `NegotiationAgent.wake()` for the selected
intent. Its private `h2a.wake` receipt requests review of existing context without
adding a chat message, answering a question, granting authority or invalidating
A2A briefs. Pending questions and both answer and message drafts remain intact.
H2A decides whether to reply, ask, discover or update selected briefs; Wake does not
directly resume A2A. Only explicit Wake, fixture-creation events, accepted messages
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
and a change event. It reads `reviewing` and `isNegotiating(opportunityId)` for live
activity, and `toolCalls` for ephemeral H2A tool cards. It neither selects models nor schedules negotiations.
`NegotiationLab(scenario, { model, embedder })` implements this interface with
in-memory storage, the shared discovery pipeline, and the protocol capability.
After mounting the board, `lab.start()` announces its newly created fixture intents
through `NegotiationAgent.activate()`; the normal backend uses the same agent entry
point for `IntentService.create()`'s post-commit `intent.created` event.
`ApiNegotiationHost` in `services/api` implements the view interface with API services
and durable agent sessions. The libraries do not import one another; each host
composes them.

The protocol advertises available actions, validates submissions against the
current turn count, enforces 12 total A2A turns, and leaves an exhausted match
undecided. A2A agreement moves an opportunity to pending human review.

```bash
bun run --cwd packages/agent check
bun run --cwd packages/discovery build
bun run --cwd packages/protocol build
bun run --cwd packages/agent-tui check
bun run --cwd packages/agent-tui build
```
