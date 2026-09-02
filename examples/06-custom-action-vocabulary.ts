/**
 * Negotiator.decide() and the A2A layer don't hardcode any action
 * vocabulary — allowedActions can be any domain-specific set, with
 * per-action descriptions for names that aren't self-explanatory,
 * isTerminal() decides which of *your* actions end the negotiation, and
 * terminalState() says which final state each one lands in.
 *
 * This models a mentorship request: Hana is moving from engineering into
 * product management and wants a mentor; Kofi mentors one person at a
 * time. "ask" and "offer" keep the conversation open; "commit", "pass" and
 * "defer" end it — as completed, rejected, and canceled respectively, so
 * all three final states are in play.
 *
 *   bun run examples/06-custom-action-vocabulary.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { Negotiator } from "../src/index.ts";
import { agentCard, logReply, logTurn, MAX_TURNS } from "./shared.ts";

const ALLOWED = [
  { action: "ask", description: "Ask a clarifying question about what they're looking for; keeps the conversation open" },
  { action: "offer", description: "Put a concrete mentoring arrangement on the table: cadence, duration, format" },
  { action: "commit", description: "Agree to the arrangement as last stated; ends with a deal" },
  { action: "pass", description: "Decline the arrangement; ends without one" },
  { action: "defer", description: "Not now: suggest revisiting in a few months; ends without a deal" },
] as const;

const TERMINAL = new Set(["commit", "pass", "defer"]);

const handler = createA2AHandler({
  negotiator: new Negotiator(),
  party: {
    name: "Kofi",
    objective:
      "You're a senior product manager who mentors one person at a time; take someone on for 30-minute calls every two weeks for three months, starting in October, if their goals are specific",
  },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Kofi's Agent"),
  isTerminal: (action) => TERMINAL.has(action),
  terminalState: (action) =>
    action === "commit" ? "completed" : action === "defer" ? "canceled" : "rejected",
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: new Negotiator(),
  party: {
    name: "Hana",
    objective:
      "Find a mentor for your move from engineering into product management; you'd like a monthly hour-long call for six months and are flexible on format",
  },
  allowedActions: [...ALLOWED],
  onDecision: (decision) => logTurn("Hana", decision),
});

let { task } = await client.initiate(url);
logReply("Kofi", task);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task } = await client.continue(url, task));
  logReply("Kofi", task);
  turns++;
}

// "completed" for commit, "canceled" for defer, "rejected" for pass
console.log(`\nEnded: ${task.status.state}`);
server.stop();
