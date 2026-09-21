# @indexnetwork/agent-tui

A terminal testing platform for the new `@indexnetwork/agent` runner and agent layers. It displays one pane per selected
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

The launcher loads the agent and protocol workspace source entry points through
this package's `tsconfig.json`. It does not rebuild shared `dist` directories or
depend on them remaining present during another workspace build. The library
build keeps workspace packages external and emits declarations against their
normal public exports.

Requires `OPENROUTER_API_KEY` and an interactive terminal. Choose a JSON scenario
with Up/Down + Enter or a click. The chooser displays filenames in alphabetical
order, starting with the five-user cofounder scenario. The six bundled scenarios
have 5–10 users and 5–14 intents. Every user–intent pair has its own H2A conversation
and intent-bound `PrincipalAgent`, managed by one `AgentRunner` per user. Agents
discover people and open opportunities after startup; no matches are pre-seeded. All work
runs independently of the visible board.
Changing users, intents, or collapsed panes only changes what you see.

Override the shared model client's ordered model list with one to three IDs:

```bash
bun --env-file=.env.development run agent:tui google/gemini-3.8-flash anthropic/claude-haiku-4.5
```

`createExecute(new OpenRouterClient(...))` runs each bounded reasoning/tool loop.
OpenRouter handles ordered model/provider failover; the client does not retry or
wait out rate limits. Failures appear on the board and in the exported transcript.
No HTTP server, Redis, or
database is required for the scenario host. Ctrl+C requests cancellation, prevents
further host writes, and saves a private Markdown transcript in a temporary
directory without draining model requests. Each scenario launch starts fresh.

The bundled scenarios can start many concurrent reasoning runs. Running them sends
fictional scenario context and any text you enter to OpenRouter and its selected
model providers, and incurs normal model usage costs.

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
`2,2,2,2,1,1,1,1,1,1`. All intents share one local simulated network. Discovery
ranks other users' intent statements against the H2A agent's private query, and an
opportunity exists only after the agent asks the host to create it.

Multi-intent personas have separate intent statements, exercising independent H2A
conversations. The intent is each agent's starting context; additional facts,
preferences, and decisions enter only through user messages in the TUI. Agents
determine relevance and outcomes during the run; fixtures contain no scripted
transcripts or required successful connections.

## API integration boundary

This port runs the local scenario host only. The copied
`services-api/negotiation.host.ts` still targets the old agent library, references
API-only modules, and is not compiled or imported by this package. It is retained
unchanged for Seref's separate API integration work; there is no supported
API-database launcher here yet.

A future API host can implement `NegotiationTuiHost` without changing the board:
provide host-owned conversations and input methods, observed negotiations, and
change notifications. Persistence, authorization, subscriptions, and distributed
ownership remain that host's responsibilities—not the TUI's or the runner's.

## Controls

| Control | Action |
| --- | --- |
| Users button / Ctrl+U | Open the board roster; Space/click toggles users, Enter applies, Esc cancels |
| Click the intent header / Ctrl+T | Choose that user's intent with Up/Down + Enter or a click; Esc cancels |
| Wake button beside the intent header | Request H2A reasoning for that user–intent session without sending a message or answer |
| Top-border [−] / Ctrl+O | Collapse a chat, keeping at least one expanded |
| Click a collapsed user | Expand and focus their selected intent |
| Up/Down, Enter | Select and confirm a suggested answer |
| Tab / Shift+Tab | Cycle users in roster order, expanding collapsed chats; include A2A only when visible |
| Ctrl+N | Cycle matches between the selected intents while A2A is visible |
| Enter in the text box | Send the displayed answer or direct message, according to the input mode |
| Ctrl+G / input-mode control | Switch between answers and direct messages without losing either draft |
| Click Activity / a run heading | Expand the session's activity, then an execution's tool details; both start collapsed |
| Custom reply / click the text box | Write an answer in your own words |
| Esc | Return from custom editing to choices, or close a selector |
| Ctrl+J | Insert a newline |
| Mouse wheel / PgUp / PgDn | Scroll the selected history |
| Ctrl+C | Stop the local run |

