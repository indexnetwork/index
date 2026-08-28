/**
 * One agent, one identity, scoped to different intents.
 *
 * `for()` is a lens, not a new agent: the identity object is shared, so the
 * AgentCard a counterparty sees is identical in every scope. What changes
 * is context — what the agent is working on, and what its negotiations are
 * understood to serve.
 *
 *   OPENROUTER_API_KEY=... bun run examples/02-intent-scope.ts
 */
import { Agent } from "../src/index.ts";

const agent = new Agent({
  identity: {
    name: "Bob's Agent",
    id: "did:example:bob",
    description: "Acts for Bob",
    url: "https://bob.example",
  },
  systemPrompt: "You act for Bob. Be direct and never commit him to a price he hasn't approved.",
});

const buying = agent.for({ id: "int_bike", statement: "Find a used road bike under $450" });
const selling = agent.for("Sell Bob's old commuter bike for whatever it will fetch this month");

// Same identity, same card — in every scope.
console.log("cards identical:", JSON.stringify(buying.card()) === JSON.stringify(agent.card()));
console.log("identity shared:", buying.identity === agent.identity && selling.identity === agent.identity);
console.log(JSON.stringify(agent.card(), null, 2));

// What differs is the instructions the model actually runs under.
console.log("\n--- unscoped ---\n" + agent.instructions());
console.log("\n--- scoped to buying ---\n" + buying.instructions());
