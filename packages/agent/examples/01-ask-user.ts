/**
 * Low-level ModelLoop demonstration, not the public H2A Agent API.
 *
 * `run()` doesn't block waiting for an answer — it returns
 * `end: "needs-input"` and holds nothing open. The host asks however it
 * likes and resumes by passing the answer to the next `run()`, which could
 * be seconds later or days later, in this process or another one.
 *
 * ModelLoop is internal machinery, imported directly from source here.
 * Public Agent input goes through receiveInput(); see ../README.md.
 *
 *   OPENROUTER_API_KEY=... bun run examples/01-ask-user.ts
 */
import { ModelLoop } from "../src/core/model.loop.ts";
import { ModelClient, askUserTool, type Tool } from "../src/index.ts";
import { answerUntilDone, logStep } from "./shared.ts";

// Stands in for an Index Network operation injected into the model loop.
// The loop knows nothing about transport or auth; it only invokes tools.
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

const loop = new ModelLoop({
  model: new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY }),
  identity: { name: "Tomas", id: "did:example:tomas" },
  systemPrompt:
    "You act for Tomas. Before committing him to anything with a number attached — a day rate, a budget, a start date — you must ask him first, with the ask_user tool rather than in your reply: he may not read a reply for days, and the tool is what reaches him. Never assume a figure he has not given you.",
  tools: [askUserTool(), findMatches],
});

// The host's own answers. In production this is a chat message, a push
// notification, a form — whatever channel the host has to the user.
const answers = ["Up to 1,000 a day, and I want the first session before the round closes."];

let result = await loop.run(
  "Idris has offered two days a month at 1,200 a day. Find out who else is out there, then agree terms with whoever is best.",
  { onStep: logStep },
);

// Nothing is held open while the question is out. `messages` is the whole
// state — persist it and resume tomorrow if you like.
result = await answerUntilDone(loop, result, answers, { onStep: logStep });

console.log(`\n— ${result.end} after ${result.steps.length} steps`);
