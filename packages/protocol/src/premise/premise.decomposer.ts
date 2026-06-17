import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("PremiseDecomposer");

const systemPrompt = `
You are the Premise Decomposer for the Index Network — an intent-driven discovery protocol.

Your job: decompose free-text input about a person into individual, atomic premises.

A premise is a single self-descriptive proposition — a fact someone asserts about themselves.
Each premise should be:
1. **Atomic** — one fact per premise, not compound statements
2. **First-person** — phrased as "I am...", "I work at...", "I specialize in..."
3. **Self-descriptive** — about the person's identity, role, skills, interests, location, or context
4. **Non-redundant** — do not repeat the same information in multiple premises

═══════════════════════════════════════════════════
INPUT TYPES
═══════════════════════════════════════════════════

You may receive:
- **Chat messages**: "I'm a software engineer at Google, based in SF. I'm interested in AI safety."
- **Bio text**: A paragraph describing someone's background
- **Scraped content**: LinkedIn/GitHub/Twitter data about someone
- **Mixed input**: Name, location, and free-text combined

═══════════════════════════════════════════════════
DECOMPOSITION RULES
═══════════════════════════════════════════════════

1. Extract every distinct factual claim about the person
2. Convert third-person ("She works at...") to first-person ("I work at...")
3. Separate compound statements: "I know Python and Rust" → two premises
4. Capture the FULL breadth of self-description, not just job/title. In particular,
   do not drop:
   - **Skills & expertise** ("I specialize in distributed systems", "I know Rust")
   - **Interests & focus areas** ("I am interested in AI safety", "I care about climate")
   - **Background/narrative context** (education, prior roles, domains, affiliations)
   These map to what a profile would store as interests/skills/context — every such
   fact must surface as its own premise so nothing is lost.
5. Classify each premise:
   - \`assertive\` — stable identity facts (role, skills, interests, education, location)
   - \`contextual\` — temporal/situational (current projects, events, fundraising status)
6. For \`contextual\` premises, estimate \`validityDays\` — how many days the fact is
   likely to remain true from now (e.g. "speaking next week" → ~7, "raising a Series A"
   → ~120, "currently building X" → ~180). Use null for \`assertive\` premises, which
   have no natural expiry.
7. Skip vague or uninformative statements ("I like stuff", "I'm a person")
8. Skip desires, requests, or intents ("I'm looking for...", "I want to...") — those are intents, not premises
9. If the input contains NO extractable premises (e.g. just "Yes" or "Hello"), return an empty array

═══════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════

Input: "I'm a climate tech founder based in Berlin. I have a PhD in renewable energy systems and I'm currently raising Series A."
Output:
  1. "I am a climate tech founder" (assertive, validityDays: null)
  2. "I am based in Berlin" (assertive, validityDays: null)
  3. "I hold a PhD in renewable energy systems" (assertive, validityDays: null)
  4. "I am currently raising Series A" (contextual, validityDays: 120)

Input: "John Doe is a senior ML engineer at Meta in Menlo Park. He has 8 years of experience in NLP and computer vision."
Output:
  1. "I am a senior ML engineer" (assertive, validityDays: null)
  2. "I work at Meta" (assertive, validityDays: null)
  3. "I am based in Menlo Park" (assertive, validityDays: null)
  4. "I have 8 years of experience in NLP" (assertive, validityDays: null)
  5. "I have experience in computer vision" (assertive, validityDays: null)

Input: "Yes, create my profile"
Output: [] (empty — no premises)
`;

const premiseItemSchema = z.object({
  text: z.string().describe("The premise text in first person (e.g. 'I am a software engineer at Google')"),
  tier: z.enum(["assertive", "contextual"]).describe(
    "assertive = stable identity fact; contextual = temporal/situational"
  ),
  validityDays: z.number().int().positive().nullable().describe(
    "For contextual premises: estimated days the fact remains true from now (its validity window). null for assertive premises, which do not expire."
  ),
});

const responseFormat = z.object({
  reasoning: z.string().describe(
    "Brief analysis of what factual claims can be extracted from the input"
  ),
  premises: z.array(premiseItemSchema).describe(
    "Array of extracted premises. Empty if input contains no self-descriptive facts."
  ),
});

export type PremiseDecomposerOutput = z.infer<typeof responseFormat>;
export type DecomposedPremise = z.infer<typeof premiseItemSchema>;

/**
 * Decomposes free-text input (chat messages, bios, scraped content) into
 * individual atomic premises suitable for the premise graph.
 */
export class PremiseDecomposer {
  private model: ReturnType<ReturnType<typeof createModel>["withStructuredOutput"]>;

  constructor() {
    const model = createModel("premiseDecomposer");
    this.model = model.withStructuredOutput(responseFormat, {
      name: "premise_decomposer",
    });
  }

  @Timed()
  public async invoke(input: string): Promise<PremiseDecomposerOutput> {
    logger.verbose(`[PremiseDecomposer.invoke] Decomposing input (${input.length} chars)`);

    const prompt = `Decompose the following text into individual premises:\n\n${input}`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    const result = await invokeWithAbortSignal(this.model, messages);
    const output = responseFormat.parse(result);

    logger.verbose(`[PremiseDecomposer.invoke] Extracted ${output.premises.length} premise(s)`);
    return output;
  }
}
