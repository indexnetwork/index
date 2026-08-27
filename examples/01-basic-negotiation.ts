/**
 * The simplest A2A shape: one server (Seller), one client (Buyer). Buyer
 * initiates and drives the loop until the task reaches a terminal state.
 *
 *   bun run examples/01-basic-negotiation.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { agentCard, logTurn, scriptedNegotiator } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

const handler = createA2AHandler({
  negotiator: scriptedNegotiator([
    { action: "counter", message: "I need at least $450." },
    { action: "accept", message: "Deal at $420." },
  ]),
  party: { name: "Seller", objective: "Sell high" },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Seller Agent"),
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: scriptedNegotiator([
    { action: "propose", message: "I'll offer $400." },
    { action: "counter", message: "I can do $420." },
  ]),
  party: { name: "Buyer", objective: "Buy low" },
  allowedActions: [...ALLOWED],
});

let { task, decision } = await client.initiate(url);
logTurn("Buyer", decision);
logTurn("Seller", (task.history.at(-1)!.parts[0]!.data as typeof decision));

while (task.status.state === "input-required") {
  ({ task, decision } = await client.continue(url, task));
  logTurn("Buyer", decision);
  logTurn("Seller", (task.history.at(-1)!.parts[0]!.data as typeof decision));
}

console.log(`\nTask ${task.id} ended: ${task.status.state}`);
server.stop();