### Activity and tool details

Each H2A session has a **Wake** button beside its intent header. It asks the runner
to reason from fresh host context without fabricating a user message, answering a
question, or itself releasing a negotiation hold. Existing drafts and pending
questions are retained. Clicks during an active wake coalesce into at most one
follow-up without cancelling the current run. A wake may remain silent; clicking
is not consent, a forced question, or a retry of every held negotiation. The click
itself is not exported, but any resulting agent messages are. Live wakes use the
same billed model executor as other agent work.

Each H2A pane shows the latest running tool's plain-English label, or
**Preparing the next step…** while a wake or one-opportunity briefing is reasoning
between calls. The A2A pane shows **Thinking…** and names the agents currently
reasoning on that match. Indicators track active execution, not the last status
message; they clear on completion, error, or cancellation without disabling input.

Each H2A history has one **Activity** section containing all host outcomes and
tool runs. It starts collapsed, showing result/tool-call totals and running/error
counts. Individual wake/brief runs also start collapsed; expand a run to inspect
its inputs, returned feedback or error, and `running`, `completed`, `error`, or
`cancelled` status. Expansion state survives live updates, intent switches, and
resizing; new entries do not open the section. `Completed` means the handler
returned, not that the runner has persisted every action or the negotiation has
succeeded. Briefing details include their opportunity ID.

Dialogue stays outside Activity: messages from you are purple, your answers green,
agent replies blue, questions amber, and retired-question notices muted, with
tinted cards and readable neutral body text. Activity distinguishes wake runs in
blue, briefings in purple, agreed outcomes in green, declined outcomes in red,
and closed outcomes in gray. Outcome rows include the counterpart's intent so
multiple matches with the same person are not mistaken for conflicting results.

Tool calls are ephemeral, owner-only observations: a pane never displays another
principal's tool details. They are not conversation messages, are not supplied to
the agents as evidence, and are excluded from the exported transcript. The TUI
wraps the existing `Execute` interface and tool handlers without changing agent
prompts, budgets, results, errors, or scheduling.

A2A labels are blue for **propose**, amber for **counter**, green for **accept**,
and red for **decline**; message bodies remain neutral. Scrollbar gutters remain
reserved, and conversation text rewraps when panes change width.

### Retained conversations and drafts

Every supplied user starts on the board with their first supplied intent selected.
The roster requires at least two distinct users. Expanded chats share the width
equally, targeting at least 40 columns each. Overflow collapses from the end of
roster order while preserving the focused user. A 24-column scrollable list shows
collapsed users, their selected intent, and counts of pending and queued questions
across their intents. Names and question indicators highlight only while a question
awaits input; queue counts stay muted. Selecting a collapsed user displaces another
chat if needed.
Widening restores automatically collapsed chats; manually collapsed chats stay
collapsed until selected.

A2A appears between exactly two expanded users, including when other users are
collapsed. The two chats share space with A2A, becoming narrower when needed to
keep the negotiation visible. With one or three or more expanded users, A2A is
hidden. An unmatched pair shows an empty A2A pane.

Each user–intent pair retains its conversation, separate answer and direct-message
drafts, history and scroll position, suggested-answer selection, pending questions,
and in-flight sends through intent, roster, and layout changes. Ctrl+G or the
input-mode control lets you message the principal agent while questions remain
pending. Switching modes neither submits nor reinterprets a draft; direct messages
do not mark pending questions answered. Answers still send individually, not as a
batch. Questions keep their ID, wording, scope, and match
references while you answer. The oldest unanswered question is shown first;
answered or retired questions leave the queue. If the current question changes
while you are typing, your draft is kept but cannot answer the replacement until
you edit/clear it or explicitly choose a suggested answer. An answer copies the
question's scope and match references, is saved, then triggers a `principal.input` event.
The principal agent decides whether a question is intent-wide or match-specific.
Briefs, decisions, and stalls remain in storage for the runner but are not shown
as H2A chat messages.

