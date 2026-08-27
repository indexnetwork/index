/**
 * The fully symmetric peer-to-peer shape: both Buyer and Seller run their
 * own A2A server AND each initiates its own negotiation against the
 * other's endpoint — proving both sides are real, independently reachable
 * peers, not one client driving a passive responder. Both use real
 * Negotiators calling OpenRouter.
 *
 *   OPENROUTER_API_KEY=... bun run examples/02-symmetric-peers.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { Negotiator, type NegotiationDecision } from "../src/index.ts";
import { agentCard, logTurn, MAX_TURNS } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

const sellerServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: new Negotiator(),
    party: { name: "Seller", objective: "Sell a used bike for as much as possible, ideally above $450" },
    allowedActions: [...ALLOWED],
    agentCard: agentCard("Seller Agent"),
  }),
});

const buyerServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: new Negotiator(),
    party: { name: "Buyer", objective: "Buy a spare bike lock for as little as possible, ideally under $20" },
    allowedActions: [...ALLOWED],
    agentCard: agentCard("Buyer Agent"),
  }),
});

async function drive<A extends string>(
  label: string,
  responderName: string,
  client: A2ANegotiationClient<A>,
  url: string,
) {
  console.log(`\n=== ${label} ===`);
  // The initiator's own line is printed by onDecision, the instant it's
  // decided — not after this call resolves, since by then the responder's
  // reply already exists too (message/send is a single round trip, not
  // streamed), which would otherwise print both lines at once.
  let { task } = await client.initiate(url);
  logTurn(responderName, task.history.at(-1)!.parts[0]!.data as NegotiationDecision);

  let turns = 1;
  while (task.status.state === "input-required" && turns < MAX_TURNS) {
    ({ task } = await client.continue(url, task));
    logTurn(responderName, task.history.at(-1)!.parts[0]!.data as NegotiationDecision);
    turns++;
  }
  console.log(`Ended: ${task.status.state}`);
}

// Buyer reaches out to Seller for the bike.
await drive(
  "Bike sale (Buyer initiates)",
  "Seller",
  new A2ANegotiationClient({
    negotiator: new Negotiator(),
    party: { name: "Buyer", objective: "Buy the bike for as little as possible, ideally under $400" },
    allowedActions: [...ALLOWED],
    onDecision: (decision) => logTurn("Buyer", decision),
  }),
  sellerServer.url.toString(),
);

// Seller reaches out to Buyer for a completely different item — proving
// Buyer's server is independently reachable, not just a driving client.
await drive(
  "Lock sale (Seller initiates)",
  "Buyer",
  new A2ANegotiationClient({
    negotiator: new Negotiator(),
    party: { name: "Seller", objective: "Sell a spare bike lock for as much as possible, ideally above $25" },
    allowedActions: [...ALLOWED],
    onDecision: (decision) => logTurn("Seller", decision),
  }),
  buyerServer.url.toString(),
);

sellerServer.stop();
buyerServer.stop();
