import type { PrincipalMessage, NegotiationAction, NegotiationOutcome } from '@indexnetwork/agent';
import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, fg, t, type CliRenderer, type KeyEvent } from '@opentui/core';

/** An independently selectable principal/intent conversation. */
export interface TuiPrincipal {
  id: string;
  userId: string;
  name: string;
  intentId: string;
  intent: string;
}
/** Typed host outcomes are presented separately from human/agent dialogue. */
export type TuiMessage = PrincipalMessage & ({ source: 'host'; outcome: NegotiationOutcome; counterpartyIntent: string } | { source?: never });
export type TuiQuestion = PrincipalMessage & { kind: 'question'; questionId: string };
/** The host-owned human/agent conversation presented by one intent pane. */
export interface TuiConversation {
  conversation: readonly TuiMessage[];
  pending: TuiQuestion | null;
  queuedQuestions: number;
  /**
   * @param text - Human input for this intent.
   * @returns Whether the input was saved.
   */
  message(text: string): Promise<boolean>;
  /**
   * @param questionId - The still-open question to answer.
   * @param text - The human's reply.
   * @returns Whether the answer was saved.
   */
  answer(questionId: string, text: string): Promise<boolean>;
}
/** A host-observed H2A tool invocation, grouped by execution in owner-only activity. */
export interface TuiToolCall {
  id: string;
  runId: string;
  operation: 'wake' | 'brief';
  name: string;
  label: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  details: string;
  summary?: string;
}
/** Execution activity for one principal/intent conversation, separate from its messages. */
export interface TuiActivity {
  readonly reviewing: boolean;
  readonly toolCalls: readonly TuiToolCall[];
  readonly negotiating: readonly string[];
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
  conversations: ReadonlyMap<string, TuiConversation>;
  activities: ReadonlyMap<string, TuiActivity>;
  negotiations: ReadonlyMap<string, TuiNegotiation>;
  agentStatus: string;
  /**
   * Request H2A reasoning without adding principal input or releasing negotiation holds.
   * @param principalId - The user–intent session to wake.
   * @returns After scheduling, not after reasoning completes.
   */
  wake(principalId: string): void;
  on(event: 'change', listener: () => void): unknown;
  off(event: 'change', listener: () => void): unknown;
}

export const COLORS = { background: '#10151e', text: '#dce4ef', muted: '#8996aa', border: '#364255', focus: '#77b8ff', question: '#f4c773', answer: '#8dd9b7' };

const ACTION_COLORS: Record<NegotiationAction, string> = {
  propose: COLORS.focus, counter: COLORS.question, accept: COLORS.answer, decline: '#f88a8a',
};
const TOOL_COLORS: Record<TuiToolCall['status'], string> = {
  running: COLORS.question, completed: COLORS.answer, error: '#f88a8a', cancelled: COLORS.muted,
};
const RUN_COLORS: Record<TuiToolCall['operation'], string> = { wake: COLORS.focus, brief: '#c6a1ef' };
const OUTCOME_COLORS: Record<NegotiationOutcome, string> = { agreed: COLORS.answer, declined: '#f88a8a', closed: COLORS.muted };
/** Bookkeeping kinds are filtered out of the transcript before it reaches the view. */
type ShownKind = Exclude<PrincipalMessage['kind'], 'brief' | 'decision' | 'stall'>;

const MESSAGE_STYLES: Record<ShownKind, { label: string; color: string; background: string }> = {
  user: { label: 'YOU · MESSAGE', color: '#bca6ee', background: '#201c2e' },
  answer: { label: 'YOU · ANSWER', color: COLORS.answer, background: '#162b26' },
  message: { label: 'YOUR AGENT', color: COLORS.focus, background: '#172536' },
  question: { label: 'QUESTION · YOUR AGENT', color: COLORS.question, background: '#30291b' },
  expire: { label: 'QUESTION CLOSED', color: COLORS.muted, background: '#1c222b' },
  progress: { label: 'YOUR AGENT', color: COLORS.focus, background: '#172536' },
};

