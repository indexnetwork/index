import type { Agent } from "./agent.ts";
import type { RunResult } from "./types.ts";

/** How often an inbox is drained. Minutes, not seconds: a negotiation
 * advances one turn per side per tick, so this is the rate limit. */
export const TICK_MS = 5 * 60_000;

/**
 * What lands in an intent's inbox and waits for a run. The ids are the
 * ones the host's tools are keyed by, so the model can pass them straight
 * back; the package attaches no meaning to them.
 */
export type InboxEvent =
  /** It is this seat's turn in a negotiation. */
  | { kind: "negotiation.turn"; opportunityId: string; turnIndex: number }
  /** A negotiation ended and the settlement was computed. */
  | { kind: "negotiation.settled"; opportunityId: string; outcome: string }
  /** The party this agent acts for said something. */
  | { kind: "message.new"; messageId: string; text: string };

export interface InboxOptions {
  /** Every run's result. A `needs-input` result carries the question the
   * host has to put to the party — nothing else will. */
  onResult: (result: RunResult) => void;
  /** A run that threw. Its events are back in the inbox and go out again
   * on the next tick. */
  onError: (error: unknown) => void;
}

/**
 * One intent's inbox: events land here and wait, and a run is the unit
 * of work over whatever has accumulated — every turn, at most one ask,
 * in one context. Two things start a run, and nothing else:
 *
 * - **A tick**, if the inbox is non-empty. Events that land during a run
 *   wait for the next tick.
 * - **The party replied.** A `message.new` starts a run at once — a human
 *   is waiting — and whatever else is in the inbox rides along. If a run
 *   is in flight, the reply's run follows it directly.
 *
 * Holds nothing but the queue. The question is on the negotiation record
 * and the message is in the DM, so a fresh inbox in a new process picks
 * up from the next event as if nothing happened.
 */
export class Inbox {
  private events: InboxEvent[] = [];
  private running?: Promise<void>;

  constructor(
    /** Scoped to one intent with `for()`. */
    private readonly agent: Agent,
    private readonly options: InboxOptions,
  ) {}

  /** What is waiting. */
  get size(): number {
    return this.events.length;
  }

  push(event: InboxEvent): void {
    this.events.push(event);
    if (event.kind === "message.new") {
      void (this.running ?? Promise.resolve()).then(() => this.drain());
    }
  }

  /** Runs if anything is waiting. Resolves once that run has ended, or at
   * once when there is nothing to do or a run is already in flight. */
  tick(): Promise<void> {
    return this.drain();
  }

  /** Ticks every `intervalMs` until the returned function is called. */
  start(intervalMs = TICK_MS): () => void {
    const timer = setInterval(() => void this.tick(), intervalMs);
    return () => clearInterval(timer);
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    if (!this.events.length) return Promise.resolve();

    const batch = this.events;
    this.events = [];
    this.running = this.agent
      .run(render(batch))
      .then(
        (result) => this.options.onResult(result),
        (error: unknown) => {
          this.events = [...batch, ...this.events];
          this.options.onError(error);
        },
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
}

/**
 * The batch as one instruction. The reply comes first: when the transcript
 * ends on an unanswered `ask_user`, the loop records this whole text as
 * that question's result, so what the party said has to lead.
 */
function render(batch: InboxEvent[]): string {
  const replies = batch.filter((event) => event.kind === "message.new");
  const rest = batch.filter((event) => event.kind !== "message.new");

  const parts = [
    replies.length
      ? `Your party said:\n${replies.map((reply) => `> ${reply.text}`).join("\n")}`
      : "Nothing new from your party. Any question you asked them is still open; do not ask it again.",
  ];
  if (rest.length) {
    parts.push(
      `Since your last run:\n${rest
        .map((event) =>
          event.kind === "negotiation.turn"
            ? `- Negotiation ${event.opportunityId} is waiting on your turn (turn ${event.turnIndex}).`
            : `- Negotiation ${event.opportunityId} settled: ${event.outcome}.`,
        )
        .join("\n")}`,
    );
  }
  parts.push(
    "Take your turn in every negotiation waiting on you, in one pass — what one of them tells you applies to the others. Where only your party can decide, hold that negotiation, and ask them once with ask_user, covering everything you are holding for. Then say briefly what you did.",
  );
  return parts.join("\n\n");
}
