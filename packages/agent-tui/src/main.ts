#!/usr/bin/env bun
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModelClient } from '@indexnetwork/agent';
import { createCliRenderer } from '@opentui/core';

import { NegotiationLab, parseScenario } from './negotiation.lab';
import { COLORS, mountNegotiationTui } from './negotiation.tui';
import { chooseScenario } from './scenario.chooser';

const USAGE = `Usage: bun run agent:tui [model-id ...]

Requires OPENROUTER_API_KEY and an interactive terminal. Uses real agents and
in-memory negotiations; no Index API keys, database, or server are used.
Optionally supply one to three ordered OpenRouter model IDs to replace the defaults.
Choose a JSON scenario from packages/agent-tui/scenarios with Up/Down + Enter or
click it. Esc or Ctrl+C exits the chooser. Agents start only after selection.

Scenario users have id, name, instructions, and intents: [{ id, intent }, ...].
The default has 12 users with two intents each: 24 personal agents and 264 matches
between different users' intents, running independently in the background.
Each user starts on the board with their first intent. Users/Ctrl+U opens the
roster: Space/click toggles users, Enter applies, Esc cancels. Keep at least two.
Click an intent header or press Ctrl+T to switch that user's intent with Up/Down
and Enter, or a click. Esc cancels. Each user-intent pair retains its own agent,
H2A history, scroll position, draft, pending questions, choices, and in-flight sends.
Header [−]/Ctrl+O collapses a chat; at least one stays expanded. Overflow collapses
from the end of roster order, preserving focus and targeting 40 columns per chat.
Click a collapsed user to expand them. Widening restores automatic collapses;
manual collapses stay until selected. The scrollable list shows pending questions.
A2A appears between exactly two expanded users, even with other users collapsed.
The chats share space with A2A at narrower widths. Ctrl+N cycles the expanded
users' selected intents' matches. Other expanded counts hide A2A. All agents keep
running.
Related requests can share an intent-wide question without changing it while you
answer; match-specific approvals remain separate.
Click a chat to act as that user. Click or use Up/Down to highlight an
agent-provided option, then Enter to confirm. Select Custom reply or click the
text box to write your own answer. Esc returns from editing to the choices.
When no question is active, Enter sends the text to your personal agent instead.
Ask about your negotiations or give new instructions in the same H2A conversation.
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
    });
    mountNegotiationTui(renderer, lab);
    lab.matchAll();
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
