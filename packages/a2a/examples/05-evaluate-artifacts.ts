/**
 * `evaluate` runs after each turn's decision and can attach structured
 * findings (an Artifact) separate from the negotiation message itself —
 * useful for extracting "value" from a negotiation without parsing free
 * text, e.g. for a matching layer that wants to know how a negotiation
 * went, not just its outcome.
 *
 * Here Noor and Eli have matched and their agents are settling a first
 * meeting. Noor's side scores each turn: what activity is on the table,
 * how soon it is, and whether it's one she'd prefer. Both sides run with
 * structured terms, so the score reads `decision.terms` rather than
 * guessing from prose.
 *
 * Server-side artifacts accumulate on task.artifacts (visible to anyone
 * who reads the Task). Client-side evaluate() runs locally and its result
 * comes back on A2ATurnResult.artifact instead, since the client doesn't
 * own the server's Task.
 *
 *   bun run examples/05-evaluate-artifacts.ts
 */
import { A2ANegotiationClient, createA2AHandler, strategyWithTerms } from "../src/a2a/index.ts";
import { Negotiator } from "../src/index.ts";
import { type Action, ACTIONS, agentCard, logReply, logTurn, MAX_TURNS } from "./shared.ts";

const TERMS = "activity (string), when (YYYY-MM-DD), neighborhood (string)";
const PREFERRED = new Set(["coffee", "walk"]);

/** Whole days from now until `when`, or null if it isn't a parseable date. */
function daysOut(when: unknown): number | null {
  if (typeof when !== "string") return null;
  const ms = Date.parse(when);
  return Number.isNaN(ms) ? null : Math.round((ms - Date.now()) / 864e5);
}

const handler = createA2AHandler({
  negotiator: new Negotiator(),
  party: {
    name: "Noor",
    objective:
      "Set up a first meeting with Eli: coffee or a walk, somewhere around Kreuzberg, on a weekday evening next week; you'd rather not do dinner on a first meeting",
  },
  allowedActions: [...ACTIONS],
  agentCard: agentCard("Noor's Agent"),
  strategy: strategyWithTerms<Action>(TERMS),
  evaluate: (task, decision) => {
    const activity = decision.terms?.activity;
    return {
      artifactId: crypto.randomUUID(),
      name: "turn-evaluation",
      parts: [
        {
          kind: "data",
          data: {
            turn: task.history.length,
            action: decision.action,
            activity: activity ?? null,
            daysOut: daysOut(decision.terms?.when),
            activityPreferred: typeof activity === "string" && PREFERRED.has(activity.toLowerCase()),
          },
        },
      ],
    };
  },
});

const server = Bun.serve({ port: 0, fetch: handler });
const url = server.url.toString();

const client = new A2ANegotiationClient({
  negotiator: new Negotiator(),
  party: {
    name: "Eli",
    objective:
      "Meet Noor for a first date this week or next; you'd suggest dinner on Friday but are happy with something lighter, and you'd like somewhere near Neukölln",
  },
  allowedActions: [...ACTIONS],
  strategy: strategyWithTerms<Action>(TERMS),
  evaluate: (_task, decision) => ({
    artifactId: crypto.randomUUID(),
    name: "eli-side-note",
    parts: [{ kind: "text", text: `Eli chose ${decision.action}` }],
  }),
  // Prints Eli's line the instant it's decided — the local artifact only
  // exists once evaluate() runs after the round trip, so it's still
  // printed afterward, just without repeating Eli's message.
  onDecision: (decision) => logTurn("Eli", decision),
});

let { task, artifact } = await client.initiate(url);
console.log("  eli-local artifact:", artifact);
logReply("Noor", task);

let turns = 1;
while (task.status.state === "input-required" && turns < MAX_TURNS) {
  ({ task, artifact } = await client.continue(url, task));
  console.log("  eli-local artifact:", artifact);
  logReply("Noor", task);
  turns++;
}

console.log(`\nEnded: ${task.status.state}`);
console.log("\nAll artifacts Noor's Task accumulated (server-side, persisted on the task):");
console.log(JSON.stringify(task.artifacts, null, 2));

server.stop();
