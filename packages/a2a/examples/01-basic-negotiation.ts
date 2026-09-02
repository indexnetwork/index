/**
 * The simplest A2A shape, on a collaboration: Mara's agent (the client)
 * wants a designer to pair on her prototype; Deniz's agent (the server)
 * answers. Both are real Negotiators calling OpenRouter. Mara initiates
 * and drives the loop until the task reaches a terminal state.
 *
 * Structured terms are on, so an accepting move names the offer it binds
 * to and verifyAgreement() can report what was actually agreed. This is
 * the same scenario the README follows.
 *
 *   OPENROUTER_API_KEY=... bun run examples/01-basic-negotiation.ts
 */
import { A2ANegotiationClient, createA2AHandler, strategyWithTerms, verifyAgreement } from "../src/a2a/index.ts";
import { Negotiator } from "../src/index.ts";
import { type Action, ACTIONS, agentCard, logReply, logTurn, MAX_TURNS } from "./shared.ts";

const TERMS = "hoursPerWeek (number), weeks (number), startDate (YYYY-MM-DD)";

const handler = createA2AHandler({
  negotiator: new Negotiator(),
  party: {
    name: "Deniz",
    objective:
      "Help on a side project you find interesting, but no more than 4 hours a week, nothing before you're back from a trip next Tuesday, and only with a co-creator credit",
  },
  allowedActions: [...ACTIONS],
  agentCard: agentCard("Deniz's Agent"),
  strategy: strategyWithTerms<Action>(TERMS),
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: new Negotiator(),
  party: {
    name: "Mara",
    objective:
      "Get a designer to pair on your local-events prototype for about 6 hours a week over 4 weeks, starting as soon as possible; you can offer a co-creator credit but no pay",
  },
  allowedActions: [...ACTIONS],
  strategy: strategyWithTerms<Action>(TERMS),
  // Prints Mara's line as soon as it's decided, before waiting on Deniz's
  // reply — otherwise both lines only appear once the whole round trip
  // finishes, since message/send isn't streamed.
  onDecision: (decision) => logTurn("Mara", decision),
});

let { task } = await client.initiate(url);
logReply("Deniz", task);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task } = await client.continue(url, task));
  logReply("Deniz", task);
  turns++;
}

console.log(`\nTask ${task.id} ended: ${task.status.state}`);
// Computed from the task itself, so Deniz's side would reach the same verdict.
console.log("Agreement:", verifyAgreement(task));
server.stop();