When a committed A2A turn settles a match, both participating intent conversations
receive a **Host result** note naming their counterpart, counterpart intent, and
recorded outcome.
These are factual host-authored records, not agent summaries or human input.
Agreements explicitly do not authorize project commitments. The notes remain in
the collapsed Activity section, a separate **Host outcomes** section in the
exported transcript, and later principal-agent context after the match leaves the
open-negotiation list. They neither answer pending questions nor
trigger a wake or release holds. Rejected turns, stalls, turn exhaustion, and
shutdown do not produce settlement notes.

## Scenario format

Add a JSON file under `scenarios/`:

```json
{
  "users": [
    {
      "id": "alice", "name": "Alice",
      "intents": [
        { "id": "prototype", "intent": "Find a design partner" },
        { "id": "research", "intent": "Find a researcher for an accessibility prototype" }
      ]
    },
    {
      "id": "bob", "name": "Bob",
      "intents": [
        { "id": "prototype", "intent": "Find an engineering partner" },
        { "id": "content", "intent": "Find a plain-language content designer" }
      ]
    }
  ]
}
```

User IDs must be unique, and intent IDs must be unique within each user. All shown
fields are required, with at least two users and at least one intent per user. Each
intent conversation starts empty. The fictional user's supplied name is the only
confirmed profile data; principal input enters only through TUI user actions.
Negotiators receive the principal layer's brief, never the raw H2A conversation.

## Host injection

`mountNegotiationTui(renderer, host)` takes a `NegotiationTuiHost`: selectable
principal/intent entries, a `conversations` map of `TuiConversation` views/input
methods, an `activities` map of `TuiActivity` observations keyed by the same
principal/intent IDs, observed match records, a `wake(principalId)` operation, and
a change event. Manual wake requests are delegated to that host operation; the
view neither selects models nor schedules negotiations. There are no `NegotiationAgent` or `MemoryPrincipalStore`
dependencies.

`NegotiationLab(scenario, { execute })` composes the new package with in-memory
`AgentHost` operations and protocol rules:

- One `AgentRunner` per user owns scheduling for all that user's intents.
- One `ReasoningObserver` per intent tracks execution and H2A tool activity outside
  the agent library and conversation storage.
- One `ConversationStore` per intent stores raw `{ kind: "text", text }` parts and
  `metadata.principalMessage`, preserving questions, briefs, decisions, stalls,
  and host-result notes. `TuiMessage.source` distinguishes host authorship in the
  view and export; saved note text also identifies its source for agent reads.
- `start()` reconciles first-turn work and sends `intent.created` once for every
  newly seeded intent, including when startup is called repeatedly. It resolves
  after scheduling, not after model work finishes. Initial H2A wakes may remain
  silent; activation does not force a question or alter agent decision policy.
- Turn commits synchronously validate ownership, the expected turn count, and
  protocol rules before forwarding `negotiation.turn` to the participating runners.
- Discovery ranks the other users' intents in the shared local network and excludes
  pairs that already have an opportunity. `createOpportunities` opens selected pairs
  idempotently; the first caller becomes the initiator.
- `stop()` cancels runners and closes all stores; `markdown()` still exports the
  saved H2A and A2A history. No checkpoint, lease, or restart recovery is implied.

The protocol enforces 12 total A2A turns and leaves an exhausted match undecided.
The local host additionally enforces the new fixed-role rule: **the original
initiator can never accept**, even in later rounds. Only the original responder
can accept an outstanding proposal. An A2A agreement is not human consent.

```ts
import { createExecute, OpenRouterClient } from '@indexnetwork/agent';
import { mountNegotiationTui, NegotiationLab } from '@indexnetwork/agent-tui';

const lab = new NegotiationLab(scenario, {
  execute: createExecute(new OpenRouterClient({ apiKey })),
});
// Mount the board before startup so it observes all changes.
mountNegotiationTui(renderer, lab);
await lab.start();
// On terminal shutdown:
lab.stop();
```

Here `scenario`, `apiKey`, and `renderer` are supplied by the caller; `src/main.ts`
is the executable launcher.

```bash
bun run --cwd packages/agent check
bun run --cwd packages/protocol build
bun run --cwd packages/agent-tui check
bun run --cwd packages/agent-tui build
```
