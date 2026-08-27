/**
 * The fully symmetric peer-to-peer shape: both Buyer and Seller run their
 * own A2A server AND each initiates its own negotiation against the
 * other's endpoint — proving both sides are real, independently reachable
 * peers, not one client driving a passive responder.
 *
 *   bun run examples/02-symmetric-peers.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { agentCard, logTurn, scriptedNegotiator } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

const sellerServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: scriptedNegotiator([
      { action: "counter", message: "I need $450 for the bike." },
      { action: "accept", message: "Deal at $420." },
    ]),
    party: { name: "Seller", objective: "Sell the bike" },
    allowedActions: [...ALLOWED],
    agentCard: agentCard("Seller Agent"),
  }),
});

const buyerServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: scriptedNegotiator([
      { action: "counter", message: "I can only pay $15 for a lock." },
      { action: "reject", message: "$25 is too much, no deal." },
    ]),
    party: { name: "Buyer", objective: "Buy a spare lock" },
    allowedActions: [...ALLOWED],
    agentCard: agentCard("Buyer Agent"),
  }),
});

async function drive<A extends string>(
  label: string,
  initiatorName: string,
  client: A2ANegotiationClient<A>,
  url: string,
) {
  console.log(`\n=== ${label} ===`);
  let { task, decision } = await client.initiate(url);
  logTurn(initiatorName, decision);

  while (task.status.state === "input-required") {
    ({ task, decision } = await client.continue(url, task));
    logTurn(initiatorName, decision);
  }
  console.log(`Ended: ${task.status.state}`);
}

// Buyer reaches out to Seller for the bike.
await drive(
  "Bike sale (Buyer initiates)",
  "Buyer",
  new A2ANegotiationClient({
    negotiator: scriptedNegotiator([
      { action: "propose", message: "I'll offer $400 for the bike." },
      { action: "counter", message: "I can go to $420." },
    ]),
    party: { name: "Buyer", objective: "Buy the bike" },
    allowedActions: [...ALLOWED],
  }),
  sellerServer.url.toString(),
);

// Seller reaches out to Buyer for a completely different item — proving
// Buyer's server is independently reachable, not just a driving client.
await drive(
  "Lock sale (Seller initiates)",
  "Seller",
  new A2ANegotiationClient({
    negotiator: scriptedNegotiator([
      { action: "propose", message: "Spare lock, $30." },
      { action: "reject", message: "Can't go below $25." },
    ]),
    party: { name: "Seller", objective: "Sell the spare lock" },
    allowedActions: [...ALLOWED],
  }),
  buyerServer.url.toString(),
);

sellerServer.stop();
buyerServer.stop();
