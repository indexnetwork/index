/**
 * Shared between `06-server.ts` and `06-tui.ts`: which agents exist and
 * where, plus the wire shape of the server's own `/chat` control endpoint —
 * a second surface next to each agent's A2A one, for a host UI to drive the
 * agent directly rather than negotiate with it.
 */
import type { Step } from "../src/index.ts";

export interface PartyConfig {
  id: string;
  name: string;
  port: number;
  systemPrompt: string;
}

export const PARTIES: PartyConfig[] = [
  {
    id: "did:example:tomas",
    name: "Tomas's Agent",
    port: 4101,
    systemPrompt:
      "You act for Tomas. You can negotiate with other agents on his behalf — once find_matches gives you a counterparty, open the negotiation yourself with negotiate_open rather than waiting to be told to. Before committing him to anything with a number attached, ask him first with the ask_user tool rather than in your reply.",
  },
  {
    id: "did:example:priya",
    name: "Priya's Agent",
    port: 4102,
    systemPrompt:
      "You act for Priya, an angel investor. You can negotiate with other agents on her behalf — once find_matches gives you a counterparty, open the negotiation yourself with negotiate_open rather than waiting to be told to. Before committing her to a check size or terms, ask her first with the ask_user tool rather than in your reply.",
  },
];

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  output: string;
  end: "done" | "needs-input" | "max-steps";
  pending?: { question: string; options?: string[] };
  /** Every step of the run, tool calls included — so a client rendering
   * this remotely can show the same detail `onStep` gives an in-process
   * caller, not just the final line. */
  steps: Step[];
  /** Negotiation turns and settlements from this run, in order — the
   * server-side `onTurn`/`onSettled` events an in-process caller like
   * `cli/console.ts` gets directly, relayed here since a remote TUI has no
   * other way to see the wire. */
  wire: WireEvent[];
}

export type WireEvent =
  | { kind: "turn"; mine: boolean; message: string; id: string; peer?: string }
  | {
      kind: "settled";
      outcome: string;
      basis: string;
      reason: string;
      disputed: boolean;
      terms?: unknown;
      id?: string;
      peer?: string;
    };

/** One intent a party has published, past or present — `create_intent`
 * records one of these; it is never rewritten, only scoped to or away
 * from. */
export interface IntentRecord {
  id: string;
  statement: string;
  createdAt: number;
}

export interface IntentsResponse {
  /** Every intent this party has ever published, oldest first. */
  intents: IntentRecord[];
  /** Which of them (if any) the agent is currently scoped to. */
  scope?: IntentRecord;
}

export interface ScopeRequest {
  intentId: string;
}

export interface ScopeResponse {
  /** `null` when the request cleared the scope rather than setting it. */
  scope: IntentRecord | null;
}
