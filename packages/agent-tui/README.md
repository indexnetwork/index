# @indexnetwork/agent-tui

Private Bun workspace for exercising real personal agents in a local terminal.
The package depends on `@indexnetwork/agent` and owns its OpenTUI dependency.
Production integration follows `services/api → protocol → agent`; neither the
protocol nor the API depends on this testing host.

## Local three-pane TUI

The local lab includes **12 selectable users** and runs real `@indexnetwork/agent`
instances against in-memory negotiations. No Index API, database, frontend, or
Index credentials are used.
The host initializes one long-lived `NegotiationAgent` per user/intent from
`@indexnetwork/agent` and delivers simulated match and turn-update events.
The library owns turn scheduling, prompts, tools, question resumption, and private
conversation history. There is **one H2A conversation per user/intent** and
**one A2A conversation per match**. The lab supplies simulated records and events.
The TUI owns the displayed users, focus, and drafts, sends principal input, and
observes agent state. Selecting a pane does not schedule agent work.

```bash
# From this worktree. The env file supplies OPENROUTER_API_KEY.
bun --env-file=.env.development run agent:tui packages/agent-tui/scenarios/negotiation.json
```

The command accepts one to three ordered model IDs after the scenario path:

```bash
bun --env-file=.env.development run agent:tui packages/agent-tui/scenarios/negotiation.json \
  google/gemini-3.8-flash anthropic/claude-haiku-4.5
```

The CLI constructs the OpenRouter client and injects it into the lab. Without
model IDs, it uses the agent package's defaults. Credentials, model selection,
retry policy, and cooldowns are implemented by `ModelClient` in the agent package;
the lab and terminal do not implement another model client.

Use a terminal at least 100 columns wide (120+ recommended):

```text
┌─ H2A · Alice ──────┬─ A2A · negotiation ──┬─ H2A · Bob ─────────┐
│ Alice ▾ · 1/12    │     Alice ↔ Bob     │ Bob ▾ · 2/12       │
│ Intent + mandate  │                     │ Intent + mandate   │
│ Private chat      │ Shared agent turns  │ Private chat       │
│ Your messages     │                     │ Your messages      │
├───────────────────┤     Read-only       ├────────────────────┤
│ Message as Alice… │                     │ Message as Bob…    │
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
  You can also message your PA at any time when no question is displayed, for
  example “Any active negotiations?” or a new preference. Direct messages get
  a reply ahead of background updates, using that user's match state and H2A history.
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
- **Enter** answers that user's displayed question ID, even if it concerns
  a different match from the center pane. **With no active question, Enter sends
  a message to that user's personal agent.** Empty input and stale question
  answers are rejected; unsent drafts stay with their user until sent.
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

## Package boundaries

- `src/main.ts` loads the scenario and credentials, constructs the model and
  terminal renderer, starts the lab, and saves the private transcript on exit.
- `src/negotiation.lab.ts` initializes the real agents, maintains simulated A2A
  records, and delivers match events and updates after successful writes.
  It can run without mounting a terminal view. Its model dependency is required.
- `src/negotiation.tui.ts` renders the lab and handles human input through
  `message()` and `answer()`. It owns left/right selection and drafts.

The package exports `NegotiationLab`, `parseScenario`, and `mountNegotiationTui`:

```ts
import { ModelClient } from '@indexnetwork/agent';
import { NegotiationLab, parseScenario, mountNegotiationTui } from '@indexnetwork/agent-tui';

const model = new ModelClient({ apiKey, models });
const lab = new NegotiationLab(parseScenario(scenarioJson), { model });
mountNegotiationTui(renderer, lab);
lab.matchAll();
// At host shutdown:
await lab.stop();
```

The model is shared; each principal's conversation and per-call cancellation and
retry reporting remain separate. Agent behavior, including question grouping,
approval scope, H2A communication, and concurrent match scheduling, stays in
`@indexnetwork/agent`. The simulated host exercises that contract; it does not
verify the API's persistence implementation. State lasts for the current process.

For the separate REST host, see [its documentation](../../scripts/agent-negotiation.md).

## Verification

```bash
bun install
bun run --cwd packages/agent check
bun run --cwd packages/agent-tui check
bun run agent:tui --help
```

Use the live command above in a terminal or an isolated `tmux` session to check
both user selectors, background A2A progress, free messages, question answers,
drafts, and Ctrl+C transcript export.
