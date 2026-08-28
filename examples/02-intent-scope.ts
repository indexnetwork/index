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
    name: "Tomas's Agent",
    id: "did:example:tomas",
    description: "Acts for Tomas",
    url: "https://tomas.example",
  },
  systemPrompt: "You act for Tomas. Be direct, and never commit him to terms he has not approved.",
});

const raising = agent.for({ id: "int_round", statement: "Raise a 400k pre-seed round" });
const hiring = agent.for("Hire a senior backend engineer, remote within Europe");

// Same identity, same card — in every scope.
console.log("cards identical:", JSON.stringify(raising.card()) === JSON.stringify(agent.card()));
console.log("identity shared:", raising.identity === agent.identity && hiring.identity === agent.identity);
console.log(JSON.stringify(agent.card(), null, 2));

// What differs is the instructions the model actually runs under.
console.log("\n--- unscoped ---\n" + agent.instructions());
console.log("\n--- scoped to raising ---\n" + raising.instructions());
