/**
 * The simplest A2A shape: one server (Seller), one client (Buyer), both
 * backed by real Negotiators calling OpenRouter. Buyer initiates and
 * drives the loop until the task reaches a terminal state.
 *
 *   OPENROUTER_API_KEY=... bun run examples/01-basic-negotiation.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { Negotiator, type NegotiationDecision } from "../src/index.ts";
import { agentCard, logTurn, MAX_TURNS } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

const handler = createA2AHandler({
  negotiator: new Negotiator(),
  party: { name: "Seller", objective: "Sell a used bike for as much as possible, ideally above $450" },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Seller Agent"),
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: new Negotiator(),
  party: { name: "Buyer", objective: "Buy the bike for as little as possible, ideally under $400" },
  allowedActions: [...ALLOWED],
  // Prints the Buyer's line as soon as it's decided, before waiting on the
  // Seller's reply — otherwise both lines only appear once the whole
  // request/response round trip finishes, since message/send isn't streamed.
  onDecision: (decision) => logTurn("Buyer", decision),
});

let { task } = await client.initiate(url);
logTurn("Seller", task.history.at(-1)!.parts[0]!.data as NegotiationDecision);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task } = await client.continue(url, task));
  logTurn("Seller", task.history.at(-1)!.parts[0]!.data as NegotiationDecision);
  turns++;
}

console.log(`\nTask ${task.id} ended: ${task.status.state}`);
server.stop();
