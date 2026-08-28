/**
 * Everything together: the agent opens a negotiation, stops partway to ask
 * Bob a question, and carries on in the *same* exchange once he answers.
 *
 * That pause is why negotiation is one turn per tool call. If `negotiate()`
 * ran the whole exchange inside a single tool call there would be no gap to
 * stop in — the agent could only ask before it started or after it finished.
 *
 * Note what the host passes back on resume: `messages` *and* `negotiations`.
 * The first is the conversation, the second is the open A2A task. Without
 * the second the agent could still talk, but not take another turn in an
 * exchange it had already started.
 *
 *   OPENROUTER_API_KEY=... bun run examples/03-negotiating-agent.ts
 */
import { Agent, askUserTool, negotiationTools, type RunResult, type Tool } from "../src/index.ts";
import { logStep, serve } from "./shared.ts";

// A plain A2A responder: it answers turns with Negotiator, no loop involved.
const seller = new Agent({
  identity: { name: "Seller", id: "did:example:alice", description: "Sells one used road bike" },
  systemPrompt:
    "Sell a used road bike for as much as possible, ideally above $450. Bring up collection arrangements before agreeing anything.",
});

const { url, stop } = serve(seller.handler());

const buyer = new Agent({
  identity: { name: "Bob's Agent", id: "did:example:bob" },
  systemPrompt:
    "You act for Bob. Negotiate on his behalf, but ask him directly about anything you have not been told — a price ceiling, dates, collection. Do not invent his preferences. When the negotiation ends, report back plainly.",
  tools: [askUserTool() as Tool<never>, ...negotiationTools()],
  maxSteps: 6,
}).for({ id: "int_bike", statement: "Buy a reliable used road bike" });

// The host's side of the conversation with Bob. In production these come
// from a chat message, a push notification, a form.
const answers = [
  "Up to $460, and I can collect any weekday evening after 6.",
  "Yes, go ahead and close it.",
];

let result: RunResult = await buyer.run(
  `There is a seller agent at ${url}. Get the bike for Bob on the best terms you can.`,
  { onStep: logStep },
);

let asked = 0;
while (result.end === "needs-input" && asked < answers.length) {
  const answer = answers[asked++]!;
  console.log(`  > ${answer}\n`);

  result = await buyer.run(answer, {
    messages: result.messages,
    negotiations: result.negotiations, // the open A2A task travels with it
    onStep: logStep,
  });
}

console.log(`\n— ${result.end} after ${result.steps.length} steps`);
for (const session of result.negotiations) {
  console.log(`  negotiation ${session.id}: ${session.task.status.state}`);
}
stop();
