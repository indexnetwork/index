/**
 * Using fetchAgentCard() as a trust check before negotiating with a URL
 * you don't already trust. Here Priya's agent has been handed a URL that
 * supposedly serves Tomas's agent — a studio hiring a part-time designer.
 * Before it sends anything about Priya, it checks that's who is actually
 * there. See the "Using the AgentCard as a trust check" section of the
 * README for when this matters (and when it doesn't).
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
    party: { name: "Tomas", objective: "Hire a part-time product designer for your studio" },
    allowedActions: ["propose"],
    agentCard: agentCard("Tomas's Agent"),
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

assertIdentity(card.name, "Tomas's Agent");
console.log(`\nIdentity check passed (name === "Tomas's Agent") — safe to negotiate.`);

// A mismatched expectation throws instead of silently negotiating:
try {
  assertIdentity(card.name, "Someone Else Entirely");
} catch (error) {
  console.log(`\n(Demonstrating the failure path) ${(error as Error).message}`);
}

server.stop();
