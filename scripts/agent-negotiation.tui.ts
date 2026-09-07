#!/usr/bin/env bun
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrincipalQuestion } from '@indexnetwork/agent';
import { BoxRenderable, createCliRenderer, ScrollBoxRenderable, TextareaRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';

import { NegotiationLab, parseScenario } from './agent-negotiation.demo';

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
  shownQuestion?: PrincipalQuestion | null;
  displayed: number;
  opportunityId?: string;
  ownerId?: string;
  selector?: TextRenderable;
  users?: ScrollBoxRenderable;
  userRows: { box: BoxRenderable; label: TextRenderable; ownerId: string; name: string }[];
  userIndex: number;
}

/**
 * Mount the two private human/agent panes around a read-only shared negotiation.
 * @param renderer - Owns terminal mouse, keyboard, and resize handling.
 * @param lab - The user/intent conversations and separate match records.
 */
export function mountNegotiationTui(renderer: CliRenderer, lab: NegotiationLab): void {
  let demo = lab.active;
  const root = new BoxRenderable(renderer, { id: 'negotiation-lab', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: COLORS.background });
  renderer.root.add(root);
  root.add(new TextRenderable(renderer, { content: ` NEGOTIATION LAB · ${lab.users.length} users · real agents / local simulation`, fg: COLORS.focus, height: 1, flexShrink: 0 }));
  const board = new BoxRenderable(renderer, { id: 'panes', flexDirection: 'row', flexGrow: 1, minHeight: 0, gap: 1 });
  root.add(board);
  const status = new TextRenderable(renderer, { id: 'session-status', content: demo.status, fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  const help = new TextRenderable(renderer, { content: ' Click name/Ctrl+U: change user · ↑↓: select · Enter: confirm · Esc: back · Tab: pane · Ctrl+J: newline · PgUp/PgDn/wheel: scroll · Ctrl+C: quit + save all pairs', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  root.add(status);
  root.add(help);

  const panes: Pane[] = [];
  let selected = 0;
  const drafts = new Map<string, string>();

  function append(history: ScrollBoxRenderable, label: string, text: string, color: string): void {
    const card = new BoxRenderable(renderer, { width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1 });
    card.add(new TextRenderable(renderer, { content: label, fg: color, wrapMode: 'word', flexShrink: 0 }));
    card.add(new TextRenderable(renderer, { content: text, fg: COLORS.text, wrapMode: 'word', flexShrink: 0 }));
    history.add(card);
  }

  function focusControl(pane: Pane): void {
    if (pane.users?.visible) pane.users.focus();
    else if (pane.choices?.visible && !pane.editingReply) pane.choices.focus();
    else if (pane.input) pane.input.focus();
    else pane.history.focus();
  }

  function focus(index: number): void {
    selected = index;
    panes.forEach((pane, paneIndex) => { if (pane.users && paneIndex !== index) pane.users.visible = false; });
    render();
    focusControl(panes[index]);
  }

  function clear(history: ScrollBoxRenderable): void {
    for (const child of [...history.getChildren()]) {
      history.remove(child);
      child.destroyRecursively();
    }
  }

  function chooseUser(index: number, ownerId: string): void {
    panes[index].users!.visible = false;
    lab.selectUser(index === 0 ? 'left' : 'right', ownerId);
    focus(index);
  }

  function toggleUsers(index: number): void {
    const pane = panes[index];
    if (!pane.users) return;
    pane.users.visible = !pane.users.visible;
    if (pane.users.visible) {
      clear(pane.users);
      pane.userRows = [];
      const opposite = lab.selectedUsers[index === 0 ? 1 : 0];
      lab.users.filter(({ id }) => id !== opposite.id).forEach((user, userIndex) => {
        const button = new BoxRenderable(renderer, {
          id: `user-${index}-${userIndex}`, width: '100%', height: 1, flexShrink: 0,
          onMouseDown: (event) => { event.stopPropagation(); chooseUser(index, user.id); },
        });
        const label = new TextRenderable(renderer, { content: user.name, height: 1 });
        button.add(label);
        pane.userRows.push({ box: button, label, ownerId: user.id, name: user.name });
        pane.users!.add(button);
      });
      pane.userIndex = pane.userRows.findIndex(({ ownerId }) => ownerId === pane.ownerId);
      pane.users.scrollTo(0);
    }
    focus(index);
    if (pane.users.visible) pane.users.scrollChildIntoView(`user-${index}-${pane.userIndex}`);
  }

  for (let index = 0; index < 3; index++) {
    const principal = index === 1 ? undefined : lab.selectedUsers[index === 0 ? 0 : 1];
    const box = new BoxRenderable(renderer, {
      id: `pane-${index}`,
      flexDirection: 'column', flexGrow: principal ? 3 : 4, flexBasis: 0, minWidth: 0,
      border: true, borderStyle: 'rounded', borderColor: COLORS.border, paddingX: 1,
      onMouseDown: () => focus(index),
    });
    board.add(box);
    const history = new ScrollBoxRenderable(renderer, {
      id: `history-${index}`,
      flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
      stickyScroll: true, stickyStart: 'bottom',
      contentOptions: { flexDirection: 'column' },
    });
    const pane: Pane = { box, history, displayed: 0, choiceRows: [], choiceIndex: 0, editingReply: true, userRows: [], userIndex: 0 };
    panes.push(pane);
    if (principal) {
      pane.selector = new TextRenderable(renderer, {
        id: `select-user-${index}`, height: 1, flexShrink: 0, fg: COLORS.focus,
        onMouseDown: (event) => { event.stopPropagation(); toggleUsers(index); },
      });
      box.add(pane.selector);
      pane.users = new ScrollBoxRenderable(renderer, {
        id: `users-${index}`, visible: false, height: 11, maxHeight: '40%', flexShrink: 0,
        scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
        onMouseDown: (event) => { event.stopPropagation(); focus(index); },
      });
      box.add(pane.users);
      box.add(history);
      pane.hint = new TextRenderable(renderer, { content: 'Enter sends a message to your agent.', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
      box.add(pane.hint);
      pane.choices = new ScrollBoxRenderable(renderer, {
        id: `choices-${index}`, visible: false, height: 6, maxHeight: '30%', flexShrink: 0,
        scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
        onMouseDown: (event) => { event.stopPropagation(); pane.users!.visible = false; pane.editingReply = false; focus(index); },
      });
      box.add(pane.choices);
      pane.input = new TextareaRenderable(renderer, {
        id: `reply-${index}`, height: 5, flexShrink: 0, wrapMode: 'word',
        placeholder: `Message your agent as ${principal.name}…`, textColor: COLORS.text,
        backgroundColor: '#192230', focusedBackgroundColor: '#202e40', cursorColor: COLORS.focus,
        onMouseDown: (event) => {
          event.stopPropagation();
          pane.users!.visible = false;
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
          const agent = lab.agents.get(pane.ownerId!)!;
          const sent = pane.shownQuestion
            ? agent.answer(pane.shownQuestion.id, pane.input!.plainText)
            : agent.message(pane.input!.plainText);
          if (sent) {
            pane.input!.clear();
          } else {
            pane.hint!.content = pane.input!.plainText.trim() ? 'Could not send. Draft kept.' : 'Enter a message or answer.';
          }
        },
      });
      box.add(pane.input);
    } else {
      box.add(history);
    }
  }

  function render(): void {
    if (renderer.isDestroyed) return;
    for (const pane of panes) if (pane.ownerId) drafts.set(pane.ownerId, pane.input!.plainText);
    demo = lab.active;
    panes.forEach((pane, index) => {
      const principal = index === 1 ? undefined : lab.selectedUsers[index === 0 ? 0 : 1];
      if (principal && pane.ownerId !== principal.id) {
        clear(pane.history);
        pane.displayed = 0;
        pane.ownerId = principal.id;
        pane.shownQuestion = undefined;
        pane.users!.visible = false;
        pane.input!.setText(drafts.get(principal.id) ?? '');
        pane.selector!.content = ' ' + principal.name + ' ▾ · ' + (lab.users.findIndex(({ id }) => id === principal.id) + 1) + '/' + lab.users.length;
        append(pane.history, 'Intent', principal.intent, COLORS.muted);
        append(pane.history, 'Private instructions', principal.instructions, COLORS.muted);
      } else if (!principal && pane.opportunityId !== demo.opportunityId) {
        clear(pane.history);
        pane.displayed = 0;
        pane.opportunityId = demo.opportunityId;
        append(pane.history, lab.selectedUsers.map(({ name }) => name).join(' ↔ '), 'Shared agent turns for this match.', COLORS.muted);
      }
      const agent = principal ? lab.agents.get(principal.id)! : undefined;
      if (agent) {
        while (pane.displayed < agent.conversation.length) {
          const entry = agent.conversation[pane.displayed++];
          const human = entry.kind === 'answer' || entry.kind === 'user';
          const who = human ? principal!.name + ' (you)' : entry.kind === 'question' ? 'Your agent asks' : 'Your agent';
          const text = entry.text + (entry.options ? '\n\n' + entry.options.map((option) => '• ' + option).join('\n') : '');
          const about = entry.scope === 'intent' ? 'This intent' : entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ');
          append(pane.history, who + (about ? ' · ' + about : ''), text,
            entry.kind === 'question' ? COLORS.question : human ? COLORS.answer : COLORS.focus);
        }
      } else {
        while (pane.displayed < demo.transcript.length) {
          const entry = demo.transcript[pane.displayed++];
          const name = demo.principals.find(({ id }) => id === entry.ownerId)!.name;
          append(pane.history, name + "'s agent · " + entry.action, entry.text, COLORS.focus);
        }
      }
      const question = agent?.pending ?? null;
      const pending = Boolean(question);
      if (pane.choices && pane.shownQuestion !== question) {
        pane.shownQuestion = question;
        pane.input!.placeholder = (question ? 'Custom reply as ' : 'Message your agent as ') + principal!.name + '…';
        clear(pane.choices);
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
              if (agent?.pending !== question) return;
              pane.users!.visible = false;
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
      pane.userRows.forEach((row, userIndex) => {
        const highlighted = userIndex === pane.userIndex;
        row.box.backgroundColor = highlighted ? '#355073' : '#192230';
        row.label.fg = highlighted ? COLORS.text : COLORS.muted;
        row.label.content = `${highlighted ? '›' : ' '} ${row.name}${row.ownerId === pane.ownerId ? ' · active' : ''}`;
      });
      pane.box.title = principal ? ` H2A · ${principal.name}${pending ? ' · needs you' : ''} ` : ` A2A · ${lab.selectedUsers.map(({ name }) => name).join(' ↔ ')} `;
      pane.box.borderColor = selected === index ? COLORS.focus : pending ? COLORS.question : COLORS.border;
      pane.box.titleColor = pending ? COLORS.question : selected === index ? COLORS.focus : COLORS.muted;
      if (pane.hint) {
        let hint = pane.users?.visible ? 'Click a user or ↑/↓ + Enter · Esc cancels.' : pending
          ? pane.editingReply ? 'Enter sends · Esc returns to choices.' : '↑/↓ choose · Enter confirms.'
          : 'Enter sends a message to your agent.';
        if (question) hint = (question.scope === 'intent' ? 'For this intent' : 'About ' + question.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ')) + ' · ' + hint;
        if (agent?.queuedQuestions) hint += ' · ' + agent.queuedQuestions + ' queued';
        pane.hint.content = hint;
        pane.hint.fg = pending ? COLORS.question : COLORS.muted;
      }
    });
    const waiting = [...lab.agents.values()].filter((agent) => agent.pending).length;
    status.content = demo.status + ' · H2A: ' + lab.agents.size + ' · A2A: ' + lab.negotiations.size
      + (waiting ? ' · Principals awaiting answers: ' + waiting : '')
      + (lab.agentStatus ? ' · ' + lab.agentStatus : '')
      + (renderer.width < 100 ? ' · Widen terminal to 100+ columns for more space.' : '');
    status.fg = demo.phase === 'error' ? '#f88a8a' : waiting ? COLORS.question : COLORS.muted;
  }

  const onKey = (key: KeyEvent) => {
    const pane = panes[selected];
    const agent = pane.ownerId ? lab.agents.get(pane.ownerId) : undefined;
    const question = pane.shownQuestion === agent?.pending ? agent?.pending : null;
    if (key.name === 'tab') {
      key.preventDefault();
      focus((selected + (key.shift ? 2 : 1)) % 3);
    } else if (key.name === 'u' && key.ctrl) {
      key.preventDefault();
      toggleUsers(selected);
    } else if (pane.users?.visible && key.name === 'escape') {
      key.preventDefault();
      toggleUsers(selected);
    } else if (pane.users?.visible && (key.name === 'up' || key.name === 'down')) {
      key.preventDefault();
      pane.userIndex = Math.max(0, Math.min(pane.userRows.length - 1, pane.userIndex + (key.name === 'up' ? -1 : 1)));
      render();
      pane.users.scrollChildIntoView(`user-${selected}-${pane.userIndex}`);
    } else if (pane.users?.visible && key.name === 'return' && !key.ctrl && !key.shift && !key.meta) {
      key.preventDefault();
      chooseUser(selected, pane.userRows[pane.userIndex].ownerId);
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
      } else if (agent!.answer(question.id, option)) {
        pane.input!.clear();
      }
      focus(selected);
    } else if (key.name === 'pageup' || key.name === 'pagedown') {
      key.preventDefault();
      const history = pane.users?.visible ? pane.users : pane.history;
      history.scrollBy((key.name === 'pageup' ? -1 : 1) * Math.max(1, history.height - 2));
    }
  };
  renderer.keyInput.on('keypress', onKey);
  renderer.on('resize', render);
  lab.on('change', render);
  renderer.once('destroy', () => {
    lab.off('change', render);
    renderer.off('resize', render);
    renderer.keyInput.off('keypress', onKey);
  });
  focus(0);
}

const USAGE = `Usage: bun run agent:tui <scenario.json>

Requires OPENROUTER_API_KEY and an interactive terminal. Uses real agents and
in-memory negotiations; no Index API keys, database, or server are used.

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
  if (args.length !== 1) throw new Error(USAGE);
  const scenario = parseScenario(await Bun.file(args[0]).json());
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run the TUI in an interactive terminal.');
  const lab = new NegotiationLab(scenario);
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
