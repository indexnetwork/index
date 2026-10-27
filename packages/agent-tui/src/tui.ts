import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, createCliRenderer, type KeyEvent } from "@opentui/core";

import type { Inbox, Negotiation, Owner, Person, Question, Intent } from "./api";

const colors = { background: "#10151e", text: "#dce4ef", muted: "#8996aa", focus: "#77b8ff", question: "#f4c773", success: "#8de3b0", border: "#364255" };
type Pane = "inbox" | "radar" | "negotiation";

/** The three owner views read the same data as the macOS intent workspace. */
export async function runTui(owner: Owner): Promise<void> {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const renderer = await createCliRenderer({ useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: "disabled", backgroundColor: colors.background, onDestroy: close });
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: colors.background });
  renderer.root.add(root);
  const header = new TextRenderable(renderer, { height: 2, fg: colors.focus, wrapMode: "word" });
  const banner = new TextRenderable(renderer, { height: 1, fg: colors.question });
  root.add(header);
  root.add(banner);
  const board = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, minHeight: 0, gap: 1 });
  root.add(board);

  function addPane(title: string, grow: number) {
    const box = new BoxRenderable(renderer, { title, border: true, borderColor: colors.border, flexDirection: "column", flexGrow: grow, flexBasis: 0, minWidth: 0 });
    const history = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true, stickyScroll: true, stickyStart: "bottom", contentOptions: { flexDirection: "column" } });
    box.add(history);
    board.add(box);
    return { box, history };
  }
  const inboxPane = addPane(" H2A · YOUR AGENT ", 56);
  const questionText = new TextRenderable(renderer, { fg: colors.question, flexShrink: 0, wrapMode: "word" });
  const choicesText = new TextRenderable(renderer, { fg: colors.question, flexShrink: 0, wrapMode: "word" });
  inboxPane.box.add(questionText);
  inboxPane.box.add(choicesText);
  const input = new TextareaRenderable(renderer, {
    height: 3, flexShrink: 0, placeholder: "Message your agent…",
    keyBindings: [{ name: "return", action: "submit" }, { name: "j", ctrl: true, action: "newline" }],
    onSubmit: () => { void send(input.plainText); },
  });
  inboxPane.box.add(input);
  const radarPane = addPane(" RADAR · NEGOTIATIONS ", 44);
  const negotiationPane = addPane(" AGENT ↔ AGENT ", 30);
  const detailClose = new TextRenderable(renderer, { content: " [×] Close negotiation · Esc", height: 2, fg: colors.focus, onMouseUp: (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    closeNegotiation();
  } });
  negotiationPane.box.add(detailClose, 0);
  const status = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word" });
  const help = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word" });
  root.add(status);
  root.add(help);

  const selector = new BoxRenderable(renderer, { visible: false, position: "absolute", top: 1, left: 0, width: "100%", height: "100%", zIndex: 1, border: true, borderColor: colors.focus, backgroundColor: colors.background, flexDirection: "column" });
  const selectorList = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollY: true, contentOptions: { flexDirection: "column" } });
  selector.add(new TextRenderable(renderer, { content: " Choose an intent · ↑↓ select · Enter open · Esc close", height: 2, fg: colors.focus }));
  selector.add(selectorList);
  root.add(selector);

  let intents: Intent[] = [];
  let loadingIntents = true;
  let loadingInbox = true;
  let loadingRadar = true;
  let inboxFailed = false;
  let radarFailed = false;
  let intent: Intent | undefined;
  let inbox: Inbox = { messages: [], questions: [] };
  let people: Person[] = [];
  let negotiation: Negotiation | null = null;
  let detailPersonId: string | null = null;
  let negotiationLoading = false;
  let negotiationFailed = false;
  let focused: Pane = "inbox";
  let selectedPerson = 0;
  let selectedQuestion = 0;
  let selectedChoice = 0;
  let selectedIntent = 0;
  let busy = false;
  let error = "";
  let notice = "";
  let awaitingReply = false;
  let outgoing: { id?: string; text: string; stage: "sending" | "saved"; intentId: string } | null = null;
  let confirmation: "accepted" | "rejected" | null = null;
  let generation = 0;
  let inboxRequest = 0;
  let radarRequest = 0;
  let negotiationRequest = 0;
  let renderedInbox = "";
  let renderedRadar = "";
  let renderedNegotiation = "";

  function clear(history: ScrollBoxRenderable) {
    for (const child of [...history.getChildren()]) {
      history.remove(child);
      child.destroyRecursively();
    }
  }
  function line(history: ScrollBoxRenderable, text: string, color = colors.text, id?: string, onClick?: () => void) {
    history.add(new TextRenderable(renderer, { id, content: text, fg: color, wrapMode: "word", flexShrink: 0, marginBottom: 1,
      onMouseUp: onClick ? (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onClick();
      } : undefined,
    }));
  }
  function activeQuestion(): Question | undefined { return inbox.questions[selectedQuestion]; }
  function activePerson(): Person | undefined { return people[selectedPerson]; }
  function detailPerson(): Person | undefined { return people.find((person) => person.id === detailPersonId); }
  function openNegotiation(personId: string) {
    const index = people.findIndex((person) => person.id === personId);
    if (index < 0) return;
    selectedPerson = index;
    detailPersonId = personId;
    negotiation = null;
    negotiationLoading = true;
    negotiationFailed = false;
    error = "";
    confirmation = null;
    focused = "negotiation";
    render();
    void refreshNegotiation();
  }
  function closeNegotiation() {
    detailPersonId = null;
    negotiation = null;
    negotiationLoading = false;
    ++negotiationRequest;
    focused = "radar";
    render();
  }
  function focus(pane: Pane) {
    focused = pane;
    confirmation = null;
    render();
  }
  inboxPane.box.onMouseUp = () => focus("inbox");
  radarPane.box.onMouseUp = () => focus("radar");
  negotiationPane.box.onMouseUp = () => focus("negotiation");

  function switchIntent(next: Intent) {
    generation++;
    intent = next;
    inbox = { messages: [], questions: [] };
    people = [];
    loadingInbox = loadingRadar = true;
    inboxFailed = radarFailed = false;
    negotiation = null;
    detailPersonId = null;
    negotiationLoading = negotiationFailed = false;
    focused = "inbox";
    selectedPerson = selectedQuestion = selectedChoice = 0;
    confirmation = null;
    outgoing = null;
    awaitingReply = false;
    notice = "";
    error = "";
    input.clear();
    selector.visible = false;
    renderedInbox = renderedRadar = renderedNegotiation = "";
    render();
    void refresh();
  }

  function refresh() {
    void refreshInbox();
    void refreshRadar();
  }
  async function refreshInbox() {
    if (!intent || renderer.isDestroyed) return;
    const current = intent.id;
    const version = ++inboxRequest;
    const session = generation;
    try {
      const next = await owner.inbox(current);
      if (renderer.isDestroyed || generation !== session || inboxRequest !== version) return;
      const oldQuestion = activeQuestion()?.id;
      if (awaitingReply && next.messages.some((message) => message.role !== "user" && !inbox.messages.some((previous) => previous.id === message.id))) {
        awaitingReply = false;
        notice = "Your agent responded.";
      }
      inbox = next;
      loadingInbox = inboxFailed = false;
      if (outgoing?.id && next.messages.some((message) => message.id === outgoing?.id)) outgoing = null;
      selectedQuestion = Math.max(0, inbox.questions.findIndex((q) => q.id === oldQuestion));
      render();
    } catch (cause) {
      if (generation !== session || inboxRequest !== version || renderer.isDestroyed) return;
      loadingInbox = false;
      inboxFailed = true;
      error = cause instanceof Error ? cause.message : String(cause);
      render();
    }
  }
  async function refreshRadar() {
    if (!intent || renderer.isDestroyed) return;
    const current = intent.id;
    const version = ++radarRequest;
    const session = generation;
    try {
      const next = await owner.radar(current);
      if (renderer.isDestroyed || generation !== session || radarRequest !== version) return;
      const oldPerson = activePerson()?.id;
      people = next;
      loadingRadar = radarFailed = false;
      selectedPerson = Math.max(0, people.findIndex((p) => p.id === oldPerson));
      if (detailPersonId && !detailPerson()) closeNegotiation();
      render();
      if (detailPersonId) void refreshNegotiation();
    } catch (cause) {
      if (generation !== session || radarRequest !== version || renderer.isDestroyed) return;
      loadingRadar = false;
      radarFailed = true;
      error = cause instanceof Error ? cause.message : String(cause);
      render();
    }
  }
  async function refreshNegotiation() {
    const opportunityId = detailPersonId;
    if (!opportunityId || renderer.isDestroyed) return;
    const version = ++negotiationRequest;
    const session = generation;
    try {
      const result = await owner.negotiation(opportunityId);
      if (generation !== session || negotiationRequest !== version || detailPersonId !== opportunityId || renderer.isDestroyed) return;
      negotiation = result;
      if (negotiationFailed) error = "";
      negotiationLoading = negotiationFailed = false;
      render();
    } catch (cause) {
      if (generation !== session || negotiationRequest !== version || detailPersonId !== opportunityId || renderer.isDestroyed) return;
      negotiation = null;
      negotiationLoading = false;
      negotiationFailed = true;
      error = cause instanceof Error ? cause.message : String(cause);
      render();
    }
  }
  async function send(text: string, choice?: string) {
    const content = (choice ?? text).trim();
    if (!intent || !content || busy) return;
    const question = activeQuestion();
    const intentId = intent.id;
    const draft = input.plainText;
    outgoing = { text: content, stage: "sending", intentId: intentId };
    notice = "";
    error = "";
    busy = true; render();
    try {
      const result = (question
        ? await owner.sendAnswer(intentId, question.id, content)
        : await owner.sendMessage(intentId, content)) as { message?: { id?: string }; messages?: { id?: string }[] };
      if (intent.id !== intentId) return;
      outgoing = { text: content, stage: "saved", intentId: intentId, id: result.message?.id ?? result.messages?.[0]?.id };
      if (input.plainText === draft) input.clear();
      notice = intent.status === "paused"
        ? "Saved. Agent is on hold while paused; Ctrl+R resumes it."
        : "Saved to agent inbox. Waiting for agent activity; checking every 5s.";
      awaitingReply = true;
      refresh();
    } catch (cause) {
      if (intent.id === intentId) {
        outgoing = null;
        error = `Not sent: ${cause instanceof Error ? cause.message : String(cause)}. Your draft is still here.`;
      }
    } finally { busy = false; render(); }
  }
  async function toggleIntent() {
    if (!intent || busy) return;
    const current = intent;
    const next = current.status === "paused" ? "active" : "paused";
    busy = true; notice = `Updating intent…`; error = ""; render();
    try {
      await owner.setIntentStatus(current.id, next);
      if (intent?.id !== current.id) return;
      current.status = next;
      notice = next === "active" ? "Intent resumed. Discovery can continue." : "Intent paused. Discovery is on hold.";
      intents = intents.map((entry) => entry.id === current.id ? current : entry);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      notice = "";
    } finally { busy = false; render(); }
  }
  async function review(status: "accepted" | "rejected") {
    const person = activePerson();
    if (!intent || busy) return;
    if (!person || person.status !== "ready") {
      notice = person ? "This opportunity is not awaiting your review." : "Select an opportunity to review.";
      render();
      return;
    }
    if (confirmation !== status) { confirmation = status; render(); return; }
    const intentId = intent.id;
    confirmation = null;
    busy = true; render();
    try {
      await owner.setOpportunityStatus(intentId, person.id, status);
      notice = status === "accepted" ? "Opportunity accepted." : "Opportunity passed.";
      error = "";
      refresh();
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; render(); }
  }
  function renderSelector() {
    clear(selectorList);
    intents.forEach((entry, index) => line(selectorList, `${index === selectedIntent ? "›" : " "} ${entry.title} · ${entry.status} · ${entry.pending} awaiting you`, index === selectedIntent ? colors.focus : colors.text, `intent-${index}`));
    selectorList.scrollChildIntoView(`intent-${selectedIntent}`);
  }
  function render() {
    if (renderer.isDestroyed) return;
    const host = new URL(owner.apiUrl).hostname;
    const title = intent?.title || "No intent selected";
    const maxTitle = Math.max(12, renderer.terminalWidth - 12);
    header.content = ` INDEX  /  ${owner.name}  /  ${host}\n Intent: ${title.slice(0, maxTitle)}${title.length > maxTitle ? "…" : ""}`;
    banner.content = loadingIntents ? " ● Loading intents…" : !intent ? " ● No intent · Ctrl+X to choose." : intent.status === "paused" ? " ● paused · Agent on hold · Ctrl+R resume" : " ● active · Updates every 5s · Ctrl+R pause";
    banner.fg = intent?.status === "paused" || !intent ? colors.question : colors.success;
    const wide = renderer.terminalWidth >= 115;
    inboxPane.box.visible = true;
    radarPane.box.visible = !detailPersonId || wide;
    negotiationPane.box.visible = !!detailPersonId;
    inboxPane.box.flexGrow = detailPersonId && wide ? 40 : 56;
    radarPane.box.flexGrow = detailPersonId && wide ? 30 : 44;
    negotiationPane.box.flexGrow = detailPersonId && wide ? 30 : 44;
    for (const [name, pane] of [["inbox", inboxPane], ["radar", radarPane], ["negotiation", negotiationPane]] as const) pane.box.borderColor = focused === name ? colors.focus : colors.border;
    const messages = JSON.stringify([inbox.messages, outgoing, loadingInbox, inboxFailed, intent?.status]);
    if (messages !== renderedInbox) {
      renderedInbox = messages;
      clear(inboxPane.history);
      for (const message of inbox.messages) {
        const text = (message.parts || []).map((part) => part.text || "").join("\n").trim();
        if (!text) continue;
        const provenance = message.metadata?.principalMessage;
        const label = message.role === "user" ? "YOU" : provenance?.kind === "question" ? "? YOUR AGENT ASKS" : "YOUR AGENT";
        line(inboxPane.history, `${label}\n${text}`, message.role === "user" ? colors.text : colors.focus);
      }
      if (outgoing && outgoing.intentId === intent?.id) {
        line(inboxPane.history, `YOU · ${outgoing.stage === "sending" ? "SENDING…" : "SAVED ON SERVER"}\n${outgoing.text}`, colors.question);
      } else if (inbox.messages.at(-1)?.role === "user") {
        line(inboxPane.history, intent?.status === "paused" ? "Agent on hold while paused · Ctrl+R resumes." : "No agent response yet · updates every 5s.", colors.muted);
      }
      if (!inbox.messages.length && !outgoing) line(inboxPane.history, loadingInbox ? "Loading agent messages…" : inboxFailed ? "Could not load messages. Retrying…" : "No messages yet. Share what you need from your agent below.", colors.muted);
    }
    const question = activeQuestion();
    questionText.content = question ? ` ${selectedQuestion + 1}/${inbox.questions.length} · ${question.scope || "question"}: ${question.question}` : "";
    choicesText.content = question ? [...(question.options || []), "Custom reply…"].map((text, index) => ` ${selectedChoice === index ? "›" : " "} ${text}`).join("\n") : "";
    input.placeholder = question ? "Answer the selected question…" : "Message your agent…";
    const radar = JSON.stringify([people, selectedPerson, intent?.status, loadingRadar, radarFailed]);
    if (radar !== renderedRadar) {
      renderedRadar = radar;
      clear(radarPane.history);
      people.forEach((person, index) => {
        const stage = person.status === "passed" || person.status === "rejected" ? "not a fit" : person.status;
        line(radarPane.history, `${index === selectedPerson ? "›" : " "} ${person.name} · ${stage}${person.score == null ? "" : ` · ${Math.round(person.score * 100)}%`}\n  ${person.blurb}\n  [Negotiation ›]`, index === selectedPerson ? colors.focus : colors.text, `person-${index}`, () => openNegotiation(person.id));
      });
      if (!people.length) line(radarPane.history, loadingRadar ? "Loading opportunities…" : radarFailed ? "Could not load opportunities. Retrying…" : intent?.status === "paused" ? "No opportunities yet. Discovery is paused; Ctrl+R resumes it." : "No opportunities yet. Your agent's matches will appear here.", colors.muted);
      else radarPane.history.scrollChildIntoView(`person-${selectedPerson}`);
    }
    const transcript = JSON.stringify([detailPersonId, detailPerson(), negotiation, negotiationLoading, negotiationFailed]);
    if (transcript !== renderedNegotiation) {
      renderedNegotiation = transcript;
      clear(negotiationPane.history);
      const person = detailPerson();
      if (person) line(negotiationPane.history, `Your agent ↔ ${person.name.split(" ")[0]}'s agent\n${person.detail || person.blurb}`, colors.focus);
      for (const turn of negotiation?.turns || []) line(negotiationPane.history, `${turn.seatUserId === owner.userId ? "your agent" : `${person?.name || "their"}'s agent`} · ${turn.action}\n${turn.message}`);
      if (negotiation?.outcome) line(negotiationPane.history, `Outcome: ${negotiation.outcome}`, colors.question);
      else if (!negotiation?.turns.length) line(negotiationPane.history, negotiationLoading ? "Loading negotiation…" : negotiationFailed ? "Could not load negotiation. Retrying…" : "No negotiation turns yet.", colors.muted);
    }
    let idleStatus = ` ● ${inbox.questions.length} questions · ${people.length} opportunities · ${activePerson()?.name || "no match selected"}`;
    if (focused === "inbox" && inbox.messages.at(-1)?.role === "user") {
      idleStatus = intent?.status === "paused" ? " ● Agent on hold while paused · Ctrl+R resumes." : " ● Latest message is yours; no agent response yet.";
    }
    status.content = confirmation ? ` Press ${confirmation === "accepted" ? "a" : "x"} again to ${confirmation === "accepted" ? "accept" : "pass"} ${activePerson()?.name}; Esc cancels.`
      : error ? ` ● ${error}` : notice ? ` ● ${notice}` : busy ? " ● Working…" : loadingIntents || loadingInbox || loadingRadar ? " ● Loading live data…" : idleStatus;
    status.fg = confirmation || error ? colors.question : notice ? colors.success : colors.muted;
    help.content = focused === "inbox"
      ? " Tab panes · Ctrl+X intents · Ctrl+C quit\n ←→ questions · ↑↓ options · Enter send"
      : focused === "radar"
        ? " Tab panes · ↑↓ select · Enter negotiation\n a accept · x pass · Ctrl+C quit"
        : " Esc close · Tab panes · PgUp/PgDn\n Ctrl+C quit";
    if (selector.visible) selectorList.focus();
    else if (focused === "inbox") input.focus();
    else if (focused === "radar") radarPane.history.focus();
    else negotiationPane.history.focus();
  }
  const onKey = (key: KeyEvent) => {
    if (key.name === "c" && key.ctrl) {
      key.preventDefault(); renderer.destroy();
    } else if (key.name === "x" && key.ctrl) {
      key.preventDefault();
      selector.visible = !selector.visible;
      if (selector.visible) { selectedIntent = Math.max(0, intents.findIndex((entry) => entry.id === intent?.id)); renderSelector(); }
      render();
    } else if (selector.visible) {
      key.preventDefault();
      if (key.name === "escape") selector.visible = false;
      else if (key.name === "up" || key.name === "down") {
        selectedIntent = Math.max(0, Math.min(intents.length - 1, selectedIntent + (key.name === "up" ? -1 : 1)));
        renderSelector();
      } else if (key.name === "return") {
        const next = intents[selectedIntent];
        if (next) switchIntent(next);
      }
      render();
    } else if (key.name === "escape" && confirmation) {
      key.preventDefault(); confirmation = null; render();
    } else if (key.name === "escape" && detailPersonId && focused === "negotiation") {
      key.preventDefault(); closeNegotiation();
    } else if (key.name === "r" && key.ctrl) {
      key.preventDefault(); void toggleIntent();
    } else if (key.name === "tab") {
      key.preventDefault();
      const order: Pane[] = ["inbox", ...(!detailPersonId || renderer.terminalWidth >= 115 ? ["radar" as const] : []), ...(detailPersonId ? ["negotiation" as const] : [])];
      focus(order[(order.indexOf(focused) + (key.shift ? order.length - 1 : 1)) % order.length] || "inbox");
    } else if (focused === "radar" && (key.name === "up" || key.name === "down")) {
      key.preventDefault();
      selectedPerson = Math.max(0, Math.min(people.length - 1, selectedPerson + (key.name === "up" ? -1 : 1)));
      confirmation = null; render();
    } else if (focused === "radar" && key.name === "return") {
      key.preventDefault();
      const person = activePerson();
      if (person) openNegotiation(person.id);
    } else if (focused === "radar" && !key.ctrl && !key.meta && (key.name === "a" || key.name === "x")) {
      key.preventDefault(); void review(key.name === "a" ? "accepted" : "rejected");
    } else if (focused === "inbox" && inbox.questions.length > 0 && !input.plainText && (key.name === "left" || key.name === "right")) {
      key.preventDefault();
      selectedQuestion = (selectedQuestion + (key.name === "right" ? 1 : inbox.questions.length - 1)) % inbox.questions.length;
      selectedChoice = 0;
      render();
    } else if (focused === "inbox" && activeQuestion() && !input.plainText && (key.name === "up" || key.name === "down")) {
      key.preventDefault(); selectedChoice = Math.max(0, Math.min((activeQuestion()?.options?.length || 0), selectedChoice + (key.name === "up" ? -1 : 1))); render();
    } else if (focused === "inbox" && activeQuestion() && !input.plainText && key.name === "return") {
      key.preventDefault(); const choice = activeQuestion()?.options?.[selectedChoice];
      if (choice) void send("", choice); else input.focus();
    } else if (key.name === "pageup" || key.name === "pagedown") {
      key.preventDefault();
      const history = focused === "inbox" ? inboxPane.history : focused === "radar" ? radarPane.history : negotiationPane.history;
      history.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(1, history.height - 2));
    }
  };
  renderer.keyInput.on("keypress", onKey);
  const stopEvents = owner.events((event) => {
    if (!intent) return;
    if (event.type === "message" && event.message?.metadata?.intentId === intent.id || event.type === "question.pending" && event.data?.intentId === intent.id) void refreshInbox();
    if (event.data?.intentId === intent.id && ["negotiation.changed", "negotiation.turn"].includes(event.type)) void refreshRadar();
    if (["intent.created", "intent.lifecycle"].includes(event.type)) void owner.intents().then((next) => {
      intents = next;
      intent = next.find((entry) => entry.id === intent?.id) || intent;
      render();
    }).catch((cause: unknown) => { error = String(cause); render(); });
  });
  const poll = setInterval(() => { refresh(); }, 5000);
  const onInterrupt = () => renderer.destroy();
  process.once("SIGINT", onInterrupt);
  try {
    render();
    intents = await owner.intents();
    loadingIntents = false;
    if (intents[0]) switchIntent(intents[0]);
    else { loadingInbox = loadingRadar = false; render(); }
    await closed;
  } finally {
    process.off("SIGINT", onInterrupt);
    clearInterval(poll);
    stopEvents();
    renderer.keyInput.off("keypress", onKey);
    renderer.destroy();
  }
}
