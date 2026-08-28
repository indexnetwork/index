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
const findCounterparties: Tool<{ looking_for: string }> = {
  name: "find_counterparties",
  description: "Find agents whose parties are offering something matching a description.",
  parameters: {
    type: "object",
    properties: { looking_for: { type: "string" } },
    required: ["looking_for"],
  },
  run: ({ looking_for }) => [
    { name: "Alice's Agent", url: "https://alice.example", offering: `road bike — ${looking_for}` },
    { name: "Carol's Agent", url: "https://carol.example", offering: "commuter bike" },
  ],
};

const agent = new Agent({
  identity: { name: "Bob's Agent", id: "did:example:bob" },
  systemPrompt:
    "You act for Bob. Before committing him to anything with a price attached, you must ask him directly — never assume a budget. Use your tools, then report back plainly.",
  tools: [askUserTool() as Tool<never>, findCounterparties as Tool<never>],
});

// The host's own answers. In production this is a chat message, a push
// notification, a form — whatever channel the host has to the user.
const answers = ["No more than $450, and I'd rather have the road bike."];

let result: RunResult = await agent.run("Find me a used bike and line up a purchase.", {
  onStep: logStep,
});

let asked = 0;
while (result.end === "needs-input" && asked < answers.length) {
  const answer = answers[asked++]!;
  console.log(`  > ${answer}\n`);

  // Nothing was held open between these two calls. `messages` is the whole
  // state — persist it and resume tomorrow if you like.
  result = await agent.run(answer, { messages: result.messages, onStep: logStep });
}

console.log(`\n— ${result.end} after ${result.steps.length} steps`);
