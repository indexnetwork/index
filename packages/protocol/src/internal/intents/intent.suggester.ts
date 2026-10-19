import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

// ─── Response schema ───────────────────────────────────────────────────────────

const SuggestionText = z
  .string()
  .describe("One line, at most 90 characters, in the person's own voice, lowercase, no trailing period.");

export const IntentSuggestionOutputSchema = z.object({
  lookingFor: z
    .array(SuggestionText)
    .describe("Exactly two things they might want: someone to learn from, hire, fund, build with, or meet."),
  offering: SuggestionText.describe("One thing they could offer others: their skills, capital, time, or help."),
  examples: z
    .array(z.string().describe("One line, at most 110 characters, lowercase, no trailing period."))
    .describe("Five to seven of the example starters, rewritten for this person in the same casual shape."),
});

// ─── Input types ──────────────────────────────────────────────────────────────

export interface IntentSuggestionInput {
  name: string | null;
  intro: string | null;
  location: string | null;
  /** The person's active intents, so no suggestion repeats one. */
  existingIntents: string[];
}

/** One suggested first intent; `kind` says which side of a match it is on. */
export interface IntentSuggestion {
  kind: "looking_for" | "offering";
  text: string;
}

/** The picks, plus the example starters rewritten for this person. */
export interface IntentSuggestions {
  suggestions: IntentSuggestion[];
  examples: string[];
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = log.lib.from("IntentSuggester");

// ─── System prompt ────────────────────────────────────────────────────────────

const systemPrompt = `
You are someone's agent on Index, a network where an agent finds the right people for its
person by matching intents: what they are looking for and what they can offer.

TASK:
They just joined. From their profile, suggest three intents they could start with:
- two things they might be looking for (someone to learn from, hire, fund, build with, or meet)
- one thing they could offer (their skills, capital, time, or help)

RULES:
- Write each in their voice, first person implied, like they would type it:
  "looking for a technical cofounder who has shipped ml in production",
  "happy to give early founders feedback on their go-to-market".
- Ground every suggestion in the profile: their role and field. What we found may be old, so
  stay at that level: never name a company, product, fund, school, or city, and leave out
  details that go stale (stage, round, team size, dates). Do not invent facts.
- One line each, at most 90 characters, lowercase, no trailing period, no emoji, no em dashes.
- Skip anything that repeats one of their existing intents.
- If the profile says little, still give three plausible, specific starting points.

EXAMPLES:
Also rewrite these generic starters for this person, keeping their short, casual
"situation, want ..." shape:
- traveling soon, want to meet cool people in ai
- building something, want honest feedback on it
- just launched, want cool people to try it
- new in town, want to find my people
- raising soon, want to meet investors who get it
- hiring soon, want to meet great people early
- have an idea, want someone to build it with
Give each a light touch so it feels like theirs: swap the generic part for their broad field or
role, nothing more. A founder in agent infrastructure might get "traveling soon, want to meet people
building or investing in agents". Same limits as above: no company, product, fund, school, or city
names, and nothing that would go stale. Keep them short and loose; one field word is usually enough.
Swap any that do not fit their role for one that does: an investor does not raise, so "raising soon"
becomes something like "deploying capital, want to meet founders in <their broad focus>"; someone who
is not building does not launch. Drop any you cannot make fit, but always keep the traveling one.
Return five to seven, each at most 90 characters, lowercase, no trailing period, no emoji, no em
dashes, and none that repeat the three suggestions above.
`;

// ─── Agent class ──────────────────────────────────────────────────────────────

/**
 * Suggests a new member's first intents from their profile: two they might be
 * looking for and one they could offer. Follows the shared agent pattern:
 * structured output, `invokeWithAbortSignal`, null on error.
 */
export class IntentSuggester {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("suggestionGenerator", IntentSuggestionOutputSchema, {
      name: "intent_suggestions",
    });
  }

  /**
   * @param input - The person's profile and their active intents.
   * @returns Two "looking_for" suggestions then one "offering", with the rewritten examples; null when the call fails.
   */
  @Timed()
  public async invoke(input: IntentSuggestionInput): Promise<IntentSuggestions | null> {
    const clean = (text: string | null, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    const prompt = [
      `## Name\n${clean(input.name, 200) || "(unknown)"}`,
      `## Location\n${clean(input.location, 200) || "(unknown)"}`,
      `## Intro\n${clean(input.intro, 4_000) || "(empty)"}`,
      `## Existing intents\n${input.existingIntents.map((s) => `- ${clean(s, 400)}`).join("\n") || "(none)"}`,
    ].join("\n\n");
    try {
      const result = await invokeWithAbortSignal(this.model, [new SystemMessage(systemPrompt), new HumanMessage(prompt)]);
      const parsed = IntentSuggestionOutputSchema.safeParse(result);
      if (!parsed.success) {
        logger.error("Schema validation failed", { error: parsed.error });
        return null;
      }
      const tidy = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
      const lookingFor = parsed.data.lookingFor.map(tidy).filter(Boolean).slice(0, 2);
      const offering = tidy(parsed.data.offering);
      if (lookingFor.length < 2 || !offering) return null;
      return {
        suggestions: [
          ...lookingFor.map((text) => ({ kind: "looking_for" as const, text })),
          { kind: "offering" as const, text: offering },
        ],
        examples: parsed.data.examples.map(tidy).filter((text) => text && text.length <= 140).slice(0, 7),
      };
    } catch (error) {
      logger.error("Error during execution", { error });
      return null;
    }
  }
}
