import type { Agent, Negotiation, PrincipalQuestion, NegotiationAction } from '@indexnetwork/agent';
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
export interface TuiNegotiation extends Pick<Negotiation, 'id' | 'pairKey' | 'sessionNumber' | 'outcome' | 'opportunityStatus'> {
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
  agents: ReadonlyMap<string, Pick<Agent, 'conversation' | 'pending' | 'toolCalls' | 'reviewing' | 'reviewNotice' | 'negotiating' | 'receiveInput' | 'wake'>>;
  negotiations: ReadonlyMap<string, TuiNegotiation>;
  agentStatus: string;
  on(event: 'change', listener: () => void): unknown;
  off(event: 'change', listener: () => void): unknown;
}

export const COLORS = { background: '#10151e', text: '#dce4ef', muted: '#8996aa', border: '#364255', focus: '#77b8ff', question: '#f4c773', answer: '#8dd9b7' };

const ACTION_COLORS: Record<NegotiationAction, string> = {
  propose: COLORS.focus, counter: COLORS.question, accept: COLORS.answer, decline: '#f88a8a',
};

// Keep pane width stable and leave one blank column before a scrollbar appears.
const PANE_SCROLL_OPTIONS = {
  wrapperOptions: { marginRight: 2 },
  verticalScrollbarOptions: { position: 'absolute', right: 0, top: 0, width: 1, height: '100%' },
} as const;

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
  activity: TextRenderable;
  reviewNotice: TextRenderable;
  hint: TextRenderable;
  choices: ScrollBoxRenderable;
  collapse: TextRenderable;
  choiceRows: { box: BoxRenderable; label: TextRenderable; text: string; select(): void }[];
  choiceIndex: number;
  editingReply: boolean;
  shownQuestion?: PrincipalQuestion;
  shownQuestions: readonly PrincipalQuestion[];
  questionIndex: number;
  drafts: Map<string, string>;
  messageDraft: string;
  messageMode: boolean;
  displayed: number;
  messageCards: Map<string, BoxRenderable>;
  toolGroups: Map<string, { box: BoxRenderable; label: TextRenderable; expanded: boolean; rows: Map<string, TextRenderable> }>;
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
  let displayedPair = '';
  const displayedSessions = new Map<string, { section: BoxRenderable; heading: TextRenderable; turns: number }>();
  const matches = () => {
    const threads = new Map<string, TuiNegotiation[]>();
    for (const match of lab.negotiations.values()) {
      if (!expanded.every((user) => match.principals.some(({ id }) => id === user.current.id))) continue;
      const sessions = threads.get(match.pairKey) ?? [];
      sessions.push(match);
      threads.set(match.pairKey, sessions);
    }
    return [...threads.values()].map((sessions) => sessions.sort((a, b) => a.sessionNumber - b.sessionNumber));
  };
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
    ...PANE_SCROLL_OPTIONS,
  });
  a2a.add(sharedHistory);
  const sharedActivity = new TextRenderable(renderer, {
    id: 'activity-a2a', visible: false, height: 1, flexShrink: 0, fg: COLORS.focus, truncate: true,
  });
  a2a.add(sharedActivity);
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
      const pending = lab.agents.get(principal.id)!.pending.length;
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

  function append(history: BoxRenderable, label: string, text: string, color: string): BoxRenderable {
    const rows: TextRenderable[] = [];
    const card = new BoxRenderable(renderer, {
      width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1,
      onSizeChange: () => rows.forEach((row) => { row.width = card.width; }),
    });
    rows.push(new TextRenderable(renderer, { content: label, fg: color, wrapMode: 'word', flexShrink: 0 }));
    rows.push(new TextRenderable(renderer, { content: text, fg: COLORS.text, wrapMode: 'word', flexShrink: 0 }));
    rows.forEach((row) => card.add(row));
    history.add(card);
    return card;
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
      id: `collapse-${id}`, content: '[−]', width: 3, height: 1,
      position: 'absolute', top: -1, right: 1, zIndex: 1,
      fg: COLORS.focus, bg: COLORS.background,
      onMouseDown: (event) => { event.stopPropagation(); collapse(user.id); },
    });
    box.add(collapseButton);
    box.add(new TextRenderable(renderer, {
      id: `intent-${id}`, content: `Intent ▾ ${principal.intent}`, height: 1, flexShrink: 0, minWidth: 0, truncate: true, fg: COLORS.focus,
      onMouseDown: (event) => { event.stopPropagation(); focus(user.id); openSelector(user); },
    }));
    const history = new ScrollBoxRenderable(renderer, {
      id: `history-${id}`, flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
      stickyScroll: true, stickyStart: 'bottom', contentOptions: { flexDirection: 'column' },
      ...PANE_SCROLL_OPTIONS,
    });
    box.add(history);
    append(history, 'Intent', principal.intent, COLORS.muted);
    append(history, 'Principal context', principal.principalContext, COLORS.muted);
    const activity = new TextRenderable(renderer, {
      id: `activity-${id}`, visible: false, flexShrink: 0, fg: COLORS.focus, wrapMode: 'word',
    });
    box.add(activity);
    const reviewNotice = new TextRenderable(renderer, {
      id: `review-notice-${id}`, visible: false, height: 2, flexShrink: 0, wrapMode: 'word', fg: COLORS.question,
    });
    box.add(reviewNotice);
    const hint = new TextRenderable(renderer, { fg: COLORS.muted, height: 3, flexShrink: 0, wrapMode: 'word' });
    box.add(hint);
    const choices = new ScrollBoxRenderable(renderer, {
      id: `choices-${id}`, visible: false, height: 6, flexShrink: 0,
      scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
      ...PANE_SCROLL_OPTIONS,
      onMouseDown: (event) => { event.stopPropagation(); pane.editingReply = false; focus(user.id); },
    });
    box.add(choices);
    const wakeButton = new BoxRenderable(renderer, {
      id: `wake-${id}`, alignSelf: 'stretch', height: 1, flexShrink: 0,
      flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#355073',
      onMouseDown: (event) => {
        event.stopPropagation();
        focus(user.id);
        void wake(pane);
      },
    });
    wakeButton.add(new TextRenderable(renderer, { content: 'Wake', fg: COLORS.text }));
    box.add(wakeButton);
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
      principal, box, history, input, activity, reviewNotice, hint, choices, collapse: collapseButton,
      displayed: 0, messageCards: new Map(), toolGroups: new Map(),
      choiceRows: [], choiceIndex: 0, editingReply: true, sending: false,
      shownQuestions: [], questionIndex: 0, drafts: new Map(), messageDraft: '', messageMode: false,
    };
    input.onContentChange = () => {
      if (pane.shownQuestion) pane.drafts.set(pane.shownQuestion.id, input.plainText);
      else pane.messageDraft = input.plainText;
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

  function chooseQuestion(pane: SessionPane, index: number): void {
    pane.questionIndex = Math.max(0, Math.min(pane.shownQuestions.length - 1, index));
    pane.messageMode = false;
    render();
  }

  async function send(pane: SessionPane, text: string): Promise<void> {
    if (pane.sending || !text.trim()) return;
    const agent = lab.agents.get(pane.principal.id)!;
    const question = pane.shownQuestion;
    if (question) {
      if (!agent.pending.some((current) => current.id === question.id)) { render(); return; }
      pane.input.setText(text);
      pane.drafts.set(question.id, text);
      pane.sendError = undefined;
      const next = pane.shownQuestions.findIndex((current) => !pane.drafts.get(current.id)?.trim());
      if (next >= 0) chooseQuestion(pane, next);
      else {
        pane.editingReply = false;
        pane.choiceIndex = pane.choiceRows.findIndex((row) => row.text === 'Submit all answers');
        render();
        pane.choices.scrollChildIntoView(`option-${pane.principal.id}-${pane.choiceIndex}`);
      }
      return;
    }
    const draft = pane.input.plainText;
    if (await sendMessage(pane, text)) {
      if (pane.messageDraft === draft) pane.messageDraft = '';
      if (!pane.shownQuestion && pane.input.plainText === draft) pane.input.clear();
    }
  }

  async function sendMessage(pane: SessionPane, text: string): Promise<boolean> {
    if (pane.sending) return false;
    pane.sending = true;
    pane.sendError = undefined;
    try {
      const sent = await lab.agents.get(pane.principal.id)!.receiveInput({ type: 'message', text });
      if (!sent) pane.sendError = 'Could not send. Draft kept.';
      return sent !== null && !renderer.isDestroyed;
    } catch (error) {
      pane.sendError = 'Could not send. Draft kept: ' + (error instanceof Error ? error.message : String(error));
      return false;
    } finally { pane.sending = false; render(); }
  }

  async function wake(pane: SessionPane): Promise<void> {
    if (pane.sending) return;
    pane.sending = true;
    pane.sendError = undefined;
    try {
      if (!await lab.agents.get(pane.principal.id)!.wake()) pane.sendError = 'Could not wake. Drafts kept.';
    } catch (error) {
      pane.sendError = 'Could not wake. Drafts kept: ' + (error instanceof Error ? error.message : String(error));
    } finally { pane.sending = false; render(); }
  }

  async function submitAnswers(pane: SessionPane): Promise<void> {
    if (pane.sending) return;
    const agent = lab.agents.get(pane.principal.id)!;
    const answers = pane.shownQuestions.map((question) => ({ questionId: question.id, text: pane.drafts.get(question.id) ?? '' }));
    if (!answers.length || answers.some((answer) => !answer.text.trim())) {
      pane.sendError = 'Draft an answer to every question before submitting.';
      render();
      return;
    }
    pane.sending = true;
    pane.sendError = undefined;
    try {
      const sent = await agent.receiveInput({ type: 'answers', answers });
      if (sent !== null) {
        if (!renderer.isDestroyed) {
          for (const answer of answers) if (pane.drafts.get(answer.questionId) === answer.text) pane.drafts.delete(answer.questionId);
        }
      } else pane.sendError = 'Batch changed; nothing sent. Drafts kept.';
    } catch (error) {
      pane.sendError = 'Could not save batch. Drafts kept: ' + (error instanceof Error ? error.message : String(error));
    } finally { pane.sending = false; render(); }
  }

  function render(): void {
    if (renderer.isDestroyed) return;
    layout();
    for (const [id, pane] of panes) {
      const principal = pane.principal;
      const agent = lab.agents.get(id)!;
      const runningTool = agent.toolCalls.findLast((call) => call.status === 'running');
      pane.activity.visible = agent.reviewing;
      pane.activity.content = runningTool ? `${runningTool.label}…` : 'Preparing the next step…';
      pane.reviewNotice.visible = Boolean(agent.reviewNotice);
      pane.reviewNotice.content = agent.reviewNotice ?? '';
      while (pane.displayed < agent.conversation.length) {
        const entry = agent.conversation[pane.displayed++];
        const human = entry.kind === 'answer' || entry.kind === 'user';
        const who = human ? principal.name + ' (you)' : entry.kind === 'question' ? 'Your agent asks' : 'Your agent';
        const text = entry.text + (entry.options ? '\n\n' + entry.options.map((option) => '• ' + option).join('\n') : '');
        const about = entry.scope === 'intent' ? 'This intent' : entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ');
        const card = append(pane.history, who + (about ? ' · ' + about : ''), text,
          entry.kind === 'question' ? COLORS.question : human ? COLORS.answer : COLORS.focus);
        pane.messageCards.set(entry.id, card);
      }
      for (const call of agent.toolCalls) {
        let group = pane.toolGroups.get(call.reviewId);
        if (!group) {
          const box = new BoxRenderable(renderer, {
            id: `tools-${id}-${call.reviewId}`, width: '100%', flexDirection: 'column', flexShrink: 0,
            border: true, borderStyle: 'rounded', paddingX: 1, marginBottom: 1,
            onMouseDown: (event) => {
              event.stopPropagation();
              const current = pane.toolGroups.get(call.reviewId)!;
              current.expanded = !current.expanded;
              focus(principal.userId);
            },
          });
          const label = new TextRenderable(renderer, { wrapMode: 'word', flexShrink: 0 });
          box.add(label);
          const previous = agent.conversation.findIndex((message) => message.id === call.afterMessageId);
          const next = agent.conversation[previous + 1];
          const before = next && pane.messageCards.get(next.id);
          if (before) pane.history.insertBefore(box, before);
          else pane.history.add(box);
          group = { box, label, expanded: true, rows: new Map() };
          pane.toolGroups.set(call.reviewId, group);
        }
        let row = group.rows.get(call.id);
        if (!row) {
          row = new TextRenderable(renderer, { wrapMode: 'word', flexShrink: 0 });
          group.box.add(row);
          group.rows.set(call.id, row);
        }
        const color = { running: COLORS.focus, completed: COLORS.answer, error: '#f88a8a', cancelled: COLORS.muted }[call.status];
        const label = call.label + (call.status === 'running' ? '…' : '');
        row.content = [`${label} · ${call.status}`, call.details, call.summary].filter(Boolean).join('\n\n');
        row.fg = color;
        row.visible = group.expanded;
        group.box.borderColor = color;
        group.label.fg = color;
        group.label.content = `${group.expanded ? '[−]' : '[+]'} ${label} · ${call.status} · ${group.rows.size} ${group.rows.size === 1 ? 'call' : 'calls'}${!group.expanded && call.summary ? '\n' + call.summary.split('\n')[0] : ''}`;
      }
      if (pane.shownQuestions !== agent.pending) {
        if (!pane.shownQuestions.length) pane.messageMode = Boolean(pane.messageDraft);
        const selectedQuestionId = pane.shownQuestions[pane.questionIndex]?.id;
        const retainedIndex = agent.pending.findIndex((question) => question.id === selectedQuestionId);
        pane.shownQuestions = agent.pending;
        pane.questionIndex = retainedIndex >= 0 ? retainedIndex : Math.min(pane.questionIndex, Math.max(0, agent.pending.length - 1));
      }
      const question = pane.messageMode ? undefined : agent.pending[pane.questionIndex];
      if (pane.shownQuestion !== question) {
        pane.shownQuestion = question;
        pane.input.setText(question ? pane.drafts.get(question.id) ?? '' : pane.messageDraft);
        pane.input.placeholder = (question ? 'Draft an answer as ' : 'Message your agent as ') + principal.name + '…';
        clear(pane.choices);
        pane.choiceRows = [];
        const options = question?.options ?? [];
        const choices = question ? [
          ...options.map((text) => ({ text, select: () => { void send(pane, text); } })),
          { text: 'Custom reply…', select: () => { pane.editingReply = true; render(); } },
          { text: 'Previous question', select: () => chooseQuestion(pane, pane.questionIndex - 1) },
          { text: 'Next question', select: () => chooseQuestion(pane, pane.questionIndex + 1) },
          { text: 'Submit all answers', select: () => { void submitAnswers(pane); } },
          { text: 'Direct message…', select: () => { pane.messageMode = true; render(); } },
        ] : [];
        pane.editingReply = options.length === 0 || Boolean(pane.input.plainText);
        pane.choiceIndex = pane.editingReply ? options.length : 0;
        pane.choices.visible = Boolean(question);
        if (question) pane.choices.add(new TextRenderable(renderer, {
          content: `${pane.questionIndex + 1}/${agent.pending.length}. ${question.question}`, fg: COLORS.question, wrapMode: 'word', flexShrink: 0,
        }));
        choices.forEach(({ text, select }, choiceIndex) => {
          const button = new BoxRenderable(renderer, {
            id: `option-${id}-${choiceIndex}`, width: '100%', flexShrink: 0, paddingX: 1, marginBottom: 1,
            onMouseDown: (event) => {
              event.stopPropagation();
              if (!agent.pending.some((current) => current.id === question?.id)) return;
              pane.choiceIndex = choiceIndex;
              pane.editingReply = false;
              focus(principal.userId);
              select();
            },
          });
          const label = new TextRenderable(renderer, { content: text, wrapMode: 'word', flexShrink: 0 });
          button.add(label);
          pane.choiceRows.push({ box: button, label, text, select });
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
      const pending = agent.pending.length;
      pane.box.title = ` H2A · ${principal.name}${pending ? ` · ${pending} questions` : ''} `;
      pane.box.borderColor = selected === principal.userId ? COLORS.focus : pending ? COLORS.question : COLORS.border;
      pane.box.titleColor = pending ? COLORS.question : selected === principal.userId ? COLORS.focus : COLORS.muted;
      const hint = question
        ? `Question ${pane.questionIndex + 1}/${pending} · ${pane.editingReply ? 'Enter drafts · Esc choices' : '↑/↓ choose · Enter drafts'} · Ctrl+←/→ question · Ctrl+S submits ALL`
        : 'Enter sends a message and starts a review.' + (pending ? ' Ctrl+G returns to questions.' : '');
      pane.hint.content = pane.sendError ?? (pane.sending ? 'Sending… · ' + hint : hint);
      pane.hint.fg = question ? COLORS.question : COLORS.muted;
    }
    for (const user of users) {
      const entry = collapsedEntries.get(user.id)!;
      const agents = user.intents.map(({ id }) => lab.agents.get(id)!);
      const pending = agents.reduce((count, agent) => count + agent.pending.length, 0);
      entry.visible = roster.includes(user) && !expanded.includes(user);
      const highlight = fg(pending ? COLORS.question : COLORS.muted);
      entry.fg = COLORS.muted;
      entry.content = t`${highlight(user.name)}\n${user.current.intent}\n${highlight(pending ? `? ${pending}` : '·')}`;
    }
    const key = expanded.length === 2 ? expanded.map(({ current }) => current.id).join('\0') : '';
    if (key !== pairKey) { pairKey = key; matchIndex = 0; }
    let demo: TuiNegotiation | undefined;
    sharedActivity.visible = false;
    if (a2a.visible) {
      const available = matches();
      matchIndex = Math.min(matchIndex, Math.max(0, available.length - 1));
      const sessions = available[matchIndex] ?? [];
      demo = sessions.at(-1);
      const thinking = demo?.principals.filter((principal) => lab.agents.get(principal.id)!.negotiating.includes(demo!.opportunityId)) ?? [];
      sharedActivity.visible = thinking.length > 0;
      sharedActivity.content = 'Thinking… · ' + thinking.map(({ name }) => name + "'s Agent").join(' & ');
      const nextPair = demo?.pairKey ?? pairKey;
      if (displayedPair !== nextPair || [...displayedSessions.keys()].some((id, index) => id !== sessions[index]?.id)) {
        displayedPair = nextPair;
        clear(sharedHistory);
        displayedSessions.clear();
        append(sharedHistory, expanded.map(({ name }) => name).join(' ↔ '), demo ? `Thread ${matchIndex + 1}/${available.length} · Ctrl+N changes thread. Earlier sessions are history, not current offers.` : 'No negotiation between these selected intents.', COLORS.muted);
      }
      for (const session of sessions) {
        let displayed = displayedSessions.get(session.id);
        if (!displayed) {
          const heading = new TextRenderable(renderer, { id: `a2a-session-${session.id}`, fg: COLORS.muted, wrapMode: 'word', flexShrink: 0, marginTop: 1 });
          const section = new BoxRenderable(renderer, {
            width: '100%', flexDirection: 'column', flexShrink: 0,
            onSizeChange: () => { heading.width = section.width; },
          });
          section.add(heading);
          sharedHistory.add(section);
          displayed = { section, heading, turns: 0 };
          displayedSessions.set(session.id, displayed);
        }
        displayed.heading.content = `── Session ${session.sessionNumber} · ${session.outcome ?? 'In progress'} · Opportunity: ${session.opportunityStatus} ──`;
        while (displayed.turns < session.transcript.length) {
          const entry = session.transcript[displayed.turns++];
          const name = session.principals.find(({ userId }) => userId === entry.ownerId)!.name;
          append(displayed.section, name + "'s agent · " + entry.action, entry.text, ACTION_COLORS[entry.action]);
        }
      }
      a2a.title = ` A2A · ${expanded.map(({ name }) => name).join(' ↔ ')} `;
      a2a.borderColor = selected === null ? COLORS.focus : COLORS.border;
      a2a.titleColor = selected === null ? COLORS.focus : COLORS.muted;
    }
    const waiting = [...lab.agents.values()].reduce((count, agent) => count + agent.pending.length, 0);
    status.content = (a2a.visible ? (demo?.status ?? 'No match selected') + ' · ' : '')
      + 'Board: ' + roster.length + ' · Expanded: ' + expanded.length + ' · H2A: ' + lab.agents.size + ' · A2A: ' + lab.negotiations.size
      + (waiting ? ' · Awaiting answers: ' + waiting : '') + (lab.agentStatus ? ' · ' + lab.agentStatus : '');
    status.fg = demo?.phase === 'error' ? '#f88a8a' : waiting ? COLORS.question : COLORS.muted;
    help.content = ' Ctrl+U: users · Ctrl+T: intent · Ctrl+O: collapse · Tab/Shift+Tab: chat · ↑↓: choose · Enter: draft/send · Ctrl+S: submit batch · Ctrl+G: message/questions · Esc: back · Ctrl+J: newline · PgUp/PgDn/wheel: scroll'
      + (a2a.visible ? ' · Ctrl+N: next thread' : '') + ' · Ctrl+C: quit';
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
      if (pane && pane.shownQuestions.length && key.ctrl && (key.name === 'left' || key.name === 'right')) {
        key.preventDefault();
        chooseQuestion(pane, pane.questionIndex + (key.name === 'left' ? -1 : 1));
      } else if (pane && pane.shownQuestions.length && key.ctrl && key.name === 's') {
        key.preventDefault();
        void submitAnswers(pane);
      } else if (pane && pane.shownQuestions.length && key.ctrl && key.name === 'g') {
        key.preventDefault();
        pane.messageMode = !pane.messageMode;
        render();
      } else if (pane && question && key.name === 'escape' && pane.editingReply) {
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
        pane.choiceRows[pane.choiceIndex]?.select();
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
