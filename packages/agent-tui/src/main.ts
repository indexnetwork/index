#!/usr/bin/env bun
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExecute, OpenRouterClient } from '@indexnetwork/agent';
import { createCliRenderer } from '@opentui/core';

import { NegotiationLab, parseScenario } from './negotiation.lab.js';
import { COLORS, mountNegotiationTui } from './negotiation.tui.js';
import { chooseScenario } from './scenario.chooser.js';

const USAGE = `Usage: bun run agent:tui [model-id ...]

Requires OPENROUTER_API_KEY and an interactive terminal. Uses real agents and
in-memory negotiations; no Index API keys, database, or server are used.
Optionally supply one to three ordered OpenRouter model IDs to replace the defaults.
Choose a JSON scenario from packages/agent-tui/scenarios with Up/Down + Enter or
click it. Esc or Ctrl+C exits the chooser. Agents start only after selection.

Scenario users have id, name, and intents: [{ id, intent }, ...].
The six bundled scenarios have 5–10 users and 5–14 intents, covering collaborators,
research and learning peers, creative partners, local friendships, career mentors,
and community projects. Filenames sort alphabetically, with the five-user
cofounder scenario first. Each user has a runner and each intent an H2A conversation.
Startup activates each new intent's H2A agent once. The agent discovers people from
other scenario intents and opens opportunities through the host; negotiations do not exist
until an agent opens them. A wake may remain silent and does not guarantee questions.
Each user starts on the board with their first intent. Users/Ctrl+U opens the
roster: Space/click toggles users, Enter applies, Esc cancels. Keep at least two.
Click an intent header or press Ctrl+T to switch that user's intent with Up/Down
and Enter, or a click. Esc cancels. Each user-intent pair retains its own
H2A history, scroll position, draft, pending questions, choices, and in-flight sends.
Click [ Wake ] beside an intent header to request H2A reasoning for that session.
It sends no message or answer and does not itself release negotiation holds.
Clicks during a wake coalesce into one follow-up without interrupting the active run.
Top-border [−]/Ctrl+O collapses a chat; at least one stays expanded. Overflow collapses
from the end of roster order, preserving focus and targeting 40 columns per chat.
Click a collapsed user to expand them. Widening restores automatic collapses;
manual collapses stay until selected. The scrollable list shows pending questions.
A2A appears between exactly two expanded users, even with other users collapsed.
The chats share space with A2A at narrower widths. Ctrl+N cycles the expanded
users' selected intents' matches. Other expanded counts hide A2A. All agents keep
running. A2A action labels are blue for propose, amber for counter, green for accept,
and red for decline. Message text stays neutral. Live activity names the agent
thinking in A2A and the current H2A tool or preparation step. Input stays usable.
H2A host outcomes and tool runs share one Activity section, collapsed by default.
Expand Activity, then a wake/brief run, to see its inputs, results, or errors.
Types and statuses have distinct colors; human messages, agent replies, and
questions stay in styled chat cards. Tool details are not exported.
The principal layer may ask intent-wide or match-specific questions. Answers
are saved before notifying the runner; retired questions leave the queue.
Click a chat to act as that user. Click or use Up/Down to highlight an
agent-provided option, then Enter to confirm. Select Custom reply or click the
text box to write your own answer. Esc returns from editing to the choices.
Ctrl+G or the input-mode control switches between answers and direct messages,
retaining separate drafts. Direct messages work even while a question is pending.
Answers still send one at a time. A changed question never silently takes an old draft.
Ask about your negotiations or send another message in the same H2A conversation.
Settled matches add factual Host results with counterpart intents to Activity and
a separate export section. These are not human consent and remain in H2A context.
Tab/Shift+Tab cycles users, expanding collapsed chats, and includes visible A2A.
Ctrl+J adds a newline; mouse wheel or PgUp/PgDn scrolls history.
Ctrl+C stops all agents and exports each H2A conversation once, followed by A2A turns.
Rerun the command for a fresh lab with an edited user roster.
The launcher loads workspace sources; it does not rebuild shared dist directories.
`;

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 1 && models[0] === '--help') { console.log(USAGE); return; }
  if (models.length > 3) throw new Error(USAGE);
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run the TUI in an interactive terminal.');
  const scenarioDirectory = join(import.meta.dir, '../scenarios');
  const filenames = readdirSync(scenarioDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name).sort();
  if (!filenames.length) throw new Error(`No JSON scenarios found in ${scenarioDirectory}.`);
  let lab: NegotiationLab | undefined;
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const renderer = await createCliRenderer({
    useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: 'disabled',
    backgroundColor: COLORS.background,
    onDestroy: close,
  });
  try {
    const filename = await chooseScenario(renderer, filenames);
    if (!filename || renderer.isDestroyed) return;
    const scenario = parseScenario(JSON.parse(readFileSync(join(scenarioDirectory, filename), 'utf8')));
    lab = new NegotiationLab(scenario, {
      execute: createExecute(new OpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY, models: models.length ? models : undefined })),
    });
    mountNegotiationTui(renderer, lab);
    await lab.start();
    await closed;
  } finally {
    renderer.destroy();
    if (lab) {
      lab.stop();
      const transcriptPath = join(mkdtempSync(join(tmpdir(), 'index-negotiation-')), 'transcript.md');
      writeFileSync(transcriptPath, lab.markdown(), { mode: 0o600 });
      console.log(`\nPrivate transcript saved: ${transcriptPath}`);
      if (lab.agentStatus || [...lab.negotiations.values()].some((demo) => demo.phase === 'error')) process.exitCode = 1;
    }
  }
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
