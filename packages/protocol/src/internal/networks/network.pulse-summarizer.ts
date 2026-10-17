import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

// ─── Response schema ───────────────────────────────────────────────────────────

export const NetworkPulseSummaryOutputSchema = z.object({
  summary: z
    .string()
    .describe("Two to four sentences, at most 70 words, on what members are after. Empty string when there is not enough suitable material."),
  negotiations: z
    .string()
    .describe("One or two sentences, at most 45 words, on what the agents are negotiating about right now. Empty string when no pairs are given or none are suitable."),
});

export type NetworkPulseSummaryOutput = z.infer<typeof NetworkPulseSummaryOutputSchema>;

// ─── Input types ──────────────────────────────────────────────────────────────

export interface NetworkPulseSummaryInput {
  networkTitle: string;
  /** Recent open intents in the network, newest first, as members wrote them. */
  intents: string[];
  /** Recent negotiations: the two intents each pair of agents is weighing. */
  negotiations?: Array<{ a: string; b: string }>;
}

/** What the invite page shows of the room; either part may be absent. */
export interface NetworkPulseSummary {
  summary: string | null;
  negotiations: string | null;
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = log.lib.from("NetworkPulseSummarizer");

// ─── System prompt ────────────────────────────────────────────────────────────

const systemPrompt = `
You write the "what people are looking for" blurb on a network's public invite page.
Anyone holding the invite link reads it, including people who are not members.

TASK:
Read the members' open intents and write a short, clear overview, warm in tone, of what is
going on inside, so a visitor gets a feel for the room. Group intents into themes, e.g.
"A few people are looking for cofounders and early hires, others want to meet investors who
get crypto and AI, and at least one person just wants coffee before the conference."

PRIVACY (strict):
- Describe themes in aggregate. Never quote an intent or reuse its distinctive wording.
- No names of people, companies, products, projects, schools, or events.
- No places more specific than a broad region, no dates, numbers, amounts, links, or handles.
- Use loose quantities ("a few", "some", "several", "others"). Never "one person" for
  anything specific enough to point at someone.
- Leave out entirely anything sexual or romantic, medical, legal, financial distress,
  religious, political, illegal, hateful, or otherwise sensitive or crude. Do not hint at it.

STYLE:
- Two to four sentences, at most 70 words. Plain, friendly English.
- Mostly matter-of-fact: say clearly what kinds of people and asks are in the room. A light
  touch of warmth is welcome in one phrase (the range of the room, an unexpected neighbour of
  asks), but no punchlines and nothing at anyone's expense.
- No emoji, no exclamation marks, no em dashes, no headings or lists.
- Do not mention intents, agents, Index, or the network's name. Start with the content.

If fewer than three intents are suitable after the rules above, return an empty summary.

NEGOTIATIONS:
You may also get pairs of intents that two members' agents are negotiating over right now.
In "negotiations", say in one or two sentences, at most 45 words, what the agents are talking
about at a very high level: the kind of deal, never its details ("a few are working out
cofounder intros, others are trading notes on a speaking slot"). Same privacy rules, same
tone, at most one light touch of humor. Do not invent names for the agents. If no pairs are
given or none are suitable, return an empty string.
`;

// ─── Agent class ──────────────────────────────────────────────────────────────

/**
 * Writes the anonymous "what people are looking for" overview for a network's
 * public invite page. Follows the shared agent pattern: structured output,
 * `invokeWithAbortSignal`, null on error.
 */
export class NetworkPulseSummarizer {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("networkPulseSummarizer", NetworkPulseSummaryOutputSchema, {
      name: "network_pulse_summary",
    });
  }

  /**
   * @param input - The network's title, its recent open intents and negotiating pairs.
   * @returns Both texts (each null when there is nothing suitable), or null when the call fails.
   */
  @Timed()
  public async invoke(input: NetworkPulseSummaryInput): Promise<NetworkPulseSummary | null> {
    const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 400);
    const intents = input.intents.map(clean).filter(Boolean);
    const pairs = (input.negotiations ?? []).map((p) => ({ a: clean(p.a), b: clean(p.b) })).filter((p) => p.a && p.b);
    if (intents.length < 3 && pairs.length < 2) return { summary: null, negotiations: null };

    const prompt = [
      `## Network\n${input.networkTitle}`,
      `## Open intents\n${intents.map((s) => `- ${s}`).join("\n") || "(none)"}`,
      `## Negotiating pairs\n${pairs.map((p) => `- ${p.a}  <->  ${p.b}`).join("\n") || "(none)"}`,
    ].join("\n\n");
    try {
      const result = await invokeWithAbortSignal(this.model, [new SystemMessage(systemPrompt), new HumanMessage(prompt)]);
      const parsed = NetworkPulseSummaryOutputSchema.safeParse(result);
      if (!parsed.success) {
        logger.error("Schema validation failed", { error: parsed.error });
        return null;
      }
      const tidy = (text: string) => text.replace(/\s+/g, " ").trim() || null;
      return { summary: tidy(parsed.data.summary), negotiations: tidy(parsed.data.negotiations) };
    } catch (error) {
      logger.error("Error during execution", { error });
      return null;
    }
  }
}
