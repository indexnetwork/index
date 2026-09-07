# Run an autonomous negotiation

## Local three-pane TUI

The local lab includes **12 selectable users** and runs real `@indexnetwork/agent`
instances against in-memory negotiations. No Index API, database, frontend, or
Index credentials are used.
The host initializes one long-lived `NegotiationAgent` per user/intent from
`@indexnetwork/agent` and delivers simulated match and turn-update events.
The library owns turn scheduling, prompts, tools, question resumption, and private
conversation history. There is **one H2A conversation per user/intent** and
**one A2A conversation per match**. The TUI supplies records and human answers
and observes the selected users and pair; it does not run or schedule agents.

```bash
# From this worktree. The env file supplies OPENROUTER_API_KEY.
bun --env-file=.env.development run agent:tui scripts/agent-negotiation.scenario.json
```

Use a terminal at least 100 columns wide (120+ recommended):

```text
┌─ H2A · Alice ──────┬─ A2A · negotiation ──┬─ H2A · Bob ─────────┐
│ Alice ▾ · 1/12    │     Alice ↔ Bob     │ Bob ▾ · 2/12       │
│ Intent + mandate  │                     │ Intent + mandate   │
│ Private questions │ Shared agent turns  │ Private questions  │
│ Your answers      │                     │ Your answers       │
├───────────────────┤     Read-only       ├────────────────────┤
│ Reply as Alice…   │                     │ Reply as Bob…      │
└───────────────────┴─────────────────────┴────────────────────┘
```

- Click the **user name above either side**, or focus that side and press
  **Ctrl+U**, to open its user picker. Click a user to switch, or use **↑ / ↓**
  and **Enter**. **Esc** cancels. The opposite side's user is excluded so a user
  cannot negotiate with themselves. Both sides can select from the same roster.
- This lab simulates the stage **after matching**: every distinct user pair is
  treated as a match. All **66 negotiations start automatically in parallel**
  when the bundled 12-user scenario launches. Match events trigger the library's
  agents, which check authoritative turn order before acting. A question pauses
  only its own negotiation; other pairs continue independently, including other
  matches involving the same user.
- User selection changes the displayed users; the center pane shows their
  pair's shared turns. Each side shows its user's **single H2A conversation**
  across all matches. Changing the opposite user preserves that H2A history,
  scroll position, and draft. Drafts also follow a user between left and right.
- H2A shows questions and meaningful, consolidated outcomes. Routine A2A
  progress and per-turn model summaries stay out of the human conversation.
  The PA reviews relevant background events in short batches and can stay silent.
- Each principal has **one active question**, labeled **For this intent** for
  shared facts or **About [counterparty]** for a match-specific decision. If a
  related request arrives while you answer, it can join the existing question
  internally; the displayed question, options, scope, and draft stay stable.
  Other details and approvals remain queued. All waiting requests reconsider
  your answer before another question appears. Other users never receive the
  private answers.
- Pairs continue in the background until they need a human answer, settle, or
  stop. The status bar shows **12 H2A conversations, 66 A2A matches**, and the
  number of principals awaiting answers. Selecting a pair never starts or
  restarts its agents.
- Click a side pane to act as that user, or use **Tab / Shift+Tab** to change
  focus. The focused pane has a blue border; a pending question is highlighted.
- The reply picker shows a **highlighted row with a `›` marker**. Click a
  suggested answer or use **↑ / ↓** to select it, then **Enter** to confirm.
  Clicking an answer only selects it—it does not immediately send it. No Alt
  shortcuts or terminal modifier configuration are needed.
- The last row is always **Custom reply…**. Select it and press **Enter**, or
  click the text box, to write your own answer. **Esc** returns from the editor
  to the picker. Arrow keys edit text normally while the editor is focused.
- Suggestions come from `request_principal_input.options`. The negotiation
  prompt and tool schema request **2–4 suggested answers for every focused question**, including
  neutral self-description categories when personal facts are missing. A choice
  becomes a fact only after the principal confirms it; the TUI does not invent
  answers. **Custom reply…** remains available for every question.
- **Enter** submits to that user's displayed question ID, even if it concerns
  a different match from the center pane. Empty and duplicate replies are
  rejected; unsent drafts stay with their user until you send an answer.
- Both selected options and custom replies are recorded in the private
  transcript and resume the same agent; answering does not itself create a
  shared A2A turn.
- **Ctrl+J** adds a newline. Mouse wheel or **PageUp / PageDown** scrolls the
  selected transcript, or the open user picker. The center pane cannot send messages.
- Agents take turns autonomously. Settlement or failure stays on screen for
  inspection. **Ctrl+C** cancels outstanding work for **all pairs**,
  restores the terminal, and prints the path of a private Markdown transcript
  containing each user's H2A history once, followed by the separate A2A match
  transcripts. It includes all users' private messages; do not share it as if
  it were only the public negotiation.

The bundled roster is Alice, Bob, Carla, Diego, Emma, Farah, Gabriel, Hana, Ivan,
Jules, Kai, and Leila, with different roles, goals, and collaboration limits.
Copy and edit the scenario JSON to change users, intents, and private instructions:

```json
{
  "users": [
    { "id": "alice", "name": "Alice", "intent": "...", "instructions": "..." },
    { "id": "bob", "name": "Bob", "intent": "...", "instructions": "..." }
  ]
}
```

Each user needs a unique, nonempty `id`, plus a name, intent, and instructions.
At least two users are required. This replaces the old `left`/`right` scenario
format. Rerun the command for a fresh lab; there is no live profile editor or
restart recovery. You answer the fictional users' questions
in the TUI—no canned human replies are supplied. The model may agree, decline,
or ask questions; the host does not choose that outcome. Model calls incur
normal OpenRouter usage. No live commitments are created by the local lab.

