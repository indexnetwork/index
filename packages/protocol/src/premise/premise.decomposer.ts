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
4. Classify each premise:
   - \`assertive\` — stable identity facts (role, skills, education, location)
   - \`contextual\` — temporal/situational (current projects, events, fundraising status)
5. Skip vague or uninformative statements ("I like stuff", "I'm a person")
6. Skip desires, requests, or intents ("I'm looking for...", "I want to...") — those are intents, not premises
7. If the input contains NO extractable premises (e.g. just "Yes" or "Hello"), return an empty array

═══════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════

Input: "I'm a climate tech founder based in Berlin. I have a PhD in renewable energy systems and I'm currently raising Series A."
Output:
  1. "I am a climate tech founder" (assertive)
  2. "I am based in Berlin" (assertive)
  3. "I hold a PhD in renewable energy systems" (assertive)
  4. "I am currently raising Series A" (contextual)

Input: "John Doe is a senior ML engineer at Meta in Menlo Park. He has 8 years of experience in NLP and computer vision."
Output:
  1. "I am a senior ML engineer" (assertive)
  2. "I work at Meta" (assertive)
  3. "I am based in Menlo Park" (assertive)
  4. "I have 8 years of experience in NLP" (assertive)
  5. "I have experience in computer vision" (assertive)

Input: "Yes, create my profile"
Output: [] (empty — no premises)
`;

const premiseItemSchema = z.object({
  text: z.string().describe("The premise text in first person (e.g. 'I am a software engineer at Google')"),
  tier: z.enum(["assertive", "contextual"]).describe(
    "assertive = stable identity fact; contextual = temporal/situational"
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
