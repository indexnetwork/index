/**
 * Negotiator/decide() and the A2A layer don't hardcode any action
 * vocabulary — allowedActions can be any domain-specific set, with
 * per-action descriptions for names that aren't self-explanatory, and
 * isTerminal() decides which of *your* actions end the negotiation.
 *
 * This models a support-escalation flow instead of a price negotiation:
 * "resolve" and "escalate" are terminal; "clarify" continues the thread.
 *
 *   bun run examples/06-custom-action-vocabulary.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { Negotiator, type NegotiationDecision } from "../src/index.ts";
import { agentCard, logTurn, MAX_TURNS } from "./shared.ts";

const ALLOWED = [
  "clarify",
  { action: "resolve", description: "The issue is fixed; close the case" },
  { action: "escalate", description: "Hand off to a human specialist" },
] as const;

const TERMINAL = new Set(["resolve", "escalate"]);

const handler = createA2AHandler({
  negotiator: new Negotiator(),
  party: {
    name: "Support Agent",
    objective:
      "Resolve the customer's issue by asking clarifying questions until you can diagnose it, then resolve or escalate",
  },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Support Agent"),
  isTerminal: (action) => TERMINAL.has(action),
  terminalState: (action) => (action === "resolve" ? "completed" : "rejected"),
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: new Negotiator(),
  party: {
    name: "Customer",
    objective: "Get your crash fixed; your app crashes on startup with error code E-4021",
  },
  allowedActions: [...ALLOWED],
  onDecision: (decision) => logTurn("Customer", decision),
});

let { task } = await client.initiate(url);
logTurn("Support", task.history.at(-1)!.parts[0]!.data as NegotiationDecision);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task } = await client.continue(url, task));
  logTurn("Support", task.history.at(-1)!.parts[0]!.data as NegotiationDecision);
  turns++;
}

console.log(`\nCase ended: ${task.status.state}`); // "completed" for resolve, "rejected" for escalate
server.stop();
