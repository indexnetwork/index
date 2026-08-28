/**
 * Where output goes.
 *
 * Two streams run at once — the conversation with the party this agent
 * acts for, and the negotiation traffic with other agents — and reading
 * them interleaved is hard work. On a terminal they get a pane each; when
 * stdout is a pipe there is nowhere to put a pane, so they interleave with
 * markers instead and scripted runs keep working.
 */
export interface Surface {
  /** Standing line at the top: who this agent is, what it's scoped to. */
  header(text: string): void;
  /** The conversation with the user. */
  chat(text: string): void;
  /** Negotiation traffic. */
  negotiation(text: string): void;
  /** Spinner label while the agent works. */
  start(label: string): void;
  stop(): void;
  /** Reads one line. Resolves null on end of input. */
  ask(prompt: string): Promise<string | null>;
  /** ^C. The host decides what it means; see chat.ts. */
  onInterrupt(handler: () => void): void;
  /** Stop waiting for input: the pending `ask()` resolves null. */
  end(): void;
  close(): void;
}

export { LineSurface } from "./line.ts";
export { TuiSurface } from "./tui.ts";

import { LineSurface } from "./line.ts";
import { TuiSurface } from "./tui.ts";

/** Panes need a terminal to draw on; a pipe gets the line-based one. */
export function createSurface(): Surface {
  return process.stdout.isTTY && process.stdin.isTTY ? new TuiSurface() : new LineSurface();
}
