import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
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
10. NEVER extract denials or removal instructions as premises. "I have nothing to do with X",
    "I am not a Y", or "remove X from my profile" are retractions, not facts — handle them
    via the retraction rules below and do NOT emit a premise for them.

═════════════════════════════════════════════════
RETRACTION RULES
═════════════════════════════════════════════════

When the message includes the user's EXISTING PREMISES (listed with ids), you must also
detect which of them the input disavows and return their ids in \`retractedPremiseIds\`.

A premise must be retracted when the input:
- Explicitly asks to remove it ("remove all mentions of X", "delete the part about Y")
- Denies it ("I have nothing to do with X", "I never worked at Y", "that's not true")
- States it no longer holds ("I no longer live in Berlin", "I left Google")
- Directly contradicts it ("I'm based in Istanbul" contradicts "I am based in Ankara")

Rules:
- Only return ids that appear in the provided EXISTING PREMISES list — never invent ids.
- Retract EVERY existing premise that matches the disavowed topic, not just the first one.
- Do not retract premises the input merely omits — silence is not disavowal.
- If no existing premises are provided, or nothing is disavowed, return an empty array.
- Retraction and extraction are independent: an input can retract old premises AND
  contribute new ones in the same pass.

═══════════════════════════════════════════════════
BIO REVISION RULES
═══════════════════════════════════════════════════

When the message includes the user's CURRENT BIO, check whether the input disavows,
removes, or corrects anything that appears in it.

- If it does, return \`revisedBio\`: the bio rewritten with those facts removed or
  corrected. Preserve everything the input does not dispute — same tone, similar
  length, no inventions.
- If the input explicitly rewrites the bio ("update my bio to X"), return that
  rewritten bio.
- NEVER add new facts to the bio — new information becomes premises, not bio edits.
  Purely additive input ("I also enjoy X") must return revisedBio: null.
- If the bio is unaffected, or no CURRENT BIO was provided, return null.
- Never return a revised bio that still mentions a disavowed fact.

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

Input: "Remove all mentions of the HOPE programming language. I have nothing to do with it. I specialize in compiler design."
Existing premises:
  - id: aaaa-1 · "I am the creator of the HOPE programming language"
  - id: aaaa-2 · "I specialize in compiler design"
  - id: aaaa-3 · "I am based in Istanbul"
Current bio: "Software engineer in Istanbul. Creator of the HOPE programming language. Specializes in compiler design."
Output:
  premises: [] (compiler design already exists as aaaa-2 — nothing new to add)
  retractedPremiseIds: ["aaaa-1"]
  revisedBio: "Software engineer in Istanbul. Specializes in compiler design."
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
  retractedPremiseIds: z.array(z.string()).default([]).describe(
    "Ids of EXISTING premises (from the provided list) that the input disavows, denies, or asks to remove. Empty when nothing is disavowed or no existing premises were provided."
  ),
  revisedBio: z.string().nullable().default(null).describe(
    "When the input disavows or corrects facts that appear in the provided CURRENT BIO, the bio rewritten without those facts (preserving everything else). null when the bio is unaffected or no bio was provided."
  ),
});

/** An existing ACTIVE premise offered to the decomposer for retraction matching. */
export interface ExistingPremiseRef {
  id: string;
  text: string;
}

export type PremiseDecomposerOutput = z.infer<typeof responseFormat>;
export type DecomposedPremise = z.infer<typeof premiseItemSchema>;

/**
 * Decomposes free-text input (chat messages, bios, scraped content) into
 * individual atomic premises suitable for the premise graph.
 */
export class PremiseDecomposer {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("premiseDecomposer", responseFormat, {
      name: "premise_decomposer",
    });
  }

  @Timed()
  public async invoke(input: string, existingPremises?: ExistingPremiseRef[], currentBio?: string): Promise<PremiseDecomposerOutput> {
    logger.verbose(`[PremiseDecomposer.invoke] Decomposing input (${input.length} chars, ${existingPremises?.length ?? 0} existing premise(s), bio: ${currentBio ? 'yes' : 'no'})`);

    const existingBlock = existingPremises?.length
      ? `\n\nEXISTING PREMISES (retract by id when the input disavows them):\n${existingPremises
          .map((p) => `- id: ${p.id} · "${p.text}"`)
          .join("\n")}`
      : "";

    const bioBlock = currentBio?.trim()
      ? `\n\nCURRENT BIO (return revisedBio when the input disavows or corrects anything in it):\n${currentBio.trim()}`
      : "";

    const prompt = `Decompose the following text into individual premises:\n\n${input}${existingBlock}${bioBlock}`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    const result = await invokeWithAbortSignal(this.model, messages);
    const output = responseFormat.parse(result);

    // Guard against hallucinated ids: only keep retractions that reference premises we offered.
    const knownIds = new Set((existingPremises ?? []).map((p) => p.id));
    const droppedIds = output.retractedPremiseIds.filter((id) => !knownIds.has(id));
    if (droppedIds.length > 0) {
      logger.warn(`[PremiseDecomposer.invoke] Dropped ${droppedIds.length} unknown retraction id(s)`, { droppedIds });
    }
    output.retractedPremiseIds = output.retractedPremiseIds.filter((id) => knownIds.has(id));

    // A revised bio is only meaningful when we offered one to revise. Also
    // normalize structured-output quirks: literal "null", empty strings, and
    // no-op rewrites all mean "bio unaffected".
    const normalizedBio = output.revisedBio?.trim();
    if (
      !currentBio?.trim() ||
      !normalizedBio ||
      normalizedBio.toLowerCase() === 'null' ||
      normalizedBio === currentBio.trim()
    ) {
      output.revisedBio = null;
    } else {
      output.revisedBio = normalizedBio;
    }

    logger.verbose(`[PremiseDecomposer.invoke] Extracted ${output.premises.length} premise(s), ${output.retractedPremiseIds.length} retraction(s), revisedBio: ${output.revisedBio ? 'yes' : 'no'}`);
    return output;
  }
}
