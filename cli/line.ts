/**
 * The fallback surface: one stream of lines, for pipes and scripts.
 *
 * `bun run chat < script.txt` and the examples run through this. Negotiation
 * lines are indented rather than given a pane, since there is no screen to
 * divide.
 */
import readline from "node:readline";
import { SPINNER, dim, green } from "./format.ts";
import type { Surface } from "./surface.ts";

const out = process.stdout;

export class LineSurface implements Surface {
  private rl: readline.Interface;
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  private startedAt = 0;
  private label = "";
  private prompting = false;
  private closed = false;

  // Lines are queued rather than pulled one read at a time: with piped
  // input every line arrives at once, and anything not being awaited at
  // that moment would be dropped.
  private readonly queue: string[] = [];
  private waiting?: (line: string | null) => void;
  private interrupt?: () => void;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: out, historySize: 200 });

    this.rl.on("line", (line) => {
      const resolve = this.waiting;
      this.waiting = undefined;
      if (resolve) resolve(line);
      else this.queue.push(line);
    });

    this.rl.on("close", () => {
      this.closed = true;
      this.waiting?.(null);
      this.waiting = undefined;
    });

    this.rl.on("SIGINT", () => this.interrupt?.());
  }

  header(text: string): void {
    this.write(text);
  }

  chat(text: string): void {
    this.write(text);
  }

  negotiation(text: string): void {
    this.write(`  ${text}`);
  }

  onInterrupt(handler: () => void): void {
    this.interrupt = handler;
  }

  ask(prompt: string): Promise<string | null> {
    this.rl.setPrompt(prompt);
    this.prompting = true;
    this.rl.prompt();

    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  end(): void {
    this.closed = true;
    this.waiting?.(null);
    this.waiting = undefined;
  }

  start(label: string): void {
    this.prompting = false;
    if (!out.isTTY) {
      this.write(dim(`… ${label}`));
      return;
    }
    this.stop();
    this.label = label;
    this.frame = 0;
    this.startedAt = Date.now();
    this.paint();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.paint();
    }, 80);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.clear();
  }

  close(): void {
    this.stop();
    this.rl.close();
    out.write(dim(`\n${green("·")} bye\n`));
  }

  private write(text: string): void {
    this.clear();
    out.write(`${text}\n`);
    if (this.timer) this.paint();
    else if (out.isTTY && (this.prompting || this.rl.line)) this.rl.prompt(true);
  }

  private paint(): void {
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    this.clear();
    out.write(dim(`${SPINNER[this.frame]} ${this.label}${seconds > 1 ? ` ${seconds}s` : ""}`));
  }

  private clear(): void {
    if (!out.isTTY) return;
    readline.cursorTo(out, 0);
    readline.clearLine(out, 0);
  }
}
