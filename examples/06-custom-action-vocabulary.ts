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
import { agentCard, logTurn, scriptedNegotiator } from "./shared.ts";

const ALLOWED = [
  "clarify",
  { action: "resolve", description: "The issue is fixed; close the case" },
  { action: "escalate", description: "Hand off to a human specialist" },
] as const;

const TERMINAL = new Set(["resolve", "escalate"]);

const handler = createA2AHandler({
  negotiator: scriptedNegotiator([
    { action: "clarify", message: "Can you tell me which error code you saw?" },
    { action: "resolve", message: "That's a known cache issue — clearing it fixed it. Closing this out." },
  ]),
  party: { name: "Support Agent", objective: "Resolve the customer's issue" },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Support Agent"),
  isTerminal: (action) => TERMINAL.has(action),
  terminalState: (action) => (action === "resolve" ? "completed" : "rejected"),
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: scriptedNegotiator([
    { action: "clarify", message: "My app crashes on startup with error E-4021." },
    { action: "clarify", message: "It's error code E-4021, happens every time." },
  ]),
  party: { name: "Customer", objective: "Get the crash fixed" },
  allowedActions: [...ALLOWED],
});

let { task, decision } = await client.initiate(url);
logTurn("Customer", decision);
logTurn("Support", task.history.at(-1)!.parts[0]!.data as typeof decision);

while (task.status.state === "input-required") {
  ({ task, decision } = await client.continue(url, task));
  logTurn("Customer", decision);
  logTurn("Support", task.history.at(-1)!.parts[0]!.data as typeof decision);
}

console.log(`\nCase ended: ${task.status.state}`); // "completed" for resolve, "rejected" for escalate
server.stop();
