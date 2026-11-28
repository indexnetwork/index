import { run } from "./loop.ts";
import type { Model } from "./model.ts";
import { tool, type Tool } from "./tool.ts";
import type { Intent, Opportunity, User } from "./types.ts";

/** Index refuses a longer note. */
export const REPORT_LIMIT = 280;

/** What a note aims for: one glance in a narrow column. */
const NOTE_TARGET = 110;

const REPORT_PROMPT = [
  "Someone introduced your principal to the counterpart, and the two agents have finished talking. Write the introducer one tiny line on how it went.",
  "The agents talked, not the people: the two have not spoken or said yes yet. So credit the agents (\"Viraj and Danny's agents hit it off\"), never the people (never \"Viraj and Danny agreed\").",
  `One sentence, at most ${NOTE_TARGET} characters. Cheerful and a little playful, like a friend texting back. No exclamation marks, no quote marks, no thanks, nothing salesy.`,
  "Privacy first. Name at most one broad shared theme (crypto and AI, climbing, design). Never companies, funds, rounds, amounts, cities, job titles, plans or anything either of them asked or said. Nothing that tells which side wrote it: no \"I\", \"we\", \"my principal\" or \"your\".",
  "If they agreed, say the agents clicked and it is the two of them now. If it did not land, say so lightly in a few words, blaming no one.",
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
      description: `The line for the introducer. At most ${NOTE_TARGET} characters, no quote marks.`,
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
        const line = text.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
        if (line.length > NOTE_TARGET) throw new Error(`The note is ${line.length} characters. Shorten it to ${NOTE_TARGET}.`);
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
    // A second and third step let the model shorten a note the tool sent back.
    maxSteps: 3,
    requireTool: true,
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  return note || undefined;
}
