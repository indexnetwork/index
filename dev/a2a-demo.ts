/**
 * Live demo of the A2A layer: two independent personal agents (Buyer and
 * Seller), each running its own real A2A server AND initiating its own
 * negotiation against the other's endpoint — the fully symmetric
 * peer-to-peer shape, not one side merely driving a passive responder.
 *
 * Unlike the test suite, this makes real OpenRouter calls (needs
 * OPENROUTER_API_KEY) and is non-deterministic, so it isn't part of
 * `bun test`. Run it directly:
 *
 *   bun run dev/a2a-demo.ts
 */
import { Negotiator } from "../src/index.ts";
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

function agentCard(name: string, url: string) {
  return {
    name,
    url,
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate" }],
  };
}

const sellerCore = {
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
  party: { name: "Seller", objective: "Sell a used bike for as much as possible, ideally above $450" },
  allowedActions: [...ALLOWED],
};
const buyerCore = {
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
  party: { name: "Buyer", objective: "Buy a spare bike lock for as little as possible, ideally under $20" },
  allowedActions: [...ALLOWED],
};

const sellerServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({ ...sellerCore, agentCard: agentCard("Seller Agent", "") }),
});
const buyerServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({ ...buyerCore, agentCard: agentCard("Buyer Agent", "") }),
});

console.log(`Seller A2A server: ${sellerServer.url}`);
console.log(`Buyer A2A server:  ${buyerServer.url}\n`);

function logReply(name: string, message: { parts: { data?: unknown }[] }) {
  const data = message.parts[0]?.data as { action: string; message: string };
  console.log(`[${name}] (${data.action}) ${data.message}\n`);
}

async function runNegotiation<A extends string>(
  label: string,
  initiator: { name: string; client: A2ANegotiationClient<A> },
  responderName: string,
  targetUrl: string,
) {
  console.log(`=== ${label} (initiated by ${initiator.name}) ===`);
  let { task, decision } = await initiator.client.initiate(targetUrl);
  console.log(`[${initiator.name}] (${decision.action}) ${decision.message}`);
  logReply(responderName, task.history.at(-1)!);

  while (task.status.state === "input-required") {
    ({ task, decision } = await initiator.client.continue(targetUrl, task));
    console.log(`[${initiator.name}] (${decision.action}) ${decision.message}`);
    logReply(responderName, task.history.at(-1)!);
  }

  console.log(`Negotiation ended: ${task.status.state}\n`);
}

// Buyer reaches out to Seller's server — buying the bike.
const buyerClient = new A2ANegotiationClient({
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
  party: { name: "Buyer", objective: "Buy the bike for as little as possible, ideally under $400" },
  allowedActions: [...ALLOWED],
});
await runNegotiation("Bike sale", { name: "Buyer", client: buyerClient }, "Seller", sellerServer.url.toString());

// Seller reaches out to Buyer's server — a completely different negotiation,
// proving Buyer is independently reachable, not just a driving client.
const sellerClient = new A2ANegotiationClient({
  negotiator: new Negotiator({ model: "openai/gpt-4o-mini" }),
  party: { name: "Seller", objective: "Sell a spare bike lock for as much as possible, ideally above $25" },
  allowedActions: [...ALLOWED],
});
await runNegotiation("Bike lock sale", { name: "Seller", client: sellerClient }, "Buyer", buyerServer.url.toString());

sellerServer.stop();
buyerServer.stop();