## REST runner

The standalone terminal host in `agent-negotiation.ts` binds real Index REST
clients to two long-lived `NegotiationAgent` instances from `@indexnetwork/agent`.
It sends each a match event and relays acknowledged turn updates to both agents.
They use the same event-driven library runtime as the TUI. This is a controlled,
single-negotiation host, not an API-hosted
runner: no A2A, SSE watcher, background scheduling, DMs, or restart recovery.

## Who decides what

Each personal agent receives its own principal's identity, intent, instructions,
and private conversation history. It sees the counterparty only through the
shared Index negotiation. Neither model receives an API key, the other
principal's instructions, or their private answers.

Each library agent follows Index's `awaitingUserId` and submits its chosen turn
through its own client **without an approval prompt**. The prompts—not a scripted
negotiation or a host decision tree—tell agents to:

- Pursue the principal's actual intent within their authority, not agreement
  for its own sake. Do not substitute an introductory call unless authorized.
- Act autonomously when the known preferences and authority are sufficient.
- Ask their principal one focused question when a missing personal fact,
  preference, or authorization materially changes the next decision or response.
  An intent is a goal, not evidence of experience or availability. Do not invent
  facts, evade material incoming questions, or ask an intake checklist.
- Negotiate unknown counterparty terms with the other agent rather than ask
  their own principal to guess them.
- Accept only an understood standing offer; counter or decline when appropriate.
  A commitment to meet does not mean a meeting has been scheduled.
- Reuse known personal facts across matches, respect the originating match of
  an approval, and consider existing commitments before agreeing to more work.

Parallel decisions use the same private context. The runtime serializes each
principal's outgoing submissions and reconsiders a decision when a human answer
or accepted commitment changed that context before submission.

Human participation is limited to answering an agent's principal question.
The host does not write offers, choose an outcome, or decide when a substantive
question is needed. Prompt adherence is model behavior, not a permissions
sandbox: only use principals and credentials whose autonomous participation you
are authorized to run.

## Before running

- Start the local Index API; the frontend is an optional observer.
- Select an existing open negotiation using its **opportunity ID**, not its
  negotiation ID. This command does not create or reset negotiations.
- Obtain separate Index API keys for both principals. This local host holds
  both keys but binds each agent's tools to only its own key and the selected
  opportunity. Do not run another writer for either seat concurrently.
- Supply `OPENROUTER_API_KEY` in the terminal environment.
- Put each principal's actual preferences and limits in a separate local text
  file outside Git. Do not write a desired proposal, scripted question, or
  predetermined outcome. The host reads each principal's intent from Index.

Example instructions for a disposable collaboration fixture:

```text
Explore whether this collaboration is a fit for my stated intent.
You may discuss possible terms, but do not commit me to paid or unpaid work,
delivery dates, or exclusivity without my authorization.
```

Use only permissions and preferences the principal actually supplied. These
instructions deliberately leave room for a genuine question; they do not
require one. If a principal has already authorized a specific next step, include
that rather than making the agent ask for the same permission again.

## Run both sides

From the repository root or task worktree:

```bash
export INDEX_API_URL=http://localhost:3001
# Enter keys without echoing them or placing them in shell history.
read -rs INDEX_API_KEY; export INDEX_API_KEY; echo
read -rs INDEX_COUNTERPARTY_API_KEY; export INDEX_COUNTERPARTY_API_KEY; echo
# OPENROUTER_API_KEY must also be set; it is a different credential.
bun run agent:negotiate <opportunity-id> /tmp/alice-instructions.txt /tmp/bob-instructions.txt
```

The first file belongs to `INDEX_API_KEY`'s owner; the second belongs to
`INDEX_COUNTERPARTY_API_KEY`'s owner. The command checks that these are the two
distinct seats. Either seat may be awaiting: Index, not argument order, chooses
who runs first. This replaces the earlier single-owner, approved-turn command.

When the communication inbox presents a question, the terminal shows **which
principal** should answer. Supply only that principal's answer. The agent resumes
its private conversation and decides
what to do next; the host does not turn the answer into an offer. An empty
answer stops without fabricating a reply. Without an interactive terminal, the
host prints the question and stops unanswered. A question never becomes an
Index negotiation turn by itself.

After an acknowledged turn, the host relays a turn-update event; the library
automatically runs the agent whose turn it is if Index is still open. The session
stops on settlement, an unanswered question, a failed
or uncertain write, an agent making no progress, the agent's step limit, or a
fixed 12-turn session ceiling. Reaching a ceiling does **not** mean agreement
or decline. There is at most one POST attempt per agent turn and no automatic
POST retry. Index continues to enforce turn order and settlement.

The terminal prints each acknowledged turn and a fresh server transcript at the
end. A model saying “done” is not evidence of submission. After a timeout, the
server may have committed the turn: inspect the fresh transcript before
restarting. The host deliberately does not continue after an uncertain write.

Private questions, answers, and model histories remain in memory only for this
process. Put lasting preferences from answers into that principal's instructions
file before restarting. Do not mix the two files. The shared turn log stays in
Index and is read afresh. This command does not create keys, reset databases,
resume discovery, or connect principal questions to DMs.

## Verification

```bash
bun run agent:negotiate --help
bun run agent:tui --help
bunx tsc --noEmit --strict --skipLibCheck --target ES2022 \
  --module Preserve --moduleResolution bundler --types bun,node \
  scripts/agent-negotiation.ts scripts/agent-negotiation.tui.ts
cd packages/agent && bun run check
```
