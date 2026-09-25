import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, createCliRenderer, type KeyEvent } from "@opentui/core";

import type { Inbox, Negotiation, Owner, Person, Question, Signal } from "./api";

const colors = { background: "#10151e", text: "#dce4ef", muted: "#8996aa", focus: "#77b8ff", question: "#f4c773", border: "#364255" };
type Pane = "inbox" | "radar" | "negotiation";

/** The three owner views read the same data as the macOS signal workspace. */
export async function runTui(owner: Owner): Promise<void> {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const renderer = await createCliRenderer({ useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: "disabled", backgroundColor: colors.background, onDestroy: close });
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: colors.background });
  renderer.root.add(root);
  const header = new TextRenderable(renderer, { height: 2, fg: colors.focus, wrapMode: "word" });
  root.add(header);
  const board = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, minHeight: 0, gap: 1 });
  root.add(board);

  function addPane(title: string, grow: number) {
    const box = new BoxRenderable(renderer, { title, border: true, borderColor: colors.border, flexDirection: "column", flexGrow: grow, flexBasis: 0, minWidth: 0 });
    const history = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true, stickyScroll: true, stickyStart: "bottom", contentOptions: { flexDirection: "column" } });
    box.add(history);
    board.add(box);
    return { box, history };
  }
  const inboxPane = addPane(" YOUR AGENT ", 2);
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
  const radarPane = addPane(" RADAR ", 1);
  const negotiationPane = addPane(" AGENT ↔ AGENT ", 2);
  const status = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word" });
  const help = new TextRenderable(renderer, { height: 2, fg: colors.muted, wrapMode: "word", content: " Ctrl+S signals · Tab pane · ↑↓ select · Enter send · Ctrl+Q questions · Ctrl+A accept / Ctrl+P pass · Esc cancel · Ctrl+C quit" });
  root.add(status);
  root.add(help);

  const selector = new BoxRenderable(renderer, { visible: false, position: "absolute", top: 1, left: 0, width: "100%", height: "100%", zIndex: 1, border: true, borderColor: colors.focus, backgroundColor: colors.background, flexDirection: "column" });
  const selectorList = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollY: true, contentOptions: { flexDirection: "column" } });
  selector.add(new TextRenderable(renderer, { content: " Choose a signal · ↑↓ Enter · Esc", height: 2, fg: colors.focus }));
  selector.add(selectorList);
  root.add(selector);

  let signals: Signal[] = [];
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
    negotiation = null;
    selectedPerson = selectedQuestion = selectedChoice = 0;
    confirmation = null;
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
      inbox = next;
      selectedQuestion = Math.max(0, inbox.questions.findIndex((q) => q.id === oldQuestion));
      render();
    } catch (cause) {
      if (generation !== session || inboxRequest !== version || renderer.isDestroyed) return;
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
      selectedPerson = Math.max(0, people.findIndex((p) => p.id === oldPerson));
      render();
      void refreshNegotiation();
    } catch (cause) {
      if (generation !== session || radarRequest !== version || renderer.isDestroyed) return;
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
    busy = true; render();
    try {
      if (question) await owner.sendAnswer(intentId, question.id, content);
      else await owner.sendMessage(intentId, content);
      if (signal.id === intentId && input.plainText === draft) input.clear();
      error = "";
      refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally { busy = false; render(); }
  }
  async function review(status: "accepted" | "rejected") {
    const person = activePerson();
    if (!signal || !person || person.status !== "ready" || busy) return;
    if (confirmation !== status) { confirmation = status; render(); return; }
    const intentId = signal.id;
    confirmation = null;
    busy = true; render();
    try {
      await owner.setOpportunityStatus(intentId, person.id, status);
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
    header.content = ` INDEX · ${owner.name} · ${signal ? signal.title : "no signals"} (${signal?.status || ""})`;
    for (const [name, pane] of [["inbox", inboxPane], ["radar", radarPane], ["negotiation", negotiationPane]] as const) pane.box.borderColor = focused === name ? colors.focus : colors.border;
    const messages = JSON.stringify(inbox.messages);
    if (messages !== renderedInbox) {
      renderedInbox = messages;
      clear(inboxPane.history);
      for (const message of inbox.messages) {
        const text = (message.parts || []).map((part) => part.text || "").join("\n").trim();
        if (!text || text.startsWith("Stall: ")) continue;
        const provenance = message.metadata?.principalMessage;
        const label = message.role === "user" ? "you" : provenance?.kind === "question" ? "your agent asks" : "your agent";
        line(inboxPane.history, `${label} · ${provenance?.kind || "message"}\n${text}`, message.role === "user" ? colors.text : colors.focus);
      }
      if (!inbox.messages.length) line(inboxPane.history, "Ask about your matches, share a preference, or give your agent direction for this signal.", colors.muted);
    }
    const question = activeQuestion();
    questionText.content = question ? ` ${selectedQuestion + 1}/${inbox.questions.length} · ${question.scope || "question"}: ${question.question}` : "";
    choicesText.content = question ? [...(question.options || []), "Custom reply…"].map((text, index) => ` ${selectedChoice === index ? "›" : " "} ${text}`).join("\n") : "";
    input.placeholder = question ? "Answer this question…" : "Message your agent…";
    const radar = JSON.stringify([people, selectedPerson]);
    if (radar !== renderedRadar) {
      renderedRadar = radar;
      clear(radarPane.history);
      people.forEach((person, index) => line(radarPane.history, `${index === selectedPerson ? "›" : " "} ${person.name} · ${person.status}${person.score == null ? "" : ` · ${Math.round(person.score * 100)}%`}\n  ${person.blurb}`, index === selectedPerson ? colors.focus : colors.text, `person-${index}`));
      if (!people.length) line(radarPane.history, "No opportunities yet.", colors.muted);
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
    status.content = confirmation ? ` Press Ctrl+${confirmation === "accepted" ? "A" : "P"} again to ${confirmation === "accepted" ? "accept" : "pass"} ${activePerson()?.name}; Esc cancels.`
      : error ? ` Error: ${error}` : busy ? " Sending…" : ` ${inbox.questions.length} question(s) · ${people.length} opportunities · ${activePerson()?.name || "no selection"}`;
    status.fg = confirmation || error ? colors.question : colors.muted;
    if (selector.visible) selectorList.focus();
    else if (focused === "inbox") input.focus();
    else if (focused === "radar") radarPane.history.focus();
    else negotiationPane.history.focus();
  }
  const onKey = (key: KeyEvent) => {
    if (key.name === "c" && key.ctrl) {
      key.preventDefault(); renderer.destroy();
    } else if (key.name === "s" && key.ctrl) {
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
    } else if (key.name === "tab") {
      key.preventDefault();
      const order: Pane[] = ["inbox", "radar", "negotiation"];
      focus(order[(order.indexOf(focused) + (key.shift ? 2 : 1)) % 3] || "inbox");
    } else if (focused === "radar" && (key.name === "up" || key.name === "down")) {
      key.preventDefault();
      selectedPerson = Math.max(0, Math.min(people.length - 1, selectedPerson + (key.name === "up" ? -1 : 1)));
      confirmation = null; negotiation = null; render(); void refreshNegotiation();
    } else if (focused === "radar" && key.ctrl && (key.name === "a" || key.name === "p")) {
      key.preventDefault(); void review(key.name === "a" ? "accepted" : "rejected");
    } else if (focused === "inbox" && key.name === "q" && key.ctrl) {
      key.preventDefault(); selectedQuestion = (selectedQuestion + 1) % Math.max(1, inbox.questions.length); selectedChoice = 0; render();
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
    if (["intent.created", "intent.lifecycle"].includes(event.type)) void owner.signals().then((next) => { signals = next; render(); }).catch((cause: unknown) => { error = String(cause); render(); });
  });
  const poll = setInterval(() => { refresh(); }, 5000);
  const onInterrupt = () => renderer.destroy();
  process.once("SIGINT", onInterrupt);
  try {
    signals = await owner.signals();
    if (signals[0]) switchSignal(signals[0]);
    else render();
    await closed;
  } finally {
    process.off("SIGINT", onInterrupt);
    clearInterval(poll);
    stopEvents();
    renderer.keyInput.off("keypress", onKey);
    renderer.destroy();
  }
}
