/**
 * `evaluate` runs after each turn's decision and can attach structured
 * findings (an Artifact) separate from the negotiation message itself —
 * useful for extracting "value" from a negotiation (a score, extracted
 * terms) without parsing free text, e.g. for a matching/orchestration
 * layer that wants to know how a negotiation went, not just its outcome.
 *
 * Server-side artifacts accumulate on task.artifacts (visible to anyone
 * who reads the Task). Client-side evaluate() runs locally and its result
 * comes back on A2ATurnResult.artifact instead, since the client doesn't
 * own the server's Task.
 *
 *   bun run examples/05-evaluate-artifacts.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { agentCard, logTurn, scriptedNegotiator } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

function extractOffer(message: string): number | null {
  const match = message.match(/\$(\d+)/);
  return match ? Number(match[1]) : null;
}

const handler = createA2AHandler({
  negotiator: scriptedNegotiator([
    { action: "counter", message: "I need at least $450." },
    { action: "accept", message: "Deal at $420." },
  ]),
  party: { name: "Seller", objective: "Sell high" },
  allowedActions: [...ALLOWED],
  agentCard: agentCard("Seller Agent"),
  evaluate: (task, decision) => ({
    artifactId: crypto.randomUUID(),
    name: "turn-evaluation",
    parts: [
      {
        kind: "data",
        data: {
          turn: task.history.length,
          action: decision.action,
          offer: extractOffer(decision.message),
        },
      },
    ],
  }),
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
  evaluate: (_task, decision) => ({
    artifactId: crypto.randomUUID(),
    name: "buyer-side-note",
    parts: [{ kind: "text", text: `Buyer chose ${decision.action}` }],
  }),
});

let { task, decision, artifact } = await client.initiate(url);
logTurn("Buyer", decision);
console.log("  buyer-local artifact:", artifact);
logTurn("Seller", task.history.at(-1)!.parts[0]!.data as typeof decision);

while (task.status.state === "input-required") {
  ({ task, decision, artifact } = await client.continue(url, task));
  logTurn("Buyer", decision);
  console.log("  buyer-local artifact:", artifact);
  logTurn("Seller", task.history.at(-1)!.parts[0]!.data as typeof decision);
}

console.log(`\nEnded: ${task.status.state}`);
console.log("\nAll artifacts the Seller's Task accumulated (server-side, persisted on the task):");
console.log(JSON.stringify(task.artifacts, null, 2));

server.stop();
