import type { NegotiationAgent, PrincipalQuestion, NegotiationAction } from '@indexnetwork/agent';
import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';

/** An independently selectable principal/intent conversation. */
export interface TuiPrincipal {
  id: string;
  userId: string;
  name: string;
  intentId: string;
  intent: string;
  principalContext: string;
}
export interface TuiNegotiation {
  opportunityId: string;
  principals: readonly [TuiPrincipal, TuiPrincipal];
  transcript: readonly { ownerId: string; text: string; action: NegotiationAction }[];
  phase: string;
  status: string;
}
/** The view consumes agent conversations and host observations without orchestrating either. */
export interface NegotiationTuiHost {
  title: string;
  users: readonly TuiPrincipal[];
  agents: ReadonlyMap<string, Pick<NegotiationAgent, 'conversation' | 'pending' | 'queuedQuestions' | 'message' | 'answer'>>;
  negotiations: ReadonlyMap<string, TuiNegotiation>;
  agentStatus: string;
  on(event: 'change', listener: () => void): unknown;
  off(event: 'change', listener: () => void): unknown;
}

export const COLORS = { background: '#10151e', text: '#dce4ef', muted: '#8996aa', border: '#364255', focus: '#77b8ff', question: '#f4c773', answer: '#8dd9b7' };

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
  sending?: boolean;
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
export function mountNegotiationTui(renderer: CliRenderer, lab: NegotiationTuiHost): void {
  const selectedUsers: [TuiPrincipal, TuiPrincipal] = [lab.users[0], lab.users.find((user) => user.userId !== lab.users[0].userId)!];
  let matchIndex = 0;
  let pairKey = '';
  let demo: TuiNegotiation | undefined;
  const matches = () => [...lab.negotiations.values()].filter((match) => selectedUsers.every((user) => match.principals.some(({ id }) => id === user.id)));
  const root = new BoxRenderable(renderer, { id: 'negotiation-lab', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: COLORS.background });
  renderer.root.add(root);
  root.add(new TextRenderable(renderer, { content: ` ${lab.title} · ${lab.users.length} principal/intent sessions`, fg: COLORS.focus, height: 1, flexShrink: 0 }));
  const board = new BoxRenderable(renderer, { id: 'panes', flexDirection: 'row', flexGrow: 1, minHeight: 0, gap: 1 });
  root.add(board);
  const status = new TextRenderable(renderer, { id: 'session-status', content: '', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  const help = new TextRenderable(renderer, { content: ' Click name/Ctrl+U: change user · ↑↓: select · Enter: confirm · Esc: back · Tab: pane · Ctrl+J: newline · PgUp/PgDn/wheel: scroll · Ctrl+N: next match · Ctrl+C: quit', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
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
    selectedUsers[index === 0 ? 0 : 1] = lab.users.find(({ id }) => id === ownerId)!;
    focus(index);
  }

  function toggleUsers(index: number): void {
    const pane = panes[index];
    if (!pane.users) return;
    pane.users.visible = !pane.users.visible;
    if (pane.users.visible) {
      clear(pane.users);
      pane.userRows = [];
      const opposite = selectedUsers[index === 0 ? 1 : 0];
      lab.users.filter(({ userId }) => userId !== opposite.userId).forEach((user, userIndex) => {
        const button = new BoxRenderable(renderer, {
          id: `user-${index}-${userIndex}`, width: '100%', height: 1, flexShrink: 0,
          onMouseDown: (event) => { event.stopPropagation(); chooseUser(index, user.id); },
        });
        const label = new TextRenderable(renderer, { content: user.name + " · " + user.intent, height: 1 });
        button.add(label);
        pane.userRows.push({ box: button, label, ownerId: user.id, name: user.name + " · " + user.intent });
        pane.users!.add(button);
      });
      pane.userIndex = pane.userRows.findIndex(({ ownerId }) => ownerId === pane.ownerId);
      pane.users.scrollTo(0);
    }
    focus(index);
    if (pane.users.visible) pane.users.scrollChildIntoView(`user-${index}-${pane.userIndex}`);
  }

  for (let index = 0; index < 3; index++) {
    const principal = index === 1 ? undefined : selectedUsers[index === 0 ? 0 : 1];
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
        onSubmit: () => { void send(pane, pane.input!.plainText); },
      });
      box.add(pane.input);
    } else {
      box.add(history);
    }
  }

  async function send(pane: Pane, text: string): Promise<void> {
    if (pane.sending) return;
    const ownerId = pane.ownerId!;
    const agent = lab.agents.get(ownerId)!;
    const question = pane.shownQuestion;
    const draft = pane.input!.plainText;
    pane.sending = true;
    try {
      const sent = question ? await agent.answer(question.id, text) : await agent.message(text);
      if (sent) {
        drafts.delete(ownerId);
        if (pane.ownerId === ownerId && pane.input!.plainText === draft) pane.input!.clear();
      } else if (pane.ownerId === ownerId) pane.hint!.content = 'Could not send. Draft kept.';
    } catch (error) {
      if (!renderer.isDestroyed) pane.hint!.content = 'Could not save: ' + (error instanceof Error ? error.message : String(error));
    } finally { pane.sending = false; }
  }

  function render(): void {
    if (renderer.isDestroyed) return;
    for (const pane of panes) if (pane.ownerId) drafts.set(pane.ownerId, pane.input!.plainText);
    const key = selectedUsers.map(({ id }) => id).join('\0');
    if (key !== pairKey) { pairKey = key; matchIndex = 0; }
    const available = matches();
    matchIndex = Math.min(matchIndex, Math.max(0, available.length - 1));
    demo = available[matchIndex];
    panes.forEach((pane, index) => {
      const principal = index === 1 ? undefined : selectedUsers[index === 0 ? 0 : 1];
      if (principal && pane.ownerId !== principal.id) {
        clear(pane.history);
        pane.displayed = 0;
        pane.ownerId = principal.id;
        pane.shownQuestion = undefined;
        pane.users!.visible = false;
        pane.input!.setText(drafts.get(principal.id) ?? '');
        pane.selector!.content = ' ' + principal.name + ' ▾ · ' + (lab.users.findIndex(({ id }) => id === principal.id) + 1) + '/' + lab.users.length;
        append(pane.history, 'Intent', principal.intent, COLORS.muted);
        append(pane.history, 'Principal context', principal.principalContext, COLORS.muted);
      } else if (!principal && pane.opportunityId !== (demo?.opportunityId ?? pairKey)) {
        clear(pane.history);
        pane.displayed = 0;
        pane.opportunityId = demo?.opportunityId ?? pairKey;
        append(pane.history, selectedUsers.map(({ name }) => name).join(' ↔ '), demo ? `Match ${matchIndex + 1}/${available.length} · ${demo.opportunityId} · Ctrl+N changes match.` : 'No negotiation between these selected intents.', COLORS.muted);
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
        while (demo && pane.displayed < demo.transcript.length) {
          const entry = demo.transcript[pane.displayed++];
          const name = demo.principals.find(({ userId }) => userId === entry.ownerId)!.name;
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
      pane.box.title = principal ? ` H2A · ${principal.name}${pending ? ' · needs you' : ''} ` : ` A2A · ${selectedUsers.map(({ name }) => name).join(' ↔ ')} `;
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
    status.content = (demo?.status ?? 'No match selected') + ' · H2A: ' + lab.agents.size + ' · A2A: ' + lab.negotiations.size
      + (waiting ? ' · Principals awaiting answers: ' + waiting : '')
      + (lab.agentStatus ? ' · ' + lab.agentStatus : '')
      + (renderer.width < 100 ? ' · Widen terminal to 100+ columns for more space.' : '');
    status.fg = demo?.phase === 'error' ? '#f88a8a' : waiting ? COLORS.question : COLORS.muted;
  }

  const onKey = (key: KeyEvent) => {
    const pane = panes[selected];
    const agent = pane.ownerId ? lab.agents.get(pane.ownerId) : undefined;
    const question = pane.shownQuestion === agent?.pending ? agent?.pending : null;
    if (key.name === 'tab') {
      key.preventDefault();
      focus((selected + (key.shift ? 2 : 1)) % 3);
    } else if (key.name === 'n' && key.ctrl) {
      key.preventDefault();
      matchIndex = (matchIndex + 1) % Math.max(1, matches().length);
      render();
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
      } else { void send(pane, option); }
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