// Reserve a blank column and a scrollbar column even before the history overflows.
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
  messageInput: TextareaRenderable;
  messageMode: boolean;
  answerDraft: string;
  messageDraft: string;
  answerRevision: number;
  messageRevision: number;
  modeButton: TextRenderable;
  activity: TextRenderable;
  hint: TextRenderable;
  choices: ScrollBoxRenderable;
  collapse: TextRenderable;
  choiceRows: { box: BoxRenderable; label: TextRenderable; text: string }[];
  choiceIndex: number;
  editingReply: boolean;
  shownQuestion?: TuiQuestion | null;
  draftQuestionId: string | null;
  displayed: number;
  activityLog: {
    box: BoxRenderable;
    label: TextRenderable;
    body: BoxRenderable;
    outcomes: BoxRenderable;
    runs: BoxRenderable;
    expanded: boolean;
    results: number;
  };
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
  // Each retained session owns selection listeners for its history, choices, and two editors.
  renderer.setMaxListeners(Math.max(renderer.getMaxListeners(), lab.users.length * 4 + 10));
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
    ...PANE_SCROLL_OPTIONS,
  });
  a2a.add(sharedHistory);
  const sharedActivity = new TextRenderable(renderer, {
    id: 'activity-a2a', visible: false, flexShrink: 0, fg: COLORS.focus, wrapMode: 'word',
  });
  a2a.add(sharedActivity);
  board.add(a2a);
  const collapsed = new ScrollBoxRenderable(renderer, {
    id: 'collapsed-chats', visible: false, width: 24, flexShrink: 0, scrollX: false, scrollY: true,
    border: true, borderColor: COLORS.border, title: ' Collapsed ', contentOptions: { flexDirection: 'column' },
    ...PANE_SCROLL_OPTIONS,
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
    ...PANE_SCROLL_OPTIONS,
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
      const pending = lab.conversations.get(principal.id)!.pending;
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

  function append(history: ScrollBoxRenderable, label: string, text: string, color: string): BoxRenderable {
    const card = new BoxRenderable(renderer, {
      width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1,
      onSizeChange: () => card.getChildren().forEach((row) => { row.width = card.width; }),
    });
    card.add(new TextRenderable(renderer, { content: label, fg: color, width: '100%', wrapMode: 'word', flexShrink: 0 }));
    card.add(new TextRenderable(renderer, { content: text, fg: COLORS.text, width: '100%', wrapMode: 'word', flexShrink: 0 }));
    history.add(card);
    return card;
  }

  function appendMessage(pane: SessionPane, entry: PrincipalMessage): void {
    const style = MESSAGE_STYLES[entry.kind as ShownKind];
    const about = entry.scope === 'intent' ? 'This intent' : entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ');
    const card = new BoxRenderable(renderer, {
      id: `entry-${pane.principal.id}-${entry.id}`, width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1,
      border: ['left'], borderColor: style.color, backgroundColor: style.background, paddingX: 1,
      onSizeChange: () => card.getChildren().forEach((row) => { row.width = Math.max(1, card.width - 3); }),
    });
    card.add(new TextRenderable(renderer, {
      content: style.label + (about ? ' · ' + about : ''), fg: style.color, width: '100%', wrapMode: 'word', flexShrink: 0,
    }));
    card.add(new TextRenderable(renderer, {
      content: entry.text + (entry.options ? '\n\n' + entry.options.map((option) => '• ' + option).join('\n') : ''),
      fg: COLORS.text, width: '100%', wrapMode: 'word', flexShrink: 0,
    }));
    pane.history.add(card);
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
      position: 'absolute', top: -1, right: 1, zIndex: 1, fg: COLORS.focus, bg: COLORS.background,
      onMouseDown: (event) => { event.stopPropagation(); collapse(user.id); },
    });
    box.add(collapseButton);
    const sessionHeader = new BoxRenderable(renderer, { height: 1, flexShrink: 0, flexDirection: 'row', gap: 1 });
    sessionHeader.add(new TextRenderable(renderer, {
      id: `intent-${id}`, content: `Intent ▾ ${principal.intent}`, height: 1, flexGrow: 1, flexBasis: 0, minWidth: 0, truncate: true, fg: COLORS.focus,
      onMouseDown: (event) => { event.stopPropagation(); focus(user.id); openSelector(user); },
    }));
    sessionHeader.add(new TextRenderable(renderer, {
      id: `wake-${id}`, content: '[ Wake ]', width: 8, height: 1, flexShrink: 0, fg: COLORS.focus,
      onMouseDown: (event) => { event.stopPropagation(); focus(user.id); lab.wake(id); },
    }));
    box.add(sessionHeader);
    const history = new ScrollBoxRenderable(renderer, {
      id: `history-${id}`, flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
      stickyScroll: true, stickyStart: 'bottom', contentOptions: { flexDirection: 'column' },
      ...PANE_SCROLL_OPTIONS,
    });
    box.add(history);
    append(history, 'Intent', principal.intent, COLORS.muted);
    const activityBox = new BoxRenderable(renderer, {
      id: `activity-log-${id}`, width: '100%', flexDirection: 'column', flexShrink: 0, marginBottom: 1,
      border: true, borderStyle: 'rounded', borderColor: COLORS.border, backgroundColor: '#151c27', paddingX: 1,
      onSizeChange: () => activityBox.getChildren().forEach((row) => { row.width = Math.max(1, activityBox.width - 4); }),
    });
    const activityLabel = new TextRenderable(renderer, {
      id: `activity-toggle-${id}`, width: '100%', wrapMode: 'word', flexShrink: 0, fg: COLORS.text,
      onMouseDown: (event) => {
        event.preventDefault();
        event.stopPropagation();
        pane.activityLog.expanded = !pane.activityLog.expanded;
        renderActivity(pane, lab.activities.get(id)!);
      },
    });
    activityBox.add(activityLabel);
    const activityBody = new BoxRenderable(renderer, {
      id: `activity-body-${id}`, visible: false, width: '100%', flexDirection: 'column', flexShrink: 0,
      onSizeChange: () => activityBody.getChildren().forEach((row) => { row.width = activityBody.width; }),
    });
    const outcomes = new BoxRenderable(renderer, {
      id: `activity-outcomes-${id}`, visible: false, width: '100%', flexDirection: 'column', flexShrink: 0, marginTop: 1,
      onSizeChange: () => outcomes.getChildren().forEach((row) => { row.width = outcomes.width; }),
    });
    outcomes.add(new TextRenderable(renderer, {
      content: 'Outcomes · Host reports, not human consent or authorization for commitments.',
      fg: COLORS.muted, width: '100%', wrapMode: 'word', flexShrink: 0, marginBottom: 1,
    }));
    activityBody.add(outcomes);
    const runs = new BoxRenderable(renderer, {
      id: `activity-runs-${id}`, width: '100%', flexDirection: 'column', flexShrink: 0,
      onSizeChange: () => runs.getChildren().forEach((row) => { row.width = runs.width; }),
    });
    activityBody.add(runs);
    activityBox.add(activityBody);
    history.add(activityBox);
    const activity = new TextRenderable(renderer, {
      id: `activity-${id}`, visible: false, flexShrink: 0, fg: COLORS.focus, wrapMode: 'word',
    });
    box.add(activity);
    const modeButton = new TextRenderable(renderer, {
      id: `input-mode-${id}`, flexShrink: 0, fg: COLORS.focus, wrapMode: 'word',
      onMouseDown: (event) => { event.stopPropagation(); toggleInput(pane); },
    });
    box.add(modeButton);
    const hint = new TextRenderable(renderer, { fg: COLORS.muted, height: 3, flexShrink: 0, wrapMode: 'word' });
    box.add(hint);
    const choices = new ScrollBoxRenderable(renderer, {
      id: `choices-${id}`, visible: false, height: 6, flexShrink: 0,
      scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' },
      ...PANE_SCROLL_OPTIONS,
      onMouseDown: (event) => { event.stopPropagation(); pane.editingReply = false; focus(user.id); },
    });
    box.add(choices);
    const input = new TextareaRenderable(renderer, {
      id: `reply-${id}`, height: 5, flexShrink: 0, wrapMode: 'word',
      placeholder: `Custom reply as ${principal.name}…`, textColor: COLORS.text,
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
    const messageInput = new TextareaRenderable(renderer, {
      id: `message-${id}`, height: 5, flexShrink: 0, wrapMode: 'word',
      placeholder: `Message your agent as ${principal.name}…`, textColor: COLORS.text,
      backgroundColor: '#192230', focusedBackgroundColor: '#202e40', cursorColor: COLORS.focus,
      onMouseDown: (event) => { event.stopPropagation(); focus(user.id); },
      keyBindings: [
        { name: 'return', action: 'submit' },
        { name: 'return', shift: true, action: 'newline' },
        { name: 'j', ctrl: true, action: 'newline' },
      ],
      onSubmit: () => { void send(pane, messageInput.plainText); },
    });
    box.add(messageInput);
    const pane: SessionPane = {
      principal, box, history, input, messageInput, activity, modeButton, hint, choices, collapse: collapseButton,
      displayed: 0, toolGroups: new Map(),
      activityLog: { box: activityBox, label: activityLabel, body: activityBody, outcomes, runs, expanded: false, results: 0 },
      choiceRows: [], choiceIndex: 0, editingReply: true, sending: false, draftQuestionId: null,
      messageMode: !lab.conversations.get(id)!.pending, answerDraft: '', messageDraft: '', answerRevision: 0, messageRevision: 0,
    };
    panes.set(id, pane);
    input.onContentChange = () => {
      const questionId = pane.draftQuestionId;
      captureDrafts(pane);
      if (pane.draftQuestionId !== questionId) render();
    };
    messageInput.onContentChange = () => { captureDrafts(pane); };
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

  function captureDrafts(pane: SessionPane): void {
    // Native change notifications can lag behind input or a host question update.
    // Capture text while it still belongs to the displayed question, only once per edit.
    const answer = pane.input.plainText;
    if (answer !== pane.answerDraft) {
      pane.answerDraft = answer;
      pane.answerRevision++;
      pane.draftQuestionId = pane.shownQuestion?.questionId ?? null;
    }
    const message = pane.messageInput.plainText;
    if (message !== pane.messageDraft) {
      pane.messageDraft = message;
      pane.messageRevision++;
    }
  }

  function toggleInput(pane: SessionPane): void {
    if (pane.messageMode && !pane.shownQuestion && !pane.input.plainText) return;
    pane.messageMode = !pane.messageMode;
    focus(pane.principal.userId);
  }

  async function send(pane: SessionPane, text: string, fromChoice = false): Promise<void> {
    if (pane.sending || !text.trim()) return;
    captureDrafts(pane);
    const conversation = lab.conversations.get(pane.principal.id)!;
    const messageMode = pane.messageMode;
    const question = pane.shownQuestion;
    if (!messageMode && (!question || question.questionId !== conversation.pending?.questionId)) { render(); return; }
    const input = messageMode ? pane.messageInput : pane.input;
    const draft = input.plainText;
    const revision = messageMode ? pane.messageRevision : pane.answerRevision;
    if (!messageMode && !fromChoice && draft && pane.draftQuestionId !== question!.questionId) { render(); return; }
    pane.sending = true;
    pane.sendError = undefined;
    render();
    try {
      const sent = messageMode ? await conversation.message(text) : await conversation.answer(question!.questionId, text);
      if (renderer.isDestroyed) return;
      if (sent) {
        captureDrafts(pane);
        // A mode switch or next question must not redirect completion to another draft.
        if (!fromChoice && input.plainText === draft && revision === (messageMode ? pane.messageRevision : pane.answerRevision)) input.clear();
      } else pane.sendError = 'Could not send. Draft kept.';
    } catch (error) {
      pane.sendError = 'Could not save: ' + (error instanceof Error ? error.message : String(error));
    } finally { pane.sending = false; render(); }
  }

  function renderActivity(pane: SessionPane, activity: TuiActivity): void {
    const log = pane.activityLog;
    // Reading activity must not follow the chat's bottom edge as details grow.
    pane.history.stickyScroll = !log.expanded;
    const running = activity.toolCalls.filter((call) => call.status === 'running').length;
    const errors = activity.toolCalls.filter((call) => call.status === 'error').length;
    log.body.visible = log.expanded;
    log.outcomes.visible = log.results > 0;
    log.box.borderColor = errors ? TOOL_COLORS.error : COLORS.border;
    log.label.content = t`${fg(COLORS.focus)(`${log.expanded ? '[−]' : '[+]'} Activity`)} · ${log.results} ${log.results === 1 ? 'result' : 'results'} · ${activity.toolCalls.length} tool ${activity.toolCalls.length === 1 ? 'call' : 'calls'}${fg(TOOL_COLORS.running)(running ? ` · ${running} running` : '')}${fg(TOOL_COLORS.error)(errors ? ` · ${errors} ${errors === 1 ? 'error' : 'errors'}` : '')}`;
    const runs = new Map<string, TuiToolCall[]>();
    for (const call of activity.toolCalls) {
      const calls = runs.get(call.runId) ?? [];
      calls.push(call);
      runs.set(call.runId, calls);
    }
    for (const [runId, calls] of runs) {
      const accent = RUN_COLORS[calls[0].operation];
      let group = pane.toolGroups.get(runId);
      if (!group) {
        const box = new BoxRenderable(renderer, {
          id: `tools-${pane.principal.id}-${runId}`, width: '100%', flexDirection: 'column', flexShrink: 0,
          border: ['left'], borderColor: accent, paddingLeft: 1, marginTop: 1,
          onSizeChange: () => box.getChildren().forEach((row) => { row.width = Math.max(1, box.width - 2); }),
        });
        const label = new TextRenderable(renderer, {
          id: `tools-toggle-${pane.principal.id}-${runId}`, width: '100%', wrapMode: 'word', flexShrink: 0, fg: COLORS.text,
          onMouseDown: (event) => {
            event.preventDefault();
            event.stopPropagation();
            const current = pane.toolGroups.get(runId)!;
            current.expanded = !current.expanded;
            renderActivity(pane, lab.activities.get(pane.principal.id)!);
          },
        });
        box.add(label);
        log.runs.add(box);
        group = { box, label, expanded: false, rows: new Map() };
        pane.toolGroups.set(runId, group);
      }
      for (const call of calls) {
        let row = group.rows.get(call.id);
        if (!group.expanded) {
          if (row) row.visible = false;
          continue;
        }
        if (!row) {
          row = new TextRenderable(renderer, {
            id: `tool-call-${pane.principal.id}-${call.id}`, width: '100%', wrapMode: 'word', flexShrink: 0, marginTop: 1, fg: COLORS.text,
          });
          group.box.add(row);
          group.rows.set(call.id, row);
        }
        const label = call.label + (call.status === 'running' ? '…' : '') + ' · ' + call.status;
        row.content = t`${fg(TOOL_COLORS[call.status])(label)}${call.details ? '\nInput: ' + call.details : ''}${call.summary ? '\n' + (call.status === 'error' ? 'Error: ' : 'Output: ') + call.summary : ''}`;
        row.visible = true;
      }
      const counts = { running: 0, completed: 0, error: 0, cancelled: 0 };
      for (const call of calls) counts[call.status]++;
      group.label.content = t`${fg(accent)(`${group.expanded ? '[−]' : '[+]'} ${calls[0].operation === 'wake' ? 'Wake' : 'Brief'}`)} · ${calls.length} ${calls.length === 1 ? 'call' : 'calls'}${fg(TOOL_COLORS.running)(counts.running ? ` · ${counts.running} running` : '')}${fg(TOOL_COLORS.completed)(counts.completed ? ` · ${counts.completed} completed` : '')}${fg(TOOL_COLORS.error)(counts.error ? ` · ${counts.error} ${counts.error === 1 ? 'error' : 'errors'}` : '')}${fg(TOOL_COLORS.cancelled)(counts.cancelled ? ` · ${counts.cancelled} cancelled` : '')}`;
    }
  }

  function render(preserveFocus = false): void {
    if (renderer.isDestroyed) return;
    layout();
    for (const [id, pane] of panes) {
      captureDrafts(pane);
      const principal = pane.principal;
      const conversation = lab.conversations.get(id)!;
      const activity = lab.activities.get(id)!;
      while (pane.displayed < conversation.conversation.length) {
        const entry = conversation.conversation[pane.displayed++];
        if (entry.source === 'host') {
          const counterpart = entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ');
          pane.activityLog.outcomes.add(new TextRenderable(renderer, {
            id: `outcome-${id}-${entry.id}`, width: '100%', wrapMode: 'word', flexShrink: 0, fg: COLORS.text,
            content: t`${fg(OUTCOME_COLORS[entry.outcome])(entry.outcome.toUpperCase())} · ${counterpart} · ${entry.counterpartyIntent}`,
          }));
          pane.activityLog.results++;
        } else appendMessage(pane, entry);
      }
      renderActivity(pane, activity);
      const running = activity.toolCalls.filter((call) => call.status === 'running').at(-1);
      pane.activity.visible = activity.reviewing;
      pane.activity.content = running ? running.label + '…' : 'Preparing the next step…';
      const question = conversation.pending;
      if (pane.shownQuestion === undefined || pane.shownQuestion?.questionId !== question?.questionId) {
        if (question && !pane.shownQuestion && !pane.messageInput.plainText && !pane.sending) pane.messageMode = false;
        pane.shownQuestion = question;
        pane.input.placeholder = question ? `Custom reply as ${principal.name}…` : 'No pending question';
        clear(pane.choices);
        pane.choiceRows = [];
        const options = question?.options ?? [];
        const labels = question ? [...options, 'Custom reply…'] : [];
        pane.editingReply = options.length === 0 || Boolean(pane.input.plainText);
        pane.choiceIndex = pane.editingReply ? options.length : 0;
        labels.forEach((text, choiceIndex) => {
          const button = new BoxRenderable(renderer, {
            id: `option-${id}-${choiceIndex}`, width: '100%', flexShrink: 0, paddingX: 1, marginBottom: 1,
            onSizeChange: () => { label.width = Math.max(1, button.width - 2); },
            onMouseDown: (event) => {
              event.stopPropagation();
              if (conversation.pending?.questionId !== question?.questionId) return;
              pane.choiceIndex = choiceIndex;
              pane.editingReply = choiceIndex === options.length;
              focus(principal.userId);
            },
          });
          const label = new TextRenderable(renderer, { content: text, width: '100%', wrapMode: 'word', flexShrink: 0 });
          button.add(label);
          pane.choiceRows.push({ box: button, label, text });
          pane.choices.add(button);
        });
        pane.choices.scrollTo(0);
      }
      if (!question && !pane.input.plainText) pane.messageMode = true;
      pane.input.visible = !pane.messageMode;
      pane.messageInput.visible = pane.messageMode;
      pane.choices.visible = Boolean(question) && !pane.messageMode;
      pane.modeButton.content = pane.messageMode
        ? 'Direct message' + (question ? ' · [Answer question · Ctrl+G]' : pane.input.plainText ? ' · [Saved answer · Ctrl+G]' : ' · no pending question')
        : 'Answer question · [Direct message · Ctrl+G]';
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
      let hint = pane.messageMode ? 'Enter sends a direct message.' + (question ? ' Question still needs your answer.' : '')
        : question ? pane.editingReply ? 'Enter sends · Esc returns to choices.' : '↑/↓ choose · Enter confirms.'
        : 'No pending question. Ctrl+G opens a separate message draft.';
      const draftNeedsReview = !pane.messageMode && Boolean(pane.input.plainText) && pane.draftQuestionId !== (question?.questionId ?? null);
      if (draftNeedsReview) hint = question
        ? 'Question changed. Draft kept: edit/clear it' + (question.options?.length ? ', or Esc to choose an answer.' : ' before sending.')
        : 'Question expired. Answer draft kept. Ctrl+G opens a separate message draft.';
      if (question && !pane.messageMode) hint = (question.scope === 'intent' ? 'For this intent' : 'About ' + question.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ')) + ' · ' + hint;
      if (conversation.queuedQuestions) hint += ' · ' + conversation.queuedQuestions + ' queued';
      pane.hint.content = draftNeedsReview ? hint : pane.sendError ?? (pane.sending ? 'Sending… · ' + hint : hint);
      pane.hint.fg = question ? COLORS.question : COLORS.muted;
    }
    for (const user of users) {
      const entry = collapsedEntries.get(user.id)!;
      const conversations = user.intents.map(({ id }) => lab.conversations.get(id)!);
      const pending = conversations.filter((conversation) => conversation.pending).length;
      const queued = conversations.reduce((sum, conversation) => sum + conversation.queuedQuestions, 0);
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
        append(sharedHistory, name + "'s agent · " + entry.action, entry.text, ACTION_COLORS[entry.action]);
      }
      a2a.title = ` A2A · ${expanded.map(({ name }) => name).join(' ↔ ')} `;
      a2a.borderColor = selected === null ? COLORS.focus : COLORS.border;
      a2a.titleColor = selected === null ? COLORS.focus : COLORS.muted;
    }
    const thinking = demo?.principals.filter((principal) => lab.activities.get(principal.id)!.negotiating.includes(demo.opportunityId)) ?? [];
    sharedActivity.visible = thinking.length > 0;
    sharedActivity.content = thinking.map((principal) => principal.name + "'s agent: Thinking…").join('\n');
    const waiting = [...lab.conversations.values()].filter((conversation) => conversation.pending).length;
    status.content = (a2a.visible ? (demo?.status ?? 'No match selected') + ' · ' : '')
      + 'Board: ' + roster.length + ' · Expanded: ' + expanded.length + ' · H2A: ' + lab.conversations.size + ' · A2A: ' + lab.negotiations.size
      + (waiting ? ' · Awaiting answers: ' + waiting : '') + (lab.agentStatus ? ' · ' + lab.agentStatus : '');
    status.fg = demo?.phase === 'error' ? '#f88a8a' : waiting ? COLORS.question : COLORS.muted;
    help.content = ' Ctrl+U: users · Ctrl+T: intent · Ctrl+O: collapse · Ctrl+G: message/answer · Tab/Shift+Tab: chat · ↑↓: choose · Enter: send · Esc: back · Ctrl+J: newline · PgUp/PgDn/wheel: scroll'
      + (a2a.visible ? ' · Ctrl+N: next match' : '') + ' · Ctrl+C: quit';
    if (selector.visible) renderSelector();
    if (preserveFocus) {
      // A visible history can belong to a pane hidden by responsive layout.
      let focused = renderer.currentFocusedRenderable;
      while (focused?.visible) {
        if (!focused.parent) return;
        focused = focused.parent;
      }
    }
    if (selector.visible) selectorList.focus();
    else if (selected === null) sharedHistory.focus();
    else {
      const pane = panes.get(users.find(({ id }) => id === selected)!.current.id)!;
      if (pane.messageMode) pane.messageInput.focus();
      else if (pane.choices.visible && !pane.editingReply) pane.choices.focus(); else pane.input.focus();
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
      const question = pane?.messageMode ? null : pane?.shownQuestion;
      if (pane && key.name === 'g' && key.ctrl) {
        key.preventDefault();
        toggleInput(pane);
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
        const option = question.options?.[pane.choiceIndex];
        if (option === undefined) pane.editingReply = true; else void send(pane, option, true);
        render();
      } else if (key.name === 'pageup' || key.name === 'pagedown') {
        key.preventDefault();
        const history = pane?.history ?? sharedHistory;
        history.scrollBy((key.name === 'pageup' ? -1 : 1) * Math.max(1, history.height - 2));
      }
    }
  };
  const refresh = () => render(true);
  renderer.keyInput.on('keypress', onKey);
  renderer.on('resize', refresh);
  lab.on('change', refresh);
  renderer.once('destroy', () => {
    lab.off('change', refresh);
    renderer.off('resize', refresh);
    renderer.keyInput.off('keypress', onKey);
  });
  render();
}
