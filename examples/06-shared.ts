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
      "You act for Tomas. Before committing him to anything with a number attached, ask him first with the ask_user tool rather than in your reply.",
  },
  {
    id: "did:example:priya",
    name: "Priya's Agent",
    port: 4102,
    systemPrompt:
      "You act for Priya, an angel investor. Before committing her to a check size or terms, ask her first with the ask_user tool rather than in your reply.",
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
}
