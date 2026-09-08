#!/usr/bin/env bun
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModelClient } from '@indexnetwork/agent';
import { createCliRenderer } from '@opentui/core';

import { NegotiationLab, parseScenario } from './negotiation.lab';
import { COLORS, mountNegotiationTui } from './negotiation.tui';

const USAGE = `Usage: bun run agent:tui <scenario.json> [model-id ...]

Requires OPENROUTER_API_KEY and an interactive terminal. Uses real agents and
in-memory negotiations; no Index API keys, database, or server are used.
Optionally supply one to three ordered OpenRouter model IDs to replace the defaults.

Scenario: { "users": [{ "id", "name", "intent", "instructions" }, ...] }
Click the name above either side or press Ctrl+U to change that user. Select with
Up/Down + Enter or click a user. The opposite user is excluded. All distinct user
pairs are simulated matches and start in parallel on launch (66 with 12 users).
Each user has one H2A conversation and draft for their intent, across all matches.
The center shows the selected pair's A2A turns. Questions identify their match;
answering one resumes that match even while another pair is displayed.
H2A shows focused questions and meaningful outcomes, with routine A2A progress
kept in the center. Related requests can share an intent-wide question without
changing it while you answer; match-specific approvals remain separate.
Click either side to act as that user. Click or use Up/Down to highlight an
agent-provided option, then Enter to confirm. Select Custom reply or click the
text box to write your own answer. Esc returns from editing to the choices.
When no question is active, Enter sends the text to your personal agent instead.
Ask about your negotiations or give new instructions in the same H2A conversation.
Tab cycles panes; Ctrl+J adds a newline; mouse wheel or PgUp/PgDn scrolls history.
Ctrl+C stops all agents and exports each H2A conversation once, followed by A2A turns.
Rerun the command for a fresh lab with an edited user roster.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const [scenarioPath, ...models] = args;
  if (!scenarioPath || models.length > 3) throw new Error(USAGE);
  const scenario = parseScenario(await Bun.file(scenarioPath).json());
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run the TUI in an interactive terminal.');
  const lab = new NegotiationLab(scenario, {
    model: new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY, models: models.length ? models : undefined }),
  });
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'index-negotiation-')), 'transcript.md');
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const renderer = await createCliRenderer({
    useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: 'disabled',
    backgroundColor: COLORS.background,
    onDestroy: close,
  });
  try {
    mountNegotiationTui(renderer, lab);
    lab.matchAll();
    await closed;
  } finally {
    renderer.destroy();
    await lab.stop();
    writeFileSync(transcriptPath, lab.markdown(), { mode: 0o600 });
    console.log(`\nPrivate transcript saved: ${transcriptPath}`);
    if ([...lab.negotiations.values()].some((demo) => demo.phase === 'error')) process.exitCode = 1;
  }
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
