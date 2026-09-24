import { run } from "./loop.ts";
import type { Model } from "./model.ts";
import { tool, type Tool } from "./tool.ts";
import type { Intent, Opportunity, User } from "./types.ts";

/** How long the note may be. The principal reads it as one message. */
const NOTE_LIMIT = 700;

const SUMMARY_PROMPT = [
  "Write a short note (Max 700 characters) to me about what people are saying, as if you sat in the conversations yourself.",
  "Use only the conversations below. Lead with the pattern across them: what people want, where, when, and what they keep asking. Bring in a name, or a role or title, when a particular person is the pattern. Leave people out when the context is the point.",
  "Sound like real life. Three short paragraphs at most. Always start with an opening.",
  "Include, in passing, what already got answered, what is still waiting, and how the conversations landed. Use \"most,\" \"a few,\" and \"one\" when that is true.",
  "Leave out how you know this. No search, no matching, no turns, no agents, no quotes, no labels.",
  "Call submit_note exactly once. That call is this run's whole product: nothing you say outside it is kept.",
].join("\n\n");

/** Everything the summary sees: the talks on one signal that already have a turn. */
export interface SummaryInput {
  user: User;
  intent: Intent;
  opportunities: Opportunity[];
  model: Model;
  now?: () => Date;
  signal?: AbortSignal;
}

/**
 * @param opportunities - Negotiations that already have a turn.
 * @returns The conversations the note is written from, and nothing else.
 */
function conversations(opportunities: Opportunity[]): string {
  return opportunities.map((opportunity) => {
    const lines = [
      opportunity.counterpart,
      opportunity.intent?.statement ? `looking for: ${opportunity.intent.statement}` : "",
      `status: ${opportunity.status}`,
      ...(opportunity.turns ?? []).map((turn) =>
        `${turn.actor === "you" ? "you" : opportunity.counterpart}: ${turn.message}`,
      ),
    ];
    return lines.filter(Boolean).join("\n");
  }).join("\n\n");
}

/**
 * One note about what people are saying across the talks on a signal.
 *
 * @param input - The principal, the signal, and the negotiations that have a turn.
 * @returns The note, or nothing when this run did not land one within the limit.
 */
export async function summarize(input: SummaryInput): Promise<string | undefined> {
  const { user, intent, opportunities } = input;
  let note: string | undefined;

  const tools: Tool<never>[] = [
    tool({
      name: "submit_note",
      description: "The note for your principal. At most 700 characters.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 1, maxLength: NOTE_LIMIT },
        },
        required: ["text"],
      },
      run: ({ text }: { text: string }) => {
        if (note) throw new Error("This run already wrote the note. Stop.");
        if (text.length > NOTE_LIMIT) {
          throw new Error(`The note is ${text.length} characters. Shorten it to ${NOTE_LIMIT}.`);
        }
        note = text;
        return "Note recorded.";
      },
    }),
  ];

  await run({
    model: input.model,
    identity: { id: user.id, name: user.name ? `${user.name}'s personal agent` : user.id },
    intent,
    instructions: SUMMARY_PROMPT,
    prompt: "These are the conversations.\n\n" + conversations(opportunities),
    tools,
    maxSteps: 2,
    ...(input.now ? { now: input.now } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  return note;
}
