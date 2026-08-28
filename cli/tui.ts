/**
 * The console screen: a column per party, a shared wire, one input line.
 *
 * The layout follows what a test session actually needs. Conversations are
 * private to a party, so they get columns. A2A traffic happens *between*
 * parties, so it gets one shared pane — showing an exchange once,
 * attributed, rather than twice from two points of view.
 *
 * No dependencies: a frame is a string of escape sequences, and readline's
 * keypress events do the typing.
 */
import readline from "node:readline";
import { BOX, SPINNER, bold, clip, dim, indentOf, inverse, pad, width, wrap } from "./format.ts";

const out = process.stdout;

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[K";

/** Below this a column stops being readable, so fewer are shown. */
const MIN_COLUMN = 26;
const SCROLLBACK = 2000;

export interface ViewParty {
  name: string;
  intent?: string;
  /** This party's conversation, newest last. */
  lines: string[];
  paint: (text: string) => string;
  busy?: { label: string; since: number };
  pending?: boolean;
}

export interface View {
  title: string;
  parties: ViewParty[];
  /** Shared A2A traffic. */
  wire: string[];
  focus: number;
  /** What the input line is prefixed with. */
  prompt: string;
}

export interface TuiHandlers {
  view: () => View;
  submit: (line: string) => void;
  /** Tab: move focus by one. */
  focus: (delta: number) => void;
  interrupt: () => void;
  eof: () => void;
}

export class Tui {
  private input = "";
  private cursor = 0;
  private readonly history: string[] = [];
  private historyAt = -1;
  private draft = "";
  /** Rows scrolled up from the bottom, per column and for the wire. */
  private readonly scroll = new Map<string, number>();
  private wireScroll = 0;
  private frame = 0;
  private timer?: ReturnType<typeof setInterval>;

  private readonly onKey: (character: string | undefined, key: Key) => void;
  private readonly onResize: () => void;
  private readonly onExit: () => void;

  constructor(private readonly handlers: TuiHandlers) {
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

    // One ticker for every spinner on screen, so several parties can be
    // working at once without each keeping its own timer.
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      if (this.handlers.view().parties.some((party) => party.busy)) this.render();
    }, 100);
    this.timer.unref?.();

    this.render();
  }

  close(): void {
    this.restore();
  }

  // --- input ---------------------------------------------------------

  private key(character: string | undefined, key: Key): void {
    if (key.ctrl && key.name === "c") return this.handlers.interrupt();
    if (key.ctrl && key.name === "d") {
      if (!this.input) this.handlers.eof();
      return;
    }

    switch (key.name) {
      case "return":
      case "enter":
        return this.submit();
      case "tab":
        this.handlers.focus(key.shift ? -1 : 1);
        return this.render();
      case "pageup":
        return this.scrollBy(this.columnKey(), 6);
      case "pagedown":
        return this.scrollBy(this.columnKey(), -6);
      case "up":
        if (key.shift) return this.scrollWire(3);
        return this.recall(-1);
      case "down":
        if (key.shift) return this.scrollWire(-3);
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
    if (line.trim()) this.history.push(line);
    this.handlers.submit(line);
    this.render();
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

  private columnKey(): string {
    const view = this.handlers.view();
    return view.parties[view.focus]?.name ?? "";
  }

  private scrollBy(key: string, by: number): void {
    this.scroll.set(key, Math.max(0, (this.scroll.get(key) ?? 0) + by));
    this.render();
  }

  private scrollWire(by: number): void {
    this.wireScroll = Math.max(0, this.wireScroll + by);
    this.render();
  }

  // --- drawing -------------------------------------------------------

  private size(): { columns: number; rows: number } {
    return {
      columns: Math.max(30, out.columns || Number(process.env.COLUMNS) || 80),
      rows: Math.max(12, out.rows || Number(process.env.LINES) || 24),
    };
  }

  /** Which parties fit, kept centred on the focused one. */
  private visible(view: View, columns: number): ViewParty[] {
    if (!view.parties.length) return [];
    const fit = Math.max(1, Math.floor((columns + 3) / (MIN_COLUMN + 3)));
    if (view.parties.length <= fit) return view.parties;

    const start = Math.min(
      Math.max(0, view.focus - Math.floor((fit - 1) / 2)),
      view.parties.length - fit,
    );
    return view.parties.slice(start, start + fit);
  }

  /** Wraps a log to a width and takes the visible window, bottom-anchored. */
  private window(lines: string[], size: number, height: number, scrolled: number): string[] {
    const wrapped: string[] = [];
    for (const line of lines.slice(-SCROLLBACK)) {
      wrapped.push(...wrap(line, size, Math.min(indentOf(line) + 2, Math.floor(size / 3))));
    }

    const end = Math.max(0, wrapped.length - scrolled);
    const start = Math.max(0, end - height);
    const visible = wrapped.slice(start, end);
    while (visible.length < height) visible.unshift("");
    return visible;
  }

  render(): void {
    const view = this.handlers.view();
    const { columns, rows } = this.size();
    const parties = this.visible(view, columns);

    // Chrome: title, names, intents, rule, rule, wire title, rule, hints,
    // input. Everything left over is split between the columns and the wire.
    const body = Math.max(2, rows - 9);
    const wireHeight = Math.max(3, Math.min(8, Math.floor(body * 0.35)));
    const chatHeight = Math.max(1, body - wireHeight);

    // Every cell carries its own left margin, so the first column lines up
    // with the ones that get theirs from the divider.
    const count = Math.max(1, parties.length);
    const columnWidth = Math.max(MIN_COLUMN, Math.floor((columns - (count - 1)) / count));
    const divider = dim(BOX.v);
    const cell = (text: string) => pad(` ${text}`, columnWidth);

    const frame: string[] = [];
    frame.push(dim(clip(view.title, columns)));

    // Column headings: name, then what it's working on.
    const focused = view.parties[view.focus];
    frame.push(
      parties
        .map((party) => {
          const label = `${party.name}${party.pending ? " ?" : ""}`;
          return cell(party === focused ? inverse(bold(party.paint(` ${label} `))) : party.paint(label));
        })
        .join(divider),
    );
    frame.push(
      parties.map((party) => cell(dim(party.intent ?? "no intent"))).join(divider),
    );
    frame.push(dim(BOX.h.repeat(columns)));

    const bodies = parties.map((party) =>
      this.window(
        party.busy
          ? [...party.lines, dim(`${SPINNER[this.frame]} ${party.busy.label}${elapsed(party.busy.since)}`)]
          : party.lines,
        columnWidth - 1,
        chatHeight,
        this.scroll.get(party.name) ?? 0,
      ),
    );
    for (let row = 0; row < chatHeight; row++) {
      frame.push(bodies.map((lines) => cell(lines[row] ?? "")).join(divider));
    }

    frame.push(dim(BOX.h.repeat(columns)));
    frame.push(dim(` wire${this.wireScroll ? ` ↓${this.wireScroll}` : ""}`));
    for (const line of this.window(view.wire, columns - 1, wireHeight, this.wireScroll)) {
      frame.push(` ${clip(line, columns - 1)}`);
    }

    frame.push(dim(BOX.h.repeat(columns)));
    frame.push(
      dim(
        clip(
          " tab agent · shift-tab back · pgup/pgdn scroll · shift-↑/↓ wire · /help · ^D exit",
          columns,
        ),
      ),
    );
    frame.push(this.line(columns, view.prompt));

    let output = HIDE_CURSOR;
    for (let row = 0; row < rows; row++) {
      output += `\x1b[${row + 1};1H${frame[row] ?? ""}${CLEAR_LINE}`;
    }
    output += `\x1b[${rows};${width(view.prompt) + this.visibleCursor(columns, view.prompt) + 1}H${SHOW_CURSOR}`;
    out.write(output);
  }

  private line(size: number, prompt: string): string {
    const room = Math.max(8, size - width(prompt));
    const from = Math.max(0, this.cursor - room + 1);
    return `${prompt}${this.input.slice(from, from + room)}`;
  }

  private visibleCursor(size: number, prompt: string): number {
    const room = Math.max(8, size - width(prompt));
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

function elapsed(since: number): string {
  const seconds = Math.round((Date.now() - since) / 1000);
  return seconds > 1 ? ` ${seconds}s` : "";
}

interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}
