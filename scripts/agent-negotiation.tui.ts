#!/usr/bin/env bun
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BoxRenderable, createCliRenderer, ScrollBoxRenderable, TextareaRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';

import { NegotiationDemo, parseScenario } from './agent-negotiation.demo';

const COLORS = { background: '#10151e', text: '#dce4ef', muted: '#8996aa', border: '#364255', focus: '#77b8ff', question: '#f4c773', answer: '#8dd9b7' };

interface Pane {
  box: BoxRenderable;
  history: ScrollBoxRenderable;
  input?: TextareaRenderable;
  hint?: TextRenderable;
  choices?: ScrollBoxRenderable;
  choiceRows: { box: BoxRenderable; label: TextRenderable; text: string }[];
  choiceIndex: number;
  editingReply: boolean;
  shownQuestion?: NegotiationDemo['pending'];
  ownerId?: string;
}

/**
 * Mount the two private human/agent panes around a read-only shared negotiation.
 * @param renderer - Owns terminal mouse, keyboard, and resize handling.
 * @param demo - The local scenario session. Only pending principal questions accept replies.
 */
export function mountNegotiationTui(renderer: CliRenderer, demo: NegotiationDemo): void {
  const root = new BoxRenderable(renderer, { id: 'negotiation-lab', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: COLORS.background });
  renderer.root.add(root);
  root.add(new TextRenderable(renderer, { content: ' NEGOTIATION LAB · real agents / local simulation', fg: COLORS.focus, height: 1, flexShrink: 0 }));
  const board = new BoxRenderable(renderer, { id: 'panes', flexDirection: 'row', flexGrow: 1, minHeight: 0, gap: 1 });
  root.add(board);
  const status = new TextRenderable(renderer, { id: 'session-status', content: demo.status, fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  const help = new TextRenderable(renderer, { content: ' Click/↑↓: select · Enter: confirm · Esc: choices · Tab: pane · Ctrl+J: newline · PgUp/PgDn/wheel: scroll · Ctrl+C: quit + save', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  root.add(status);
  root.add(help);

  const panes: Pane[] = [];
  let selected = 0;
  let displayed = 0;

  function append(history: ScrollBoxRenderable, label: string, text: string, color: string): void {
    const card = new BoxRenderable(renderer, { width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1 });
    card.add(new TextRenderable(renderer, { content: label, fg: color, wrapMode: 'word', flexShrink: 0 }));
    card.add(new TextRenderable(renderer, { content: text, fg: COLORS.text, wrapMode: 'word', flexShrink: 0 }));
    history.add(card);
  }

  function focusControl(pane: Pane): void {
    if (pane.choices?.visible && !pane.editingReply) pane.choices.focus();
    else if (pane.input) pane.input.focus();
    else pane.history.focus();
  }

  function focus(index: number): void {
    selected = index;
    render();
    focusControl(panes[index]);
  }

  for (let index = 0; index < 3; index++) {
    const principal = index === 1 ? undefined : demo.principals[index === 0 ? 0 : 1];
    const box = new BoxRenderable(renderer, {
      id: principal ? `pane-${principal.id}` : 'pane-a2a',
      flexDirection: 'column', flexGrow: principal ? 3 : 4, flexBasis: 0, minWidth: 0,
      border: true, borderStyle: 'rounded', borderColor: COLORS.border, paddingX: 1,
      onMouseDown: () => focus(index),
    });
    board.add(box);
    const history = new ScrollBoxRenderable(renderer, {
      id: principal ? `history-${principal.id}` : 'history-a2a',
      flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
      stickyScroll: true, stickyStart: 'bottom',
      contentOptions: { flexDirection: 'column' },
    });
    box.add(history);
    const pane: Pane = { box, history, ownerId: principal?.id, choiceRows: [], choiceIndex: 0, editingReply: true };
    panes.push(pane);
    if (principal) {
      append(history, 'Intent', principal.intent, COLORS.muted);
      append(history, 'Private instructions', principal.instructions, COLORS.muted);
      pane.hint = new TextRenderable(renderer, { content: 'Draft a reply; send only when asked.', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
      box.add(pane.hint);
      pane.choices = new ScrollBoxRenderable(renderer, {
        id: `choices-${principal.id}`, visible: false, height: 6, maxHeight: '30%', flexShrink: 0,
        scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
        onMouseDown: (event) => { event.stopPropagation(); pane.editingReply = false; focus(index); },
      });
      box.add(pane.choices);
      pane.input = new TextareaRenderable(renderer, {
        id: `reply-${principal.id}`, height: 5, flexShrink: 0, wrapMode: 'word',
        placeholder: `Custom reply as ${principal.name}…`, textColor: COLORS.text,
        backgroundColor: '#192230', focusedBackgroundColor: '#202e40', cursorColor: COLORS.focus,
        onMouseDown: (event) => {
          event.stopPropagation();
          pane.editingReply = true;
          pane.choiceIndex = pane.shownQuestion?.options?.length ?? 0;
          focus(index);
        },
        keyBindings: [
          { name: 'return', action: 'submit' },
          { name: 'return', shift: true, action: 'newline' },
          { name: 'j', ctrl: true, action: 'newline' },
        ],
        onSubmit: () => {
          if (demo.answer(principal.id, pane.input!.plainText)) {
            pane.input!.clear();
          } else {
            pane.hint!.content = demo.pending?.ownerId === principal.id ? 'Enter a nonempty answer.' : 'No pending question for this user. Draft kept.';
          }
        },
      });
      box.add(pane.input);
    } else {
      append(history, 'Shared agent-to-agent transcript', 'Agents choose their own turns. This pane is read-only; private questions and replies stay in the side panes.', COLORS.muted);
    }
  }

  function render(): void {
    if (renderer.isDestroyed) return;
    while (displayed < demo.transcript.length) {
      const entry = demo.transcript[displayed++];
      const principal = demo.principals.find(({ id }) => id === entry.ownerId)!;
      const pane = entry.channel === 'shared' ? panes[1] : panes.find(({ ownerId }) => ownerId === entry.ownerId)!;
      const label = entry.channel === 'shared'
        ? `${principal.name}'s agent · ${entry.action}`
        : entry.kind === 'answer' ? `${principal.name} (you)` : entry.kind === 'question' ? 'Your agent asks' : 'Your agent';
      append(pane.history, label, entry.text, entry.kind === 'question' ? COLORS.question : entry.kind === 'answer' ? COLORS.answer : COLORS.focus);
    }
    panes.forEach((pane, index) => {
      const principal = demo.principals.find(({ id }) => id === pane.ownerId);
      const question = principal && demo.pending?.ownerId === principal.id ? demo.pending : null;
      const pending = Boolean(question);
      if (pane.choices && pane.shownQuestion !== question) {
        pane.shownQuestion = question;
        for (const child of [...pane.choices.getChildren()]) {
          pane.choices.remove(child);
          child.destroyRecursively();
        }
        pane.choiceRows = [];
        const options = question?.options ?? [];
        const labels = question ? [...options, 'Custom reply…'] : [];
        pane.editingReply = options.length === 0 || Boolean(pane.input!.plainText);
        pane.choiceIndex = pane.editingReply ? options.length : 0;
        pane.choices.visible = Boolean(question);
        pane.choices.height = Math.min(8, labels.length * 3);
        labels.forEach((text, choiceIndex) => {
          const button = new BoxRenderable(renderer, {
            id: `option-${pane.ownerId}-${choiceIndex}`, width: '100%', flexShrink: 0,
            paddingX: 1, marginBottom: 1,
            onMouseDown: (event) => {
              event.stopPropagation();
              if (demo.pending !== question) return;
              pane.choiceIndex = choiceIndex;
              pane.editingReply = choiceIndex === options.length;
              focus(index);
            },
          });
          const label = new TextRenderable(renderer, { content: text, wrapMode: 'word', flexShrink: 0 });
          button.add(label);
          pane.choiceRows.push({ box: button, label, text });
          pane.choices!.add(button);
        });
        pane.choices.scrollTo(0);
        if (selected === index) focusControl(pane);
      }
      pane.choiceRows.forEach((row, choiceIndex) => {
        const highlighted = choiceIndex === pane.choiceIndex;
        row.box.backgroundColor = highlighted ? '#355073' : '#192230';
        row.label.fg = highlighted ? COLORS.text : COLORS.muted;
        row.label.content = `${highlighted ? '›' : ' '} ${row.text}`;
      });
      pane.box.title = principal ? ` H2A · ${principal.name}${pending ? ' · needs you' : ''} ` : ' A2A · negotiation ';
      pane.box.borderColor = selected === index ? COLORS.focus : pending ? COLORS.question : COLORS.border;
      pane.box.titleColor = pending ? COLORS.question : selected === index ? COLORS.focus : COLORS.muted;
      if (pane.hint) {
        pane.hint.content = pending
          ? pane.editingReply ? 'Enter sends · Esc returns to choices.' : '↑/↓ choose · Enter confirms.'
          : demo.phase === 'settled' ? 'Negotiation ended. Scroll to review.' : 'Draft a reply; send only when asked.';
        pane.hint.fg = pending ? COLORS.question : COLORS.muted;
      }
    });
    status.content = `${demo.status}${renderer.width < 100 ? ' · Widen terminal to 100+ columns for more space.' : ''}`;
    status.fg = demo.phase === 'error' ? '#f88a8a' : demo.pending ? COLORS.question : COLORS.muted;
  }

  const onKey = (key: KeyEvent) => {
    const pane = panes[selected];
    const question = demo.pending?.ownerId === pane.ownerId && pane.shownQuestion === demo.pending ? demo.pending : null;
    if (key.name === 'tab') {
      key.preventDefault();
      focus((selected + (key.shift ? 2 : 1)) % 3);
    } else if (question && key.name === 'escape' && pane.editingReply) {
      key.preventDefault();
      pane.editingReply = false;
      focus(selected);
    } else if (question && !pane.editingReply && (key.name === 'up' || key.name === 'down')) {
      key.preventDefault();
      pane.choiceIndex = Math.max(0, Math.min(pane.choiceRows.length - 1, pane.choiceIndex + (key.name === 'up' ? -1 : 1)));
      render();
      pane.choices!.scrollChildIntoView(`option-${pane.ownerId}-${pane.choiceIndex}`);
    } else if (question && !pane.editingReply && key.name === 'return' && !key.ctrl && !key.shift && !key.meta) {
      key.preventDefault();
      const option = question.options?.[pane.choiceIndex];
      if (option === undefined) {
        pane.editingReply = true;
      } else if (demo.answer(pane.ownerId!, option)) {
        pane.input!.clear();
      }
      focus(selected);
    } else if (key.name === 'pageup' || key.name === 'pagedown') {
      key.preventDefault();
      const history = panes[selected].history;
      history.scrollBy((key.name === 'pageup' ? -1 : 1) * Math.max(1, history.height - 2));
    }
  };
  renderer.keyInput.on('keypress', onKey);
  renderer.on('resize', render);
  demo.on('change', render);
  renderer.once('destroy', () => {
    demo.off('change', render);
    renderer.off('resize', render);
    renderer.keyInput.off('keypress', onKey);
  });
  focus(0);
}

const USAGE = `Usage: bun run agent:tui <scenario.json>

Requires OPENROUTER_API_KEY and an interactive terminal. Uses real agents and an
in-memory negotiation; no Index API keys, database, or server are used.

Scenario: { "left": { "name", "intent", "instructions" }, "right": { ... } }
Click either side to act as that user. Click or use Up/Down to highlight an
agent-provided option, then Enter to confirm. Select Custom reply or click the
text box to write your own answer. Esc returns from editing to the choices.
Tab cycles panes; Ctrl+J adds a newline; mouse wheel or PgUp/PgDn scrolls history.
Ctrl+C quits and saves a private Markdown transcript in a temporary directory.
Rerun the command to start a fresh negotiation with an edited scenario.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  if (args.length !== 1) throw new Error(USAGE);
  const scenario = parseScenario(await Bun.file(args[0]).json());
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run the TUI in an interactive terminal.');
  const demo = new NegotiationDemo(scenario);
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'index-negotiation-')), 'transcript.md');
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const renderer = await createCliRenderer({
    useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: 'disabled',
    backgroundColor: COLORS.background,
    onDestroy: () => { demo.stop(); close(); },
  });
  try {
    mountNegotiationTui(renderer, demo);
    const run = demo.run();
    await closed;
    await run;
  } finally {
    renderer.destroy();
    writeFileSync(transcriptPath, demo.markdown(), { mode: 0o600 });
    console.log(`\nPrivate transcript saved: ${transcriptPath}`);
    if (demo.phase === 'error') process.exitCode = 1;
  }
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
