#!/usr/bin/env bun
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModelClient } from '@indexnetwork/agent';
import { INTENT_MATCH_MODEL, TypeSafeIntentEvaluator } from '@indexnetwork/discovery';
import { createCliRenderer } from '@opentui/core';

import { NegotiationLab, parseScenario } from './negotiation.lab';
import { COLORS, mountNegotiationTui } from './negotiation.tui';
import { chooseScenario } from './scenario.chooser';

const USAGE = `Usage: bun run agent:tui [model-id ...]

Requires OPENROUTER_API_KEY, TYPESAFE_API_KEY, and an interactive terminal. Uses
OpenRouter for conversations and TypeSafe ${INTENT_MATCH_MODEL} for exhaustive public intent-pair
scoring without a cutoff, opening up to 10 new negotiations per intent per run in descending score order. No Index API keys,
database, or server are used. Private instructions and briefs are not sent to TypeSafe.
Optionally supply one to three ordered OpenRouter model IDs to replace the conversational defaults.
Choose a JSON scenario from packages/agent-tui/scenarios with Up/Down + Enter or
click it. Esc or Ctrl+C exits the chooser. Agents start only after selection.

Scenario users have id, name, instructions, and intents: [{ id, intent }, ...].
The six bundled scenarios have 5–10 users and 5–14 discoverable intents, covering collaborators,
research and learning peers, creative partners, local friendships, career mentors,
and community projects. Filenames sort alphabetically, with the five-user
cofounder scenario first. Each user-intent pair has a personal agent. Scenarios
start with no negotiations. Loading a scenario emits intent.created for each intent,
so H2A saves a standing brief. After a completed review, the runtime matches all ready
peer intents and opens the highest-scoring available pairs with that brief; matching never
reopens terminal sessions. Answer H2A questions; briefed A2A work runs independently.
Changing the visible board or receiving A2A activity does not activate H2A.
Thinking… marks in-flight H2A reviews and names agents working in the A2A pane;
it clears when work finishes, pauses or fails, without disabling input. A stale
review notice asks for a fresh message when a concurrent negotiation change
invalidates final H2A effects; it never retries or wakes H2A automatically.
Each user starts on the board with their first intent. Users/Ctrl+U opens the
roster: Space/click toggles users, Enter applies, Esc cancels. Keep at least two.
Click an intent header or press Ctrl+T to switch that user's intent with Up/Down
and Enter, or a click. Esc cancels. Each user-intent pair retains its own agent,
H2A history, scroll position, draft, pending questions, choices, and in-flight sends.
The full-width Wake button above the input reviews existing context without adding
a chat message, submitting drafts or invalidating A2A briefs. H2A tools and automatic
matching appear in a bordered group per review, collapsed by default to the latest call. Click to
expand/collapse running/completed/error/cancelled entries; they are not saved messages.
Top-border [−]/Ctrl+O collapses a chat; at least one stays expanded. Overflow collapses
from the end of roster order, preserving focus and targeting 40 columns per chat.
Click a collapsed user to expand them. Widening restores automatic collapses;
manual collapses stay until selected. The scrollable list shows pending questions.
A2A appears between exactly two expanded users, even with other users collapsed.
The chats share space with A2A at narrower widths. Ctrl+N cycles the expanded
users' selected intents' matches. Other expanded counts hide A2A. All agents keep
running. A2A labels use blue for propose, amber for counter, green for accept and
red for decline; message bodies stay neutral.
H2A owns a stable batch of independent questions; A2A can pause without creating
questions or waking H2A. Click a chat to act as that user. Click or use Up/Down to
highlight a suggestion, then Enter to draft it. Select Custom reply or click the
text box to draft your own answer. Esc returns from editing to the choices.
Ctrl+Left/Right switches questions. Ctrl+S or Submit all answers sends the complete
batch atomically; suggestions and custom answers stay local until then.
Ctrl+G switches between questions and direct messages without losing drafts.
In message mode or with no pending questions, Enter sends a message to your agent.
Ask about negotiations or give new instructions without answering the batch.
Tab/Shift+Tab cycles users, expanding collapsed chats, and includes visible A2A.
Ctrl+J adds a newline; mouse wheel or PgUp/PgDn scrolls history.
Ctrl+C stops all agents and exports each H2A conversation once, followed by A2A turns.
Rerun the command for a fresh lab with an edited user roster.
`;

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 1 && models[0] === '--help') { console.log(USAGE); return; }
  if (models.length > 3) throw new Error(USAGE);
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required.');
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
      model: new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY, models: models.length ? models : undefined }),
      evaluator: new TypeSafeIntentEvaluator(process.env.TYPESAFE_API_KEY),
    });
    mountNegotiationTui(renderer, lab);
    await lab.start();
    await closed;
  } finally {
    renderer.destroy();
    if (lab) {
      await lab.stop();
      const transcriptPath = join(mkdtempSync(join(tmpdir(), 'index-negotiation-')), 'transcript.md');
      writeFileSync(transcriptPath, lab.markdown(), { mode: 0o600 });
      console.log(`\nPrivate transcript saved: ${transcriptPath}`);
      if ([...lab.negotiations.values()].some((demo) => demo.phase === 'error')) process.exitCode = 1;
    }
  }
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
