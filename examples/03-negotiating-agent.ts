/**
 * Everything together: the agent opens a negotiation, stops partway to ask
 * Tomas a question, and carries on in the *same* exchange once he answers.
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
const advisor = new Agent({
  identity: {
    name: "Idris's Agent",
    id: "did:example:idris",
    description: "Acts for a fractional CFO",
  },
  systemPrompt:
    "You act for Idris, a fractional CFO taking on early-stage clients. He wants two days a month at 1,200 euros a day, and would take less cash for a small equity grant. Settle how many days and what it costs before agreeing anything.",
});

const { url, stop } = serve(advisor.handler());

const founder = new Agent({
  identity: { name: "Tomas's Agent", id: "did:example:tomas" },
  systemPrompt:
    "You act for Tomas, who is looking for a fractional CFO for his pre-seed company. Negotiate on his behalf, but ask him directly about anything you have not been told — what he can pay, how much equity he would part with, when he wants to start. Do not invent his position. When the negotiation ends, report back plainly.",
  tools: [askUserTool() as Tool<never>, ...negotiationTools()],
  maxSteps: 6,
}).for({ id: "int_cfo", statement: "Bring in a fractional CFO before the round closes" });

// The host's side of the conversation with Tomas. In production these come
// from a chat message, a push notification, a form.
const answers = [
  "Two days a month, up to 1,000 a day. No equity until after the round closes.",
  // The negotiation turns up a trade-off neither side could resolve alone:
  // Idris wants 1,200 in cash, or 1,000 plus equity now. Only Tomas can
  // say which, and his answer is a third thing neither agent proposed.
  "1,000 a day, and 0.25% granted once the round closes — not before.",
  "Yes, agree that.",
];

let result: RunResult = await founder.run(
  `There is an agent for a fractional CFO at ${url}. Agree terms for Tomas on the best basis you can.`,
  { onStep: logStep },
);

let asked = 0;
while (result.end === "needs-input" && asked < answers.length) {
  const answer = answers[asked++]!;
  console.log(`  > ${answer}\n`);

  result = await founder.run(answer, {
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
