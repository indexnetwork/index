import { run } from "./loop.ts";
import type { Model } from "./model.ts";
import { tool, type Tool } from "./tool.ts";
import type { Intent, Opportunity, User } from "./types.ts";

/** Index refuses a longer note. */
export const REPORT_LIMIT = 280;

const REPORT_PROMPT = [
  "Someone introduced your principal to the counterpart, and the two agents have finished talking. Write the introducer one line on how it went: where it landed and, in plain words, why.",
  "Write about the two of them by first name, from the outside: never \"I\", \"we\", \"my principal\" or \"your\", and nothing that tells which side wrote it. The introducer never learns which side sent it.",
  "Give the gist, never the talk: no quotes, no turns, no who-asked-what, no agents, no negotiation words. Say nothing about your principal the counterpart could not already see, and nothing about what either of them keeps private.",
  "If they agreed, say what the two have to talk about and that it is now up to them. If it did not land, say so kindly in a few words, blaming no one.",
  `One or two short sentences, plain and warm, at most ${REPORT_LIMIT} characters. Not salesy, no exclamation marks, no thanks.`,
  "Call submit_note exactly once. That call is this run's whole product.",
].join("\n\n");

/** Everything a report sees: the principal, their intent, and the settled negotiation. */
export interface ReportInput {
  user: User;
  intent: Intent;
  /** A settled negotiation that a third party introduced. */
  opportunity: Opportunity;
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
}

/**
 * @param input - The principal and the settled, introduced negotiation.
 * @returns What the report is written from.
 */
function context({ user, intent, opportunity }: ReportInput): string {
  const lines = [
    `Introducer: ${opportunity.introducer?.name ?? "someone you both know"}`,
    `Their note when they introduced the two: ${opportunity.introducer?.context ?? ""}`,
    `Your principal: ${user.name ?? "your principal"}`,
    intent.statement ? `What your principal is after: ${intent.statement}` : "",
    `Counterpart: ${opportunity.counterpart}`,
    opportunity.intent?.statement ? `What the counterpart is after: ${opportunity.intent.statement}` : "",
    opportunity.bio ? `Counterpart's bio: ${opportunity.bio}` : "",
    `Where it landed: ${opportunity.status}`,
    "How the talk went, for you only (never quote it):",
    ...(opportunity.turns ?? []).map((turn) => `- ${turn.actor === "you" ? "your side" : "their side"} ${turn.action}: ${turn.message}`),
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * One line back to whoever introduced this pair, once its talks settled.
 *
 * @param input - The principal and the settled, introduced negotiation.
 * @returns The note, or nothing when this run did not land one within the limit.
 */
export async function report(input: ReportInput): Promise<string | undefined> {
  const { user, intent } = input;
  let note: string | undefined;

  const tools: Tool<never>[] = [
    tool({
      name: "submit_note",
      description: `The line for the introducer. At most ${REPORT_LIMIT} characters.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 1, maxLength: REPORT_LIMIT },
        },
        required: ["text"],
      },
      run: ({ text }: { text: string }) => {
        if (note) throw new Error("This run already wrote the note. Stop.");
        const line = text.replace(/\s+/g, " ").trim();
        if (line.length > REPORT_LIMIT) throw new Error(`The note is ${line.length} characters. Shorten it to ${REPORT_LIMIT}.`);
        note = line;
        return "Note recorded.";
      },
    }),
  ];

  await run({
    model: input.model,
    operation: "report",
    identity: { id: user.id, name: user.name ? `${user.name}'s agent` : user.id },
    intent,
    instructions: REPORT_PROMPT,
    prompt: context(input),
    tools,
    maxSteps: 2,
    requireTool: true,
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  return note || undefined;
}
