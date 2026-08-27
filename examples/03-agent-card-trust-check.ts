/**
 * Using fetchAgentCard() as a trust check before negotiating with a URL
 * you don't already trust — see the "Using the AgentCard as a trust check"
 * section of the README for when this matters (and when it doesn't).
 *
 *   bun run examples/03-agent-card-trust-check.ts
 */
import { createA2AHandler, fetchAgentCard } from "../src/a2a/index.ts";
import { Negotiator } from "../src/index.ts";
import { agentCard } from "./shared.ts";

const server = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: new Negotiator(),
    party: { name: "Seller", objective: "Sell" },
    allowedActions: ["propose"],
    agentCard: agentCard("Seller Agent"),
  }),
});

function assertIdentity(cardName: string, expectedName: string): void {
  if (cardName !== expectedName) {
    throw new Error(`Refusing to negotiate: expected "${expectedName}", got "${cardName}"`);
  }
}

const url = server.url.toString();
const card = await fetchAgentCard(url);
console.log("Fetched agent card:", card);

assertIdentity(card.name, "Seller Agent");
console.log(`\nIdentity check passed (name === "Seller Agent") — safe to negotiate.`);

// A mismatched expectation throws instead of silently negotiating:
try {
  assertIdentity(card.name, "Someone Else Entirely");
} catch (error) {
  console.log(`\n(Demonstrating the failure path) ${(error as Error).message}`);
}

server.stop();
