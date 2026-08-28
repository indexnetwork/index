/**
 * The agent stopping to ask the party it represents a question.
 *
 * `run()` doesn't block waiting for an answer — it returns
 * `end: "needs-input"` and holds nothing open. The host asks however it
 * likes and resumes by passing the answer to the next `run()`, which could
 * be seconds later or days later, in this process or another one.
 *
 * A live chat session is just this loop with the user on the other end.
 *
 *   OPENROUTER_API_KEY=... bun run examples/01-ask-user.ts
 */
import { Agent, askUserTool, type RunResult, type Tool } from "../src/index.ts";
import { logStep } from "./shared.ts";

// Stands in for an Index Network operation the host injects. This package
// deliberately knows nothing about how Index is reached — the host owns
// that transport and its auth.
const findMatches: Tool<{ looking_for: string }> = {
  name: "find_matches",
  description: "Find people whose stated intent pairs with a description, and their agents.",
  parameters: {
    type: "object",
    properties: { looking_for: { type: "string" } },
    required: ["looking_for"],
  },
  // A fixed directory: echoing the query back would make rephrasing look
  // productive, and the model would search five times for the same two people.
  run: () => [
    {
      name: "Idris's Agent",
      url: "https://idris.example",
      intent: "Offering fractional CFO work to early-stage startups, two days a month",
    },
    {
      name: "Lena's Agent",
      url: "https://lena.example",
      intent: "Angel investing in pre-seed B2B software, 25k–100k",
    },
  ],
};

const agent = new Agent({
  identity: { name: "Tomas's Agent", id: "did:example:tomas" },
  systemPrompt:
    "You act for Tomas. Before committing him to anything with a number attached — a day rate, a budget, a start date — you must ask him first, with the ask_user tool rather than in your reply: he may not read a reply for days, and the tool is what reaches him. Never assume a figure he has not given you.",
  tools: [askUserTool() as Tool<never>, findMatches as Tool<never>],
});

// The host's own answers. In production this is a chat message, a push
// notification, a form — whatever channel the host has to the user.
const answers = ["Up to 1,000 a day, and I want the first session before the round closes."];

let result: RunResult = await agent.run(
  "Idris has offered two days a month at 1,200 a day. Find out who else is out there, then agree terms with whoever is best.",
  { onStep: logStep },
);

let asked = 0;
while (result.end === "needs-input" && asked < answers.length) {
  const answer = answers[asked++]!;
  console.log(`  > ${answer}\n`);

  // Nothing was held open between these two calls. `messages` is the whole
  // state — persist it and resume tomorrow if you like.
  result = await agent.run(answer, { messages: result.messages, onStep: logStep });
}

console.log(`\n— ${result.end} after ${result.steps.length} steps`);
