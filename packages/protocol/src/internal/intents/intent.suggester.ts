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
- Ground every suggestion in the profile: their work, field, stage, and place. Be concrete
  enough that the right person would recognize themselves, but do not invent facts.
- One line each, at most 90 characters, lowercase, no trailing period, no emoji, no em dashes.
- Skip anything that repeats one of their existing intents.
- If the profile says little, still give three plausible, specific starting points.
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
   * @returns Two "looking_for" suggestions then one "offering", or null when the call fails.
   */
  @Timed()
  public async invoke(input: IntentSuggestionInput): Promise<IntentSuggestion[] | null> {
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
      return [
        ...lookingFor.map((text) => ({ kind: "looking_for" as const, text })),
        { kind: "offering" as const, text: offering },
      ];
    } catch (error) {
      logger.error("Error during execution", { error });
      return null;
    }
  }
}
