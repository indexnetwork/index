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
import { Negotiator, type NegotiationDecision } from "../src/index.ts";
import { agentCard, logTurn, MAX_TURNS } from "./shared.ts";

const ALLOWED = ["propose", "counter", "accept", "reject"] as const;

function extractOffer(message: string): number | null {
  const match = message.match(/\$(\d+)/);
  return match ? Number(match[1]) : null;
}

const handler = createA2AHandler({
  negotiator: new Negotiator(),
  party: { name: "Seller", objective: "Sell a used bike for as much as possible, ideally above $450" },
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
  negotiator: new Negotiator(),
  party: { name: "Buyer", objective: "Buy the bike for as little as possible, ideally under $400" },
  allowedActions: [...ALLOWED],
  evaluate: (_task, decision) => ({
    artifactId: crypto.randomUUID(),
    name: "buyer-side-note",
    parts: [{ kind: "text", text: `Buyer chose ${decision.action}` }],
  }),
  // Prints the Buyer's line the instant it's decided — the local artifact
  // only exists once evaluate() runs after the round trip, so it's still
  // printed afterward, just without repeating the Buyer's message.
  onDecision: (decision) => logTurn("Buyer", decision),
});

let { task, artifact } = await client.initiate(url);
console.log("  buyer-local artifact:", artifact);
logTurn("Seller", task.history.at(-1)!.parts[0]!.data as NegotiationDecision);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task, artifact } = await client.continue(url, task));
  console.log("  buyer-local artifact:", artifact);
  logTurn("Seller", task.history.at(-1)!.parts[0]!.data as NegotiationDecision);
  turns++;
}

console.log(`\nEnded: ${task.status.state}`);
console.log("\nAll artifacts the Seller's Task accumulated (server-side, persisted on the task):");
console.log(JSON.stringify(task.artifacts, null, 2));

server.stop();
