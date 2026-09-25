import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, createCliRenderer, type KeyEvent } from "@opentui/core";

import type { Inbox, Negotiation, Owner, Person, Question, Signal } from "./api";

const colors = { background: "#10151e", text: "#dce4ef", muted: "#8996aa", focus: "#77b8ff", question: "#f4c773", success: "#8de3b0", border: "#364255" };
type Pane = "inbox" | "radar" | "negotiation";

/** The three owner views read the same data as the macOS signal workspace. */
export async function runTui(owner: Owner): Promise<void> {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const renderer = await createCliRenderer({ useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: "disabled", backgroundColor: colors.background, onDestroy: close });
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: colors.background });
  renderer.root.add(root);
  const header = new TextRenderable(renderer, { height: 2, fg: colors.focus, wrapMode: "word" });
  const banner = new TextRenderable(renderer, { height: 1, fg: colors.question });
  const tabs = new TextRenderable(renderer, { height: 1, fg: colors.text });
  root.add(header);
  root.add(banner);
  root.add(tabs);
  const board = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, minHeight: 0 });
  root.add(board);

  function addPane(title: string) {
    const box = new BoxRenderable(renderer, { title, border: true, borderColor: colors.border, flexDirection: "column", flexGrow: 1, minHeight: 0 });
    const history = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true, stickyScroll: true, stickyStart: "bottom", contentOptions: { flexDirection: "column" } });
    box.add(history);
    board.add(box);
    return { box, history };
  }
  const inboxPane = addPane(" YOUR AGENT ");
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
  const radarPane = addPane(" RADAR ");
  const negotiationPane = addPane(" AGENT ↔ AGENT ");
  const status = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word" });
  const help = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word" });
  root.add(status);
  root.add(help);

  const selector = new BoxRenderable(renderer, { visible: false, position: "absolute", top: 1, left: 0, width: "100%", height: "100%", zIndex: 1, border: true, borderColor: colors.focus, backgroundColor: colors.background, flexDirection: "column" });
  const selectorList = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollY: true, contentOptions: { flexDirection: "column" } });
  selector.add(new TextRenderable(renderer, { content: " Choose a signal · ↑↓ select · Enter open · Esc close", height: 2, fg: colors.focus }));
  selector.add(selectorList);
  root.add(selector);

  let signals: Signal[] = [];
  let loadingSignals = true;
  let loadingInbox = true;
  let loadingRadar = true;
  let inboxFailed = false;
  let radarFailed = false;
  let signal: Signal | undefined;
  let inbox: Inbox = { messages: [], questions: [] };
  let people: Person[] = [];
  let negotiation: Negotiation | null = null;
  let focused: Pane = "inbox";
  let selectedPerson = 0;
  let selectedQuestion = 0;
  let selectedChoice = 0;
  let selectedSignal = 0;
  let busy = false;
  let error = "";
  let notice = "";
  let awaitingReply = false;
  let outgoing: { id?: string; text: string; stage: "sending" | "saved"; signalId: string } | null = null;
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
  function line(history: ScrollBoxRenderable, text: string, color = colors.text, id?: string) {
    history.add(new TextRenderable(renderer, { id, content: text, fg: color, wrapMode: "word", flexShrink: 0, marginBottom: 1 }));
  }
  function activeQuestion(): Question | undefined { return inbox.questions[selectedQuestion]; }
  function activePerson(): Person | undefined { return people[selectedPerson]; }
  function focus(pane: Pane) {
    focused = pane;
    render();
  }
  function switchSignal(next: Signal) {
    generation++;
    signal = next;
    inbox = { messages: [], questions: [] };
    people = [];
    loadingInbox = loadingRadar = true;
    inboxFailed = radarFailed = false;
    negotiation = null;
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
    if (!signal || renderer.isDestroyed) return;
    const current = signal.id;
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
    if (!signal || renderer.isDestroyed) return;
    const current = signal.id;
    const version = ++radarRequest;
    const session = generation;
    try {
      const next = await owner.radar(current);
      if (renderer.isDestroyed || generation !== session || radarRequest !== version) return;
      const oldPerson = activePerson()?.id;
      people = next;
      loadingRadar = radarFailed = false;
      selectedPerson = Math.max(0, people.findIndex((p) => p.id === oldPerson));
      render();
      void refreshNegotiation();
    } catch (cause) {
      if (generation !== session || radarRequest !== version || renderer.isDestroyed) return;
      loadingRadar = false;
      radarFailed = true;
      error = cause instanceof Error ? cause.message : String(cause);
      render();
    }
  }
  async function refreshNegotiation() {
    const opportunityId = activePerson()?.id;
    const version = ++negotiationRequest;
    const session = generation;
    if (!opportunityId) { negotiation = null; render(); return; }
    try {
      const result = await owner.negotiation(opportunityId);
      if (generation !== session || negotiationRequest !== version || activePerson()?.id !== opportunityId || renderer.isDestroyed) return;
      negotiation = result;
      render();
    } catch (cause) {
      if (generation !== session || negotiationRequest !== version || activePerson()?.id !== opportunityId || renderer.isDestroyed) return;
      negotiation = null;
      error = cause instanceof Error ? cause.message : String(cause);
      render();
    }
  }
  async function send(text: string, choice?: string) {
    const content = (choice ?? text).trim();
    if (!signal || !content || busy) return;
    const question = activeQuestion();
    const intentId = signal.id;
    const draft = input.plainText;
    outgoing = { text: content, stage: "sending", signalId: intentId };
    notice = "";
    error = "";
    busy = true; render();
    try {
      const result = (question
        ? await owner.sendAnswer(intentId, question.id, content)
        : await owner.sendMessage(intentId, content)) as { message?: { id?: string }; messages?: { id?: string }[] };
      if (signal.id !== intentId) return;
      outgoing = { text: content, stage: "saved", signalId: intentId, id: result.message?.id ?? result.messages?.[0]?.id };
      if (input.plainText === draft) input.clear();
      notice = signal.status === "paused"
        ? "Saved. Agent is on hold while paused; Ctrl+R resumes it."
        : "Saved to agent inbox. Waiting for agent activity; checking every 5s.";
      awaitingReply = true;
      refresh();
    } catch (cause) {
      if (signal.id === intentId) {
        outgoing = null;
        error = `Not sent: ${cause instanceof Error ? cause.message : String(cause)}. Your draft is still here.`;
      }
    } finally { busy = false; render(); }
  }
  async function toggleSignal() {
    if (!signal || busy) return;
    const current = signal;
    const next = current.status === "paused" ? "ACTIVE" : "PAUSED";
    busy = true; notice = `Updating signal…`; error = ""; render();
    try {
      await owner.setSignalStatus(current.id, next);
      if (signal?.id !== current.id) return;
      current.status = next === "ACTIVE" ? "active" : "paused";
      notice = next === "ACTIVE" ? "Signal resumed. Discovery can continue." : "Signal paused. Discovery is on hold.";
      signals = signals.map((entry) => entry.id === current.id ? current : entry);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      notice = "";
    } finally { busy = false; render(); }
  }
  async function review(status: "accepted" | "rejected") {
    const person = activePerson();
    if (!signal || busy) return;
    if (!person || person.status !== "ready") {
      notice = person ? "This opportunity is not awaiting your review." : "Select an opportunity to review.";
      render();
      return;
    }
    if (confirmation !== status) { confirmation = status; render(); return; }
    const intentId = signal.id;
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
    signals.forEach((entry, index) => line(selectorList, `${index === selectedSignal ? "›" : " "} ${entry.title} · ${entry.status} · ${entry.pending} awaiting you`, index === selectedSignal ? colors.focus : colors.text, `signal-${index}`));
    selectorList.scrollChildIntoView(`signal-${selectedSignal}`);
  }
  function render() {
    if (renderer.isDestroyed) return;
    const host = new URL(owner.apiUrl).hostname;
    const title = signal?.title || "No signal selected";
    const maxTitle = Math.max(12, renderer.terminalWidth - 12);
    header.content = ` INDEX  /  ${owner.name}  /  ${host}\n Signal: ${title.slice(0, maxTitle)}${title.length > maxTitle ? "…" : ""}`;
    banner.content = loadingSignals ? " ● Loading signals…" : !signal ? " ● No signal · Ctrl+X to choose." : signal.status === "paused" ? " ● PAUSED · Agent on hold · Ctrl+R resume" : " ● ACTIVE · Updates every 5s · Ctrl+R pause";
    banner.fg = signal?.status === "paused" || !signal ? colors.question : colors.success;
    tabs.content = ` ${focused === "inbox" ? "▶" : " "} Agent    ${focused === "radar" ? "▶" : " "} Radar (${people.length})    ${focused === "negotiation" ? "▶" : " "} Negotiation`;
    for (const [name, pane] of [["inbox", inboxPane], ["radar", radarPane], ["negotiation", negotiationPane]] as const) pane.box.visible = focused === name;
    const messages = JSON.stringify([inbox.messages, outgoing, loadingInbox, inboxFailed, signal?.status]);
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
      if (outgoing && outgoing.signalId === signal?.id) {
        line(inboxPane.history, `YOU · ${outgoing.stage === "sending" ? "SENDING…" : "SAVED ON SERVER"}\n${outgoing.text}`, colors.question);
      } else if (inbox.messages.at(-1)?.role === "user") {
        line(inboxPane.history, signal?.status === "paused" ? "Agent on hold while paused · Ctrl+R resumes." : "No agent response yet · updates every 5s.", colors.muted);
      }
      if (!inbox.messages.length && !outgoing) line(inboxPane.history, loadingInbox ? "Loading agent messages…" : inboxFailed ? "Could not load messages. Retrying…" : "No messages yet. Share what you need from your agent below.", colors.muted);
    }
    const question = activeQuestion();
    questionText.content = question ? ` ${selectedQuestion + 1}/${inbox.questions.length} · ${question.scope || "question"}: ${question.question}` : "";
    choicesText.content = question ? [...(question.options || []), "Custom reply…"].map((text, index) => ` ${selectedChoice === index ? "›" : " "} ${text}`).join("\n") : "";
    input.placeholder = question ? "Answer the selected question…" : "Message your agent…";
    const radar = JSON.stringify([people, selectedPerson, signal?.status, loadingRadar, radarFailed]);
    if (radar !== renderedRadar) {
      renderedRadar = radar;
      clear(radarPane.history);
      people.forEach((person, index) => line(radarPane.history, `${index === selectedPerson ? "›" : " "} ${person.name} · ${person.status}${person.score == null ? "" : ` · ${Math.round(person.score * 100)}%`}\n  ${person.blurb}`, index === selectedPerson ? colors.focus : colors.text, `person-${index}`));
      if (!people.length) line(radarPane.history, loadingRadar ? "Loading opportunities…" : radarFailed ? "Could not load opportunities. Retrying…" : signal?.status === "paused" ? "No opportunities yet. Discovery is paused; Ctrl+R resumes it." : "No opportunities yet. Your agent's matches will appear here.", colors.muted);
      else radarPane.history.scrollChildIntoView(`person-${selectedPerson}`);
    }
    const transcript = JSON.stringify([activePerson()?.id, negotiation]);
    if (transcript !== renderedNegotiation) {
      renderedNegotiation = transcript;
      clear(negotiationPane.history);
      const person = activePerson();
      if (person) line(negotiationPane.history, `${person.name} · ${person.status}\n${person.detail || person.blurb}`, colors.focus);
      for (const turn of negotiation?.turns || []) line(negotiationPane.history, `${turn.seatUserId === owner.userId ? "your agent" : `${person?.name || "their"}'s agent`} · ${turn.action}\n${turn.message}`);
      if (negotiation?.outcome) line(negotiationPane.history, `Outcome: ${negotiation.outcome}`, colors.question);
      else if (!negotiation?.turns.length) line(negotiationPane.history, person ? "No negotiation turns yet." : "Select a radar opportunity.", colors.muted);
    }
    let idleStatus = ` ● ${inbox.questions.length} questions · ${people.length} opportunities · ${activePerson()?.name || "no match selected"}`;
    if (focused === "inbox" && inbox.messages.at(-1)?.role === "user") {
      idleStatus = signal?.status === "paused" ? " ● Agent on hold while paused · Ctrl+R resumes." : " ● Latest message is yours; no agent response yet.";
    }
    status.content = confirmation ? ` Press ${confirmation === "accepted" ? "a" : "x"} again to ${confirmation === "accepted" ? "accept" : "pass"} ${activePerson()?.name}; Esc cancels.`
      : error ? ` ● ${error}` : notice ? ` ● ${notice}` : busy ? " ● Working…" : loadingSignals || loadingInbox || loadingRadar ? " ● Loading live data…" : idleStatus;
    status.fg = confirmation || error ? colors.question : notice ? colors.success : colors.muted;
    help.content = focused === "inbox"
      ? " Tab views · Ctrl+X signals · Ctrl+C quit\n ←→ questions · ↑↓ options · Enter send"
      : focused === "radar"
        ? " Tab views · Ctrl+X signals · ↑↓ select\n a accept · x pass · Esc cancel · Ctrl+C"
        : " Tab views · Ctrl+X signals · PgUp/PgDn\n Ctrl+C quit";
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
      if (selector.visible) { selectedSignal = Math.max(0, signals.findIndex((entry) => entry.id === signal?.id)); renderSelector(); }
      render();
    } else if (selector.visible) {
      key.preventDefault();
      if (key.name === "escape") selector.visible = false;
      else if (key.name === "up" || key.name === "down") {
        selectedSignal = Math.max(0, Math.min(signals.length - 1, selectedSignal + (key.name === "up" ? -1 : 1)));
        renderSelector();
      } else if (key.name === "return") {
        const next = signals[selectedSignal];
        if (next) switchSignal(next);
      }
      render();
    } else if (key.name === "escape" && confirmation) {
      key.preventDefault(); confirmation = null; render();
    } else if (key.name === "r" && key.ctrl) {
      key.preventDefault(); void toggleSignal();
    } else if (key.name === "tab") {
      key.preventDefault();
      const order: Pane[] = ["inbox", "radar", "negotiation"];
      focus(order[(order.indexOf(focused) + (key.shift ? 2 : 1)) % 3] || "inbox");
    } else if (focused === "radar" && (key.name === "up" || key.name === "down")) {
      key.preventDefault();
      selectedPerson = Math.max(0, Math.min(people.length - 1, selectedPerson + (key.name === "up" ? -1 : 1)));
      confirmation = null; negotiation = null; render(); void refreshNegotiation();
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
    if (!signal) return;
    if (event.type === "message" && event.message?.metadata?.intentId === signal.id || event.type === "question.pending" && event.data?.intentId === signal.id) void refreshInbox();
    if (event.data?.intentId === signal.id && ["negotiation.changed", "negotiation.turn"].includes(event.type)) void refreshRadar();
    if (["intent.created", "intent.lifecycle"].includes(event.type)) void owner.signals().then((next) => {
      signals = next;
      signal = next.find((entry) => entry.id === signal?.id) || signal;
      render();
    }).catch((cause: unknown) => { error = String(cause); render(); });
  });
  const poll = setInterval(() => { refresh(); }, 5000);
  const onInterrupt = () => renderer.destroy();
  process.once("SIGINT", onInterrupt);
  try {
    render();
    signals = await owner.signals();
    loadingSignals = false;
    if (signals[0]) switchSignal(signals[0]);
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
