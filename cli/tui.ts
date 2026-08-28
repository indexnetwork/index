/**
 * Two panes: the conversation on one side, the negotiation on the other.
 *
 * The agent is doing two things at once — talking to the party it acts for
 * and talking to another agent — and in one scrolling log they arrive
 * interleaved, which reads as noise. Splitting them costs a screen and a
 * line editor, and buys a view where you can watch a negotiation happen
 * while you answer a question about it.
 *
 * No dependencies: a frame is a string of escape sequences, and readline's
 * keypress events do the typing.
 */
import readline from "node:readline";
import { SPINNER, bold, clip, dim, green, indentOf, inverse, pad, width, wrap } from "./format.ts";
import type { Surface } from "./surface.ts";

const out = process.stdout;

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[K";

/** Side by side needs room for two readable columns; under that they
 * stack, which still keeps the two streams apart. */
const MIN_SIDE_BY_SIDE = 76;
const SCROLLBACK = 2000;

interface Pane {
  title: string;
  /** Unwrapped, so a resize re-wraps rather than re-flows badly. */
  entries: string[];
  /** Rows scrolled up from the bottom. 0 follows the tail. */
  scroll: number;
  /** Filled in at layout time. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export class TuiSurface implements Surface {
  private readonly panes: Record<"chat" | "negotiation", Pane> = {
    chat: { title: "chat", entries: [], scroll: 0, x: 0, y: 0, w: 0, h: 0 },
    negotiation: { title: "negotiation", entries: [], scroll: 0, x: 0, y: 0, w: 0, h: 0 },
  };

  private focus: "chat" | "negotiation" = "chat";
  private headerText = "";
  private label = "";
  private startedAt = 0;
  private frame = 0;
  private timer?: ReturnType<typeof setInterval>;

  private prompt = "";
  private input = "";
  private cursor = 0;
  private readonly history: string[] = [];
  private historyAt = -1;
  private draft = "";

  private readonly queue: string[] = [];
  private waiting?: (line: string | null) => void;
  private interrupt?: () => void;
  private ended = false;

  private readonly onKey: (character: string | undefined, key: Key) => void;
  private readonly onResize: () => void;
  private readonly onExit: () => void;

  constructor() {
    out.write(ALT_SCREEN_ON);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    this.onKey = (character, key) => this.key(character, key ?? ({} as Key));
    this.onResize = () => this.render();
    this.onExit = () => this.restore();

    process.stdin.on("keypress", this.onKey);
    out.on("resize", this.onResize);
    process.on("exit", this.onExit);

    this.render();
  }

  // --- Surface -------------------------------------------------------

  header(text: string): void {
    this.headerText = text;
    this.render();
  }

  chat(text: string): void {
    this.push("chat", text);
  }

  negotiation(text: string): void {
    this.push("negotiation", text);
  }

  onInterrupt(handler: () => void): void {
    this.interrupt = handler;
  }

  ask(promptText: string): Promise<string | null> {
    this.prompt = promptText;

    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);

    this.render();
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.(null);
  }

  start(label: string): void {
    this.label = label;
    this.startedAt = Date.now();
    this.frame = 0;
    this.timer ??= setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.render();
    }, 100);
    this.timer.unref?.();
    this.render();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.label = "";
    this.render();
  }

  close(): void {
    this.restore();
    out.write(dim(`${green("·")} bye\n`));
  }

  // --- content -------------------------------------------------------

  private push(pane: "chat" | "negotiation", text: string): void {
    const target = this.panes[pane];
    target.entries.push(text);
    if (target.entries.length > SCROLLBACK) target.entries.shift();

    // Only the pane being read stays put; the other follows its tail, so
    // scrolling back through a negotiation doesn't get yanked away.
    if (this.focus !== pane || target.scroll === 0) target.scroll = 0;
    this.render();
  }

  // --- input ---------------------------------------------------------

  private key(character: string | undefined, key: Key): void {
    if (key.ctrl && key.name === "c") {
      this.interrupt?.();
      return;
    }
    if (key.ctrl && key.name === "d") {
      if (this.input) return;
      this.ended = true;
      this.resolve(null);
      return;
    }

    switch (key.name) {
      case "return":
      case "enter":
        return this.submit();
      case "tab":
        this.focus = this.focus === "chat" ? "negotiation" : "chat";
        return this.render();
      case "pageup":
        return this.scroll(this.pane().h - 1);
      case "pagedown":
        return this.scroll(-(this.pane().h - 1));
      case "up":
        if (key.shift) return this.scroll(1);
        return this.recall(-1);
      case "down":
        if (key.shift) return this.scroll(-1);
        return this.recall(1);
      case "left":
        this.cursor = Math.max(0, this.cursor - 1);
        return this.render();
      case "right":
        this.cursor = Math.min(this.input.length, this.cursor + 1);
        return this.render();
      case "home":
        this.cursor = 0;
        return this.render();
      case "end":
        this.cursor = this.input.length;
        return this.render();
      case "backspace":
        if (this.cursor > 0) {
          this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
          this.cursor--;
        }
        return this.render();
      case "delete":
        this.input = this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
        return this.render();
    }

    if (key.ctrl) {
      switch (key.name) {
        case "a":
          this.cursor = 0;
          return this.render();
        case "e":
          this.cursor = this.input.length;
          return this.render();
        case "u":
          this.input = this.input.slice(this.cursor);
          this.cursor = 0;
          return this.render();
        case "k":
          this.input = this.input.slice(0, this.cursor);
          return this.render();
        case "w": {
          const before = this.input.slice(0, this.cursor).replace(/\s*\S+\s*$/, "");
          this.cursor = before.length;
          this.input = before + this.input.slice(this.cursor);
          return this.render();
        }
        case "l":
          return this.render();
      }
      return;
    }

    // Printable input, including a pasted chunk arriving at once.
    if (character && !key.meta && !/[\x00-\x1f\x7f]/.test(character)) {
      this.input = this.input.slice(0, this.cursor) + character + this.input.slice(this.cursor);
      this.cursor += character.length;
      this.render();
    }
  }

  private submit(): void {
    const line = this.input;
    this.input = "";
    this.cursor = 0;
    this.historyAt = -1;

    // The input line clears on submit, so the pane keeps the record. A
    // terminal that echoes for us — the line-based surface — doesn't.
    if (line.trim()) {
      this.history.push(line);
      this.push("chat", `${dim("›")} ${line}`);
    }
    this.resolve(line);
    this.render();
  }

  /** Enter with nothing waiting means the user typed ahead during a run;
   * the line queues rather than being lost. */
  private resolve(line: string | null): void {
    const waiting = this.waiting;
    this.waiting = undefined;
    if (waiting) waiting(line);
    else if (line !== null) this.queue.push(line);
  }

  private recall(direction: number): void {
    if (!this.history.length) return;
    if (this.historyAt === -1) {
      if (direction > 0) return;
      this.draft = this.input;
      this.historyAt = this.history.length;
    }

    const next = this.historyAt + direction;
    if (next >= this.history.length) {
      this.historyAt = -1;
      this.input = this.draft;
    } else {
      this.historyAt = Math.max(0, next);
      this.input = this.history[this.historyAt] ?? "";
    }
    this.cursor = this.input.length;
    this.render();
  }

  private pane(): Pane {
    return this.panes[this.focus];
  }

  private scroll(by: number): void {
    const pane = this.pane();
    const total = this.rows(pane).length;
    pane.scroll = Math.max(0, Math.min(pane.scroll + by, Math.max(0, total - pane.h)));
    this.render();
  }

  // --- drawing -------------------------------------------------------

  /** A terminal that hasn't reported its size — a pty opened without one,
   * a CI runner — reports 0 rather than nothing, so `??` isn't enough. */
  private size(): { columns: number; rows: number } {
    return {
      columns: Math.max(24, out.columns || Number(process.env.COLUMNS) || 80),
      rows: Math.max(8, out.rows || Number(process.env.LINES) || 24),
    };
  }

  private layout(): void {
    const { columns, rows } = this.size();
    const { chat, negotiation } = this.panes;

    if (columns >= MIN_SIDE_BY_SIDE) {
      const left = Math.floor((columns - 3) / 2);
      const body = Math.max(1, rows - 5);
      Object.assign(chat, { x: 0, y: 3, w: left, h: body });
      Object.assign(negotiation, { x: left + 3, y: 3, w: columns - left - 3, h: body });
      return;
    }

    // Too narrow for columns: stack them, which still keeps them apart.
    const body = Math.max(2, rows - 6);
    const top = Math.ceil(body / 2);
    Object.assign(chat, { x: 0, y: 2, w: columns, h: top });
    Object.assign(negotiation, { x: 0, y: top + 3, w: columns, h: body - top });
  }

  /** A pane's entries wrapped to its current width. */
  private rows(pane: Pane): string[] {
    const lines: string[] = [];
    for (const entry of pane.entries) {
      const hang = Math.min(indentOf(entry) + 2, Math.floor(pane.w / 3));
      lines.push(...wrap(entry, pane.w, hang));
    }
    return lines;
  }

  /** The `h` rows of a pane that are currently visible. */
  private window(pane: Pane): string[] {
    const lines = this.rows(pane);
    const end = Math.max(0, lines.length - pane.scroll);
    const start = Math.max(0, end - pane.h);
    // Padded at the top, so a short log sits against the input line rather
    // than floating at the top of the pane.
    const visible = lines.slice(start, end);
    while (visible.length < pane.h) visible.unshift("");
    return visible;
  }

  private render(): void {
    if (this.ended) return;
    this.layout();

    const { columns, rows } = this.size();
    const { chat, negotiation } = this.panes;
    const stacked = columns < MIN_SIDE_BY_SIDE;

    const frame: string[] = new Array(rows).fill("");
    frame[0] = clip(this.headerText, columns);

    const chatRows = this.window(chat);
    const negotiationRows = this.window(negotiation);

    if (stacked) {
      frame[1] = this.title(chat, columns);
      chatRows.forEach((line, i) => (frame[chat.y + i] = clip(line, columns)));
      frame[negotiation.y - 1] = this.title(negotiation, columns);
      negotiationRows.forEach((line, i) => (frame[negotiation.y + i] = clip(line, columns)));
    } else {
      frame[1] = `${this.title(chat, chat.w)}${dim(" │ ")}${this.title(negotiation, negotiation.w)}`;
      frame[2] = dim("─".repeat(columns));
      for (let i = 0; i < chat.h; i++) {
        frame[chat.y + i] =
          `${pad(chatRows[i] ?? "", chat.w)}${dim(" │ ")}${clip(negotiationRows[i] ?? "", negotiation.w)}`;
      }
    }

    frame[rows - 2] = clip(this.status(columns), columns);
    frame[rows - 1] = this.line(columns);

    let output = HIDE_CURSOR;
    for (let row = 0; row < rows; row++) {
      output += `\x1b[${row + 1};1H${frame[row] ?? ""}${CLEAR_LINE}`;
    }
    // Put the cursor where the typing is happening.
    output += `\x1b[${rows};${width(this.prompt) + this.visibleCursor() + 1}H${SHOW_CURSOR}`;
    out.write(output);
  }

  private title(pane: Pane, size: number): string {
    const focused = this.panes[this.focus] === pane;
    const behind = Math.max(0, this.rows(pane).length - pane.h - pane.scroll);
    const scrolled = pane.scroll > 0 ? ` ↓${pane.scroll}` : behind > 0 ? ` ↑${behind}` : "";
    const label = ` ${pane.title}${scrolled} `;
    return pad(focused ? inverse(bold(label)) : dim(label), size);
  }

  private status(size: number): string {
    if (this.label) {
      const seconds = Math.round((Date.now() - this.startedAt) / 1000);
      const elapsed = seconds > 1 ? ` ${seconds}s` : "";
      return dim(`${SPINNER[this.frame]} ${this.label}${elapsed}   ^C interrupt`);
    }
    const hints = "tab pane · pgup/pgdn scroll · /help · ^D exit";
    return dim(size < 60 ? "tab pane · /help · ^D exit" : hints);
  }

  /** The input line, scrolled horizontally when it outgrows the screen. */
  private line(size: number): string {
    const room = Math.max(8, size - width(this.prompt));
    const from = Math.max(0, this.cursor - room + 1);
    return `${this.prompt}${this.input.slice(from, from + room)}`;
  }

  private visibleCursor(): number {
    const room = Math.max(8, this.size().columns - width(this.prompt));
    return Math.min(this.cursor, room - 1);
  }

  private restore(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    process.stdin.off("keypress", this.onKey);
    out.off("resize", this.onResize);
    process.off("exit", this.onExit);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    out.write(`${SHOW_CURSOR}${ALT_SCREEN_OFF}`);
  }
}

interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}
