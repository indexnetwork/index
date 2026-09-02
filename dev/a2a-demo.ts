/**
 * Live demo of the A2A layer: two independent personal agents, Mara's and
 * Deniz's, each running its own real A2A server AND initiating its own
 * negotiation against the other's endpoint — the fully symmetric
 * peer-to-peer shape, not one side merely driving a passive responder.
 * Same scenario as the README: Mara wants a designer to pair on her
 * prototype; Deniz has limited time and a trip coming up.
 *
 * Unlike the test suite, this makes real OpenRouter calls (needs
 * OPENROUTER_API_KEY) and is non-deterministic, so it isn't part of
 * `bun test`. Run it directly:
 *
 *   bun run dev/a2a-demo.ts
 */
import { Negotiator } from "../src/index.ts";
import { A2ANegotiationClient, createA2AHandler, messageToDecision } from "../src/a2a/index.ts";
import type { A2AMessage } from "../src/a2a/index.ts";

const ACTIONS = ["propose", "refine", "accept", "decline"] as const;

function agentCard(name: string, url: string) {
  return {
    name,
    url,
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate" }],
  };
}

const denizCore = {
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
  party: {
    name: "Deniz",
    objective:
      "Help on a side project you find interesting, but no more than 4 hours a week, nothing before you're back from a trip next Tuesday, and only with a co-creator credit",
  },
  allowedActions: [...ACTIONS],
};
const maraCore = {
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
  party: {
    name: "Mara",
    objective:
      "You're happy to review things for people you work with, but only in a single one-hour session on a weekday evening",
  },
  allowedActions: [...ACTIONS],
};

const denizServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({ ...denizCore, agentCard: agentCard("Deniz's Agent", "") }),
});
const maraServer = Bun.serve({
  port: 0,
  fetch: createA2AHandler({ ...maraCore, agentCard: agentCard("Mara's Agent", "") }),
});

console.log(`Deniz's A2A server: ${denizServer.url}`);
console.log(`Mara's A2A server:  ${maraServer.url}\n`);

function logReply(name: string, message: A2AMessage) {
  const decision = messageToDecision(message);
  if (decision) console.log(`[${name}] (${decision.action}) ${decision.message}\n`);
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

// Mara reaches out to Deniz's server — pairing on the prototype.
const maraClient = new A2ANegotiationClient({
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
  party: {
    name: "Mara",
    objective:
      "Get a designer to pair on your local-events prototype for about 6 hours a week over 4 weeks, starting as soon as possible; you can offer a co-creator credit but no pay",
  },
  allowedActions: [...ACTIONS],
});
await runNegotiation("Prototype pairing", { name: "Mara", client: maraClient }, "Deniz", denizServer.url.toString());

// Deniz reaches out to Mara's server — a completely different ask,
// proving Mara is independently reachable, not just a driving client.
const denizClient = new A2ANegotiationClient({
  negotiator: new Negotiator({ model: "google/gemini-3.7-flash" }),
  party: {
    name: "Deniz",
    objective:
      "Get Mara to do a one-hour usability review of your portfolio site sometime next week; offer to return the favour",
  },
  allowedActions: [...ACTIONS],
});
await runNegotiation("Portfolio review", { name: "Deniz", client: denizClient }, "Mara", maraServer.url.toString());

denizServer.stop();
maraServer.stop();
