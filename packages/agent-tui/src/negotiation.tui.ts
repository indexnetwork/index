import type { NegotiationAgent, PrincipalQuestion, NegotiationAction } from '@indexnetwork/agent';
import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, fg, t, type CliRenderer, type KeyEvent } from '@opentui/core';

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

interface BoardUser {
  id: string;
  name: string;
  intents: TuiPrincipal[];
  current: TuiPrincipal;
}

interface SessionPane {
  principal: TuiPrincipal;
  box: BoxRenderable;
  history: ScrollBoxRenderable;
  input: TextareaRenderable;
  hint: TextRenderable;
  choices: ScrollBoxRenderable;
  collapse: TextRenderable;
  choiceRows: { box: BoxRenderable; label: TextRenderable; text: string }[];
  choiceIndex: number;
  editingReply: boolean;
  shownQuestion?: PrincipalQuestion | null;
  displayed: number;
  sending: boolean;
  sendError?: string;
}

/**
 * Mount one human/agent pane per user, retaining each intent session independently.
 * @param renderer - Owns terminal mouse, keyboard, and resize handling.
 * @param lab - The user/intent conversations and separate match records.
 */
export function mountNegotiationTui(renderer: CliRenderer, lab: NegotiationTuiHost): void {
  const users: BoardUser[] = [];
  for (const principal of lab.users) {
    const user = users.find(({ id }) => id === principal.userId);
    if (user) user.intents.push(principal);
    else users.push({ id: principal.userId, name: principal.name, intents: [principal], current: principal });
  }
  let roster = [...users];
  // Each retained session owns selection listeners for its history, choices, and editor.
  renderer.setMaxListeners(Math.max(renderer.getMaxListeners(), lab.users.length * 3 + 10));
  const panes = new Map<string, SessionPane>();
  const manuallyCollapsed = new Set<string>();
  let expanded: BoardUser[] = [];
  let selected: string | null = roster[0].id;
  let lastSession = selected;
  let matchIndex = 0;
  let pairKey = '';
  let opportunityId = '';
  let displayedTurns = 0;
  const matches = () => [...lab.negotiations.values()].filter((match) => expanded.every((user) => match.principals.some(({ id }) => id === user.current.id)));
  const root = new BoxRenderable(renderer, { id: 'negotiation-lab', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: COLORS.background });
  renderer.root.add(root);
  const header = new BoxRenderable(renderer, { height: 1, flexShrink: 0, flexDirection: 'row' });
  header.add(new TextRenderable(renderer, { content: ` ${lab.title} · ${users.length} users · ${lab.users.length} intent sessions`, fg: COLORS.focus, flexGrow: 1, flexBasis: 0, minWidth: 0, height: 1, truncate: true }));
  header.add(new TextRenderable(renderer, {
    id: 'board-users', content: '[ Users ]', fg: COLORS.focus, width: 9, height: 1,
    onMouseDown: (event) => { event.stopPropagation(); openSelector(); },
  }));
  root.add(header);
  const board = new BoxRenderable(renderer, { id: 'panes', flexDirection: 'row', flexGrow: 1, minHeight: 0, gap: 1 });
  root.add(board);
  const status = new TextRenderable(renderer, { id: 'session-status', fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  const help = new TextRenderable(renderer, { fg: COLORS.muted, height: 3, flexShrink: 0, wrapMode: 'word' });
  root.add(status);
  root.add(help);

  const a2a = new BoxRenderable(renderer, {
    id: 'pane-a2a', visible: false, flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0,
    border: true, borderStyle: 'rounded', borderColor: COLORS.border, paddingX: 1,
    onMouseDown: () => focus(null),
  });
  const sharedHistory = new ScrollBoxRenderable(renderer, {
    id: 'history-a2a', flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
    stickyScroll: true, stickyStart: 'bottom', contentOptions: { flexDirection: 'column' },
  });
  a2a.add(sharedHistory);
  board.add(a2a);
  const collapsed = new ScrollBoxRenderable(renderer, {
    id: 'collapsed-chats', visible: false, width: 24, flexShrink: 0, scrollX: false, scrollY: true,
    border: true, borderColor: COLORS.border, title: ' Collapsed ', contentOptions: { flexDirection: 'column' },
  });

  const selector = new BoxRenderable(renderer, {
    id: 'board-selector', visible: false, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1,
    flexDirection: 'column', border: true, borderColor: COLORS.focus, padding: 1, backgroundColor: COLORS.background,
  });
  const selectorTitle = new TextRenderable(renderer, { fg: COLORS.focus, height: 1 });
  const selectorHint = new TextRenderable(renderer, { fg: COLORS.muted, height: 2, flexShrink: 0, wrapMode: 'word' });
  selector.add(selectorTitle);
  selector.add(selectorHint);
  const selectorList = new ScrollBoxRenderable(renderer, {
    id: 'board-selector-list', flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
  });
  selector.add(selectorList);
  root.add(selector);
  let intentUser: BoardUser | undefined;
  let chosen = new Set<string>();
  let selectorIndex = 0;
  let selectorRows: TextRenderable[] = [];
  const selectorEntries = () => intentUser ? intentUser.intents : users;

  function renderSelector(): void {
    selectorRows.forEach((row, index) => {
      const entry = selectorEntries()[index];
      const principal = intentUser ? intentUser.intents[index] : users[index].current;
      const pending = lab.agents.get(principal.id)!.pending;
      row.content = `${index === selectorIndex ? '›' : ' '} ${intentUser ? (principal.id === intentUser.current.id ? '[x]' : '[ ]') : (chosen.has(entry.id) ? '[x]' : '[ ]')} ${intentUser ? principal.intent : entry.name + ' · ' + principal.intent}${pending ? ' · needs you' : ''}`;
      row.fg = index === selectorIndex ? COLORS.focus : pending ? COLORS.question : COLORS.text;
    });
  }

  function openSelector(user?: BoardUser): void {
    intentUser = user;
    chosen = new Set(roster.map(({ id }) => id));
    selectorIndex = user ? user.intents.indexOf(user.current) : users.findIndex(({ id }) => id === lastSession);
    selectorTitle.content = user ? `Choose an intent for ${user.name}` : 'Choose users on the board';
    selectorHint.content = user ? '↑↓ moves · Enter/click selects · Esc cancels. Every intent agent keeps running.'
      : 'Space/click toggles · ↑↓ moves · Enter applies · Esc cancels. Agents keep running.';
    clear(selectorList);
    selectorRows = selectorEntries().map((entry, index) => {
      const row = new TextRenderable(renderer, {
        id: `selector-${entry.id}`, height: 2, flexShrink: 0, wrapMode: 'word',
        onMouseDown: (event) => { event.stopPropagation(); selectorIndex = index; if (intentUser) closeSelector(true); else toggleRosterEntry(); },
      });
      selectorList.add(row);
      return row;
    });
    selector.visible = true;
    renderSelector();
    selectorList.scrollTo(0);
    selectorList.scrollChildIntoView(`selector-${selectorEntries()[selectorIndex].id}`);
    selectorList.focus();
  }

  function toggleRosterEntry(): void {
    const id = users[selectorIndex].id;
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    renderSelector();
  }

  function closeSelector(apply: boolean): void {
    if (apply && intentUser) intentUser.current = intentUser.intents[selectorIndex];
    else if (apply) {
      const next = users.filter(({ id }) => chosen.has(id));
      if (next.length < 2) {
        selectorHint.content = 'Select at least two users. Space/click toggles; Enter applies.';
        return;
      }
      roster = next;
      if (roster.every(({ id }) => manuallyCollapsed.has(id))) manuallyCollapsed.delete(roster[0].id);
    }
    selector.visible = false;
    render();
  }

  function append(history: ScrollBoxRenderable, label: string, text: string, color: string): void {
    const card = new BoxRenderable(renderer, { width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1 });
    card.add(new TextRenderable(renderer, { content: label, fg: color, wrapMode: 'word', flexShrink: 0 }));
    card.add(new TextRenderable(renderer, { content: text, fg: COLORS.text, wrapMode: 'word', flexShrink: 0 }));
    history.add(card);
  }

  function clear(history: ScrollBoxRenderable): void {
    for (const child of [...history.getChildren()]) {
      history.remove(child);
      child.destroyRecursively();
    }
  }

  function focus(id: string | null): void {
    if (selector.visible) return;
    selected = id;
    if (id !== null) { lastSession = id; manuallyCollapsed.delete(id); }
    render();
  }

  function collapse(id: string): void {
    if (expanded.length < 2) return;
    manuallyCollapsed.add(id);
    render();
  }

  function layout(): void {
    expanded = roster.filter(({ id }) => !manuallyCollapsed.has(id));
    if (!expanded.some(({ id }) => id === lastSession)) lastSession = expanded[0].id;
    if (selected !== null) selected = lastSession;
    // Reserve the list as soon as any session is collapsed. Keep the focused chat.
    while (expanded.length > 1) {
      const listWidth = expanded.length < roster.length ? 25 : 0;
      if (expanded.length * 40 + expanded.length - 1 + listWidth <= renderer.width) break;
      let index = expanded.length - 1;
      if (expanded[index].id === lastSession) index--;
      expanded.splice(index, 1);
    }
    a2a.visible = expanded.length === 2;
    if (selected === null && !a2a.visible) selected = lastSession;
    if (a2a.visible) {
      const right = panes.get(expanded[1].current.id)!.box;
      const children = board.getChildren();
      if (children.indexOf(a2a) + 1 !== children.indexOf(right)) board.insertBefore(a2a, right);
    }
    collapsed.visible = expanded.length < roster.length;
    for (const [id, pane] of panes) {
      pane.box.visible = expanded.some((user) => user.current.id === id);
      pane.collapse.fg = expanded.length > 1 ? COLORS.focus : COLORS.muted;
    }
  }

  for (const user of users) for (const principal of user.intents) {
    const id = principal.id;
    const box = new BoxRenderable(renderer, {
      id: `pane-${id}`, visible: false, flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0,
      border: true, borderStyle: 'rounded', borderColor: COLORS.border, paddingX: 1,
      onMouseDown: () => focus(user.id),
    });
    board.add(box);
    const collapseButton = new TextRenderable(renderer, {
      id: `collapse-${id}`, content: '[−]', width: 3, height: 1, flexShrink: 0, fg: COLORS.focus,
      onMouseDown: (event) => { event.stopPropagation(); collapse(user.id); },
    });
    const paneHeader = new BoxRenderable(renderer, { height: 1, flexShrink: 0, flexDirection: 'row', gap: 1 });
    paneHeader.add(new TextRenderable(renderer, {
      id: `intent-${id}`, content: `Intent ▾ ${principal.intent}`, height: 1, flexGrow: 1, flexBasis: 0, minWidth: 0, truncate: true, fg: COLORS.focus,
      onMouseDown: (event) => { event.stopPropagation(); focus(user.id); openSelector(user); },
    }));
    paneHeader.add(collapseButton);
    box.add(paneHeader);
    const history = new ScrollBoxRenderable(renderer, {
      id: `history-${id}`, flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
      stickyScroll: true, stickyStart: 'bottom', contentOptions: { flexDirection: 'column' },
    });
    box.add(history);
    append(history, 'Intent', principal.intent, COLORS.muted);
    append(history, 'Principal context', principal.principalContext, COLORS.muted);
    const hint = new TextRenderable(renderer, { fg: COLORS.muted, height: 3, flexShrink: 0, wrapMode: 'word' });
    box.add(hint);
    const choices = new ScrollBoxRenderable(renderer, {
      id: `choices-${id}`, visible: false, height: 6, flexShrink: 0,
      scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
      onMouseDown: (event) => { event.stopPropagation(); pane.editingReply = false; focus(user.id); },
    });
    box.add(choices);
    const input = new TextareaRenderable(renderer, {
      id: `reply-${id}`, height: 5, flexShrink: 0, wrapMode: 'word',
      placeholder: `Message your agent as ${principal.name}…`, textColor: COLORS.text,
      backgroundColor: '#192230', focusedBackgroundColor: '#202e40', cursorColor: COLORS.focus,
      onMouseDown: (event) => {
        event.stopPropagation();
        pane.editingReply = true;
        pane.choiceIndex = pane.shownQuestion?.options?.length ?? 0;
        focus(user.id);
      },
      keyBindings: [
        { name: 'return', action: 'submit' },
        { name: 'return', shift: true, action: 'newline' },
        { name: 'j', ctrl: true, action: 'newline' },
      ],
      onSubmit: () => { void send(pane, input.plainText); },
    });
    box.add(input);
    const pane: SessionPane = {
      principal, box, history, input, hint, choices, collapse: collapseButton,
      displayed: 0, choiceRows: [], choiceIndex: 0, editingReply: true, sending: false,
    };
    panes.set(id, pane);
  }
  const collapsedEntries = new Map(users.map((user) => {
    const entry = new TextRenderable(renderer, {
      id: `collapsed-${user.id}`, height: 3, flexShrink: 0, wrapMode: 'none', truncate: true,
      onMouseDown: (event) => { event.stopPropagation(); focus(user.id); },
    });
    collapsed.add(entry);
    return [user.id, entry];
  }));
  board.add(collapsed);

  async function send(pane: SessionPane, text: string): Promise<void> {
    if (pane.sending) return;
    const agent = lab.agents.get(pane.principal.id)!;
    const question = pane.shownQuestion;
    if ((question?.id ?? null) !== (agent.pending?.id ?? null)) { render(); return; }
    const draft = pane.input.plainText;
    pane.sending = true;
    pane.sendError = undefined;
    try {
      const sent = question ? await agent.answer(question.id, text) : await agent.message(text);
      if (renderer.isDestroyed) return;
      if (sent) {
        if (pane.input.plainText === draft) pane.input.clear();
      } else pane.sendError = 'Could not send. Draft kept.';
    } catch (error) {
      pane.sendError = 'Could not save: ' + (error instanceof Error ? error.message : String(error));
    } finally { pane.sending = false; render(); }
  }

  function render(): void {
    if (renderer.isDestroyed) return;
    layout();
    for (const [id, pane] of panes) {
      const principal = pane.principal;
      const agent = lab.agents.get(id)!;
      while (pane.displayed < agent.conversation.length) {
        const entry = agent.conversation[pane.displayed++];
        const human = entry.kind === 'answer' || entry.kind === 'user';
        const who = human ? principal.name + ' (you)' : entry.kind === 'question' ? 'Your agent asks' : 'Your agent';
        const text = entry.text + (entry.options ? '\n\n' + entry.options.map((option) => '• ' + option).join('\n') : '');
        const about = entry.scope === 'intent' ? 'This intent' : entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ');
        append(pane.history, who + (about ? ' · ' + about : ''), text,
          entry.kind === 'question' ? COLORS.question : human ? COLORS.answer : COLORS.focus);
      }
      const question = agent.pending;
      if (pane.shownQuestion !== question) {
        pane.shownQuestion = question;
        pane.input.placeholder = (question ? 'Custom reply as ' : 'Message your agent as ') + principal.name + '…';
        clear(pane.choices);
        pane.choiceRows = [];
        const options = question?.options ?? [];
        const labels = question ? [...options, 'Custom reply…'] : [];
        pane.editingReply = options.length === 0 || Boolean(pane.input.plainText);
        pane.choiceIndex = pane.editingReply ? options.length : 0;
        pane.choices.visible = Boolean(question);
        labels.forEach((text, choiceIndex) => {
          const button = new BoxRenderable(renderer, {
            id: `option-${id}-${choiceIndex}`, width: '100%', flexShrink: 0, paddingX: 1, marginBottom: 1,
            onMouseDown: (event) => {
              event.stopPropagation();
              if (agent.pending?.id !== question?.id) return;
              pane.choiceIndex = choiceIndex;
              pane.editingReply = choiceIndex === options.length;
              focus(principal.userId);
            },
          });
          const label = new TextRenderable(renderer, { content: text, wrapMode: 'word', flexShrink: 0 });
          button.add(label);
          pane.choiceRows.push({ box: button, label, text });
          pane.choices.add(button);
        });
        pane.choices.scrollTo(0);
      }
      // Whole rows avoid fractional layout overlapping the history and reply hint.
      pane.choices.height = Math.min(8, pane.choiceRows.length * 3, Math.max(1, Math.floor((renderer.height - 8) * 0.3)));
      pane.choiceRows.forEach((row, choiceIndex) => {
        const highlighted = choiceIndex === pane.choiceIndex;
        row.box.backgroundColor = highlighted ? '#355073' : '#192230';
        row.label.fg = highlighted ? COLORS.text : COLORS.muted;
        row.label.content = `${highlighted ? '›' : ' '} ${row.text}`;
      });
      pane.box.title = ` H2A · ${principal.name}${question ? ' · needs you' : ''} `;
      pane.box.borderColor = selected === principal.userId ? COLORS.focus : question ? COLORS.question : COLORS.border;
      pane.box.titleColor = question ? COLORS.question : selected === principal.userId ? COLORS.focus : COLORS.muted;
      let hint = question
        ? pane.editingReply ? 'Enter sends · Esc returns to choices.' : '↑/↓ choose · Enter confirms.'
        : 'Enter sends a message to your agent.';
      if (question) hint = (question.scope === 'intent' ? 'For this intent' : 'About ' + question.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ')) + ' · ' + hint;
      if (agent.queuedQuestions) hint += ' · ' + agent.queuedQuestions + ' queued';
      pane.hint.content = pane.sendError ?? (pane.sending ? 'Sending… · ' + hint : hint);
      pane.hint.fg = question ? COLORS.question : COLORS.muted;
    }
    for (const user of users) {
      const entry = collapsedEntries.get(user.id)!;
      const agents = user.intents.map(({ id }) => lab.agents.get(id)!);
      const pending = agents.filter((agent) => agent.pending).length;
      const queued = agents.reduce((sum, agent) => sum + agent.queuedQuestions, 0);
      entry.visible = roster.includes(user) && !expanded.includes(user);
      const highlight = fg(pending ? COLORS.question : COLORS.muted);
      entry.fg = COLORS.muted;
      entry.content = t`${highlight(user.name)}\n${user.current.intent}\n${highlight(pending ? `? ${pending}` : '·')}${queued ? ` · ${queued} queued` : ''}`;
    }
    const key = expanded.length === 2 ? expanded.map(({ current }) => current.id).join('\0') : '';
    if (key !== pairKey) { pairKey = key; matchIndex = 0; }
    let demo: TuiNegotiation | undefined;
    if (a2a.visible) {
      const available = matches();
      matchIndex = Math.min(matchIndex, Math.max(0, available.length - 1));
      demo = available[matchIndex];
      const nextId = demo?.opportunityId ?? pairKey;
      if (opportunityId !== nextId) {
        opportunityId = nextId;
        clear(sharedHistory);
        displayedTurns = 0;
        append(sharedHistory, expanded.map(({ name }) => name).join(' ↔ '), demo ? `Match ${matchIndex + 1}/${available.length} · ${demo.opportunityId} · Ctrl+N changes match.` : 'No negotiation between these selected intents.', COLORS.muted);
      }
      while (demo && displayedTurns < demo.transcript.length) {
        const entry = demo.transcript[displayedTurns++];
        const name = demo.principals.find(({ userId }) => userId === entry.ownerId)!.name;
        append(sharedHistory, name + "'s agent · " + entry.action, entry.text, COLORS.focus);
      }
      a2a.title = ` A2A · ${expanded.map(({ name }) => name).join(' ↔ ')} `;
      a2a.borderColor = selected === null ? COLORS.focus : COLORS.border;
      a2a.titleColor = selected === null ? COLORS.focus : COLORS.muted;
    }
    const waiting = [...lab.agents.values()].filter((agent) => agent.pending).length;
    status.content = (a2a.visible ? (demo?.status ?? 'No match selected') + ' · ' : '')
      + 'Board: ' + roster.length + ' · Expanded: ' + expanded.length + ' · H2A: ' + lab.agents.size + ' · A2A: ' + lab.negotiations.size
      + (waiting ? ' · Awaiting answers: ' + waiting : '') + (lab.agentStatus ? ' · ' + lab.agentStatus : '');
    status.fg = demo?.phase === 'error' ? '#f88a8a' : waiting ? COLORS.question : COLORS.muted;
    help.content = ' Ctrl+U: users · Ctrl+T: intent · Ctrl+O: collapse · Tab/Shift+Tab: chat · ↑↓: choose · Enter: send · Esc: back · Ctrl+J: newline · PgUp/PgDn/wheel: scroll'
      + (a2a.visible ? ' · Ctrl+N: next match' : '') + ' · Ctrl+C: quit';
    if (selector.visible) { renderSelector(); selectorList.focus(); }
    else if (selected === null) sharedHistory.focus();
    else {
      const pane = panes.get(users.find(({ id }) => id === selected)!.current.id)!;
      if (pane.choices.visible && !pane.editingReply) pane.choices.focus(); else pane.input.focus();
    }
  }

  const onKey = (key: KeyEvent) => {
    if (key.name === 'u' && key.ctrl) {
      key.preventDefault();
      if (selector.visible) closeSelector(false); else openSelector();
    } else if (selector.visible) {
      key.preventDefault();
      if (key.name === 'escape') closeSelector(false);
      else if (key.name === 'up' || key.name === 'down') {
        selectorIndex = Math.max(0, Math.min(selectorEntries().length - 1, selectorIndex + (key.name === 'up' ? -1 : 1)));
        renderSelector();
        selectorList.scrollChildIntoView(`selector-${selectorEntries()[selectorIndex].id}`);
      } else if (key.name === 'space' && !intentUser) toggleRosterEntry();
      else if (key.name === 'return' && !key.ctrl && !key.shift && !key.meta) closeSelector(true);
      else if (key.name === 'pageup' || key.name === 'pagedown') selectorList.scrollBy((key.name === 'pageup' ? -1 : 1) * Math.max(1, selectorList.height - 2));
    } else if (key.name === 't' && key.ctrl) {
      key.preventDefault();
      if (selected !== null) openSelector(users.find(({ id }) => id === selected)!);
    } else if (key.name === 'tab') {
      key.preventDefault();
      const order: (string | null)[] = roster.map(({ id }) => id);
      if (a2a.visible) order.splice(order.indexOf(expanded[0].id) + 1, 0, null);
      focus(order[(order.indexOf(selected) + (key.shift ? -1 : 1) + order.length) % order.length]);
    } else if (key.name === 'o' && key.ctrl) {
      key.preventDefault();
      if (selected !== null) collapse(selected);
    } else if (key.name === 'n' && key.ctrl) {
      key.preventDefault();
      if (a2a.visible) { matchIndex = (matchIndex + 1) % Math.max(1, matches().length); render(); }
    } else {
      const pane = selected === null ? undefined : panes.get(users.find(({ id }) => id === selected)!.current.id)!;
      const question = pane?.shownQuestion;
      if (pane && question && key.name === 'escape' && pane.editingReply) {
        key.preventDefault();
        pane.editingReply = false;
        render();
      } else if (pane && question && !pane.editingReply && (key.name === 'up' || key.name === 'down')) {
        key.preventDefault();
        pane.choiceIndex = Math.max(0, Math.min(pane.choiceRows.length - 1, pane.choiceIndex + (key.name === 'up' ? -1 : 1)));
        render();
        pane.choices.scrollChildIntoView(`option-${pane.principal.id}-${pane.choiceIndex}`);
      } else if (pane && question && !pane.editingReply && key.name === 'return' && !key.ctrl && !key.shift && !key.meta) {
        key.preventDefault();
        const option = question.options?.[pane.choiceIndex];
        if (option === undefined) pane.editingReply = true; else void send(pane, option);
        render();
      } else if (key.name === 'pageup' || key.name === 'pagedown') {
        key.preventDefault();
        const history = pane?.history ?? sharedHistory;
        history.scrollBy((key.name === 'pageup' ? -1 : 1) * Math.max(1, history.height - 2));
      }
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
  render();
}
