/**
 * `strategy` fully replaces the default `negotiator.decide()` call, so it
 * can do anything — including skip the LLM entirely. Here the Seller uses
 * deterministic business logic (a hard price floor) instead of an LLM
 * call: fast, free, and predictable, while still speaking normal A2A to
 * whatever's on the other end (which has no idea it's talking to
 * non-LLM logic).
 *
 *   bun run examples/04-custom-strategy.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { agentCard, logTurn, scriptedNegotiator } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;
const FLOOR = 400;

function extractOffer(message: string): number | null {
  const match = message.match(/\$(\d+)/);
  return match ? Number(match[1]) : null;
}

const handler = createA2AHandler({
  negotiator: scriptedNegotiator([]), // unused — the strategy never calls it
  party: { name: "Seller", objective: "Sell for at least $400" },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Seller Agent"),
  strategy: async (_negotiator, state) => {
    const lastIncoming = [...state.history].reverse().find((m) => m.role === "incoming");
    const offer = lastIncoming ? extractOffer(lastIncoming.content) : null;

    if (offer !== null && offer >= FLOOR) {
      return { action: "accept", message: `Deal — $${offer} clears my floor.` };
    }
    return {
      action: "counter",
      message: `I can't go below $${FLOOR}. Can you meet that?`,
    };
  },
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: scriptedNegotiator([
    { action: "propose", message: "I'll offer $350." },
    { action: "counter", message: "How about $400?" },
  ]),
  party: { name: "Buyer", objective: "Buy low" },
  allowedActions: [...ALLOWED],
});

let { task, decision } = await client.initiate(url);
logTurn("Buyer", decision);
logTurn("Seller (rule-based)", task.history.at(-1)!.parts[0]!.data as typeof decision);

while (task.status.state === "input-required") {
  ({ task, decision } = await client.continue(url, task));
  logTurn("Buyer", decision);
  logTurn("Seller (rule-based)", task.history.at(-1)!.parts[0]!.data as typeof decision);
}

console.log(`\nEnded: ${task.status.state}`);
server.stop();
