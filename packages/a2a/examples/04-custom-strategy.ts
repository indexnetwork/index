/**
 * `strategy` fully replaces the default `negotiator.decide()` call, so it
 * can do anything — including skip the LLM entirely. Here Jonas is looking
 * for his next contract and his agent runs on plain rules (at most 3 days
 * a week, remote, four weeks' notice) instead of a model call: fast, free,
 * and predictable, while still speaking normal A2A to whatever's on the
 * other end. Leila's agent, hiring, is a real Negotiator and has no idea
 * it's talking to non-LLM logic.
 *
 * The rule reads the counterparty's structured terms, not its prose, so
 * Leila's side runs with `strategyWithTerms()`. Against a counterparty
 * that only sends text, `entry.terms` is never set and the rule keeps
 * restating its constraints — the honest fallback.
 *
 *   bun run examples/04-custom-strategy.ts
 */
import { A2ANegotiationClient, createA2AHandler, strategyWithTerms, verifyAgreement } from "../src/a2a/index.ts";
import { Negotiator, type NegotiationTerms } from "../src/index.ts";
import { type Action, ACTIONS, agentCard, logReply, logTurn, MAX_TURNS } from "./shared.ts";

const TERMS = "daysPerWeek (number), startDate (YYYY-MM-DD), remote (boolean)";
const MAX_DAYS = 3;
// Four weeks' notice. ISO dates compare correctly as strings.
const EARLIEST_START = new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10);

function acceptable(terms: NegotiationTerms): boolean {
  return (
    typeof terms.daysPerWeek === "number" &&
    terms.daysPerWeek <= MAX_DAYS &&
    typeof terms.startDate === "string" &&
    terms.startDate >= EARLIEST_START &&
    terms.remote === true
  );
}

const handler = createA2AHandler({
  negotiator: new Negotiator(), // unused — the strategy never calls it
  party: {
    name: "Jonas",
    objective: "Take a new contract only at up to 3 days a week, remote, starting no earlier than four weeks from today",
  },
  allowedActions: [...ACTIONS],
  agentCard: agentCard("Jonas's Agent"),
  strategy: async (_negotiator, state) => {
    const offer = [...state.history].reverse().find((entry) => entry.role === "incoming");
    const terms = offer?.terms;

    if (offer?.offerId && terms && acceptable(terms)) {
      // Accepting names the offer it binds to, exactly as an LLM turn
      // would — so verifyAgreement() can give this deal `basis: "reference"`.
      return {
        action: "accept",
        message: `That works for me — ${terms.daysPerWeek} days a week, remote, from ${terms.startDate}.`,
        terms,
        acceptsOfferId: offer.offerId,
      };
    }
    // A custom strategy mints its own offerId; only decide() does that
    // automatically.
    return {
      action: "refine",
      message: `I can do up to ${MAX_DAYS} days a week, remote, starting ${EARLIEST_START} at the earliest. Does that work?`,
      terms: { daysPerWeek: MAX_DAYS, startDate: EARLIEST_START, remote: true },
      offerId: crypto.randomUUID(),
    };
  },
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: new Negotiator(),
  party: {
    name: "Leila",
    objective:
      "Bring Jonas on for 4 days a week starting as soon as possible; hybrid preferred but remote is fine if that's the only way",
  },
  allowedActions: [...ACTIONS],
  strategy: strategyWithTerms<Action>(TERMS),
  onDecision: (decision) => logTurn("Leila", decision),
});

let { task } = await client.initiate(url);
logReply("Jonas (rule-based)", task);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task } = await client.continue(url, task));
  logReply("Jonas (rule-based)", task);
  turns++;
}

console.log(`\nEnded: ${task.status.state}`);
console.log("Agreement:", verifyAgreement(task)); // expect basis: "reference" on a deal
server.stop();
