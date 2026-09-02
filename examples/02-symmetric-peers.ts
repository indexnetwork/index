/**
 * The fully symmetric peer-to-peer shape, on ideas and introductions: Ana
 * runs a climate-tech meetup, Ravi researches grid batteries. Each runs
 * their own A2A server AND each initiates a different negotiation against
 * the other's endpoint — two real, independently reachable peers, not one
 * client driving a passive responder. Both use real Negotiators calling
 * OpenRouter.
 *
 *   OPENROUTER_API_KEY=... bun run examples/02-symmetric-peers.ts
 */
import { A2ANegotiationClient, createA2AHandler } from "../src/a2a/index.ts";
import { Negotiator } from "../src/index.ts";
import { ACTIONS, agentCard, logReply, logTurn, MAX_TURNS } from "./shared.ts";

const anaServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: new Negotiator(),
    party: {
      name: "Ana",
      objective:
        "You know plenty of early-stage founders; make introductions only after a short call with the person asking, and no more than two intros in the same week",
    },
    allowedActions: [...ACTIONS],
    agentCard: agentCard("Ana's Agent"),
  }),
});

const raviServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({
    negotiator: new Negotiator(),
    party: {
      name: "Ravi",
      objective:
        "Give a short talk at a meetup if travel is covered and it's a weekday evening in October; you'd rather do 15 minutes than 20",
    },
    allowedActions: [...ACTIONS],
    agentCard: agentCard("Ravi's Agent"),
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
  logReply(responderName, task);

  let turns = 1;
  while (task.status.state === "input-required" && turns < MAX_TURNS) {
    ({ task } = await client.continue(url, task));
    logReply(responderName, task);
    turns++;
  }
  console.log(`Ended: ${task.status.state}`);
}

// Ana reaches out to Ravi: a talk at her meetup.
await drive(
  "Meetup talk (Ana initiates)",
  "Ravi",
  new A2ANegotiationClient({
    negotiator: new Negotiator(),
    party: {
      name: "Ana",
      objective:
        "Get Ravi to give a 20-minute talk on grid batteries at your meetup on Thursday 15 October; you can cover travel but not pay a fee",
    },
    allowedActions: [...ACTIONS],
    onDecision: (decision) => logTurn("Ana", decision),
  }),
  raviServer.url.toString(),
);

// Ravi reaches out to Ana for something else entirely — proving Ana's
// server is independently reachable, not just a driving client.
await drive(
  "Founder intros (Ravi initiates)",
  "Ana",
  new A2ANegotiationClient({
    negotiator: new Negotiator(),
    party: {
      name: "Ravi",
      objective:
        "Get Ana to introduce you to two or three early-stage founders for your study interviews this month; offer to share the findings with her community in return",
    },
    allowedActions: [...ACTIONS],
    onDecision: (decision) => logTurn("Ravi", decision),
  }),
  anaServer.url.toString(),
);

anaServer.stop();
raviServer.stop();
