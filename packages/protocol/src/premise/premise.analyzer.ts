import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("PremiseAnalyzer");
const invokeLog = protocolLogger("PremiseAnalyzer:invoke");

const systemPrompt = `
You are the Premise Analyzer for the Index Network — an intent-driven discovery protocol.

Your job: classify a self-descriptive premise using adapted Speech Act Theory, then score its felicity conditions.

A premise is a proposition a person asserts about themselves. It is NOT a desire or request (those are intents). Premises are conditions of possibility — facts about who someone is that ground opportunity discovery.

Always reason before classifying. Output reasoning first.

═══════════════════════════════════════════════════
STEP 1 — CLASSIFY THE SPEECH ACT
═══════════════════════════════════════════════════

DECLARATIVE: The premise constitutes a fact about the speaker's identity, role, or status.
  Examples:
  · "I am a climate-tech founder" → DECLARATIVE
  · "I hold a PhD in computational biology" → DECLARATIVE
  · "I am based in Berlin" → DECLARATIVE
  · "I am raising Series A" → DECLARATIVE (constitutes current status)

ASSERTIVE: The premise describes a capability, experience, or characteristic.
  Examples:
  · "I have 10 years of experience in distributed systems" → ASSERTIVE
  · "I built a collaboration platform used by 50k users" → ASSERTIVE
  · "I speak fluent Mandarin and German" → ASSERTIVE
  · "I specialize in zero-knowledge proofs" → ASSERTIVE

═══════════════════════════════════════════════════
STEP 2 — SCORE THE FELICITY CONDITIONS (0–100)
═══════════════════════════════════════════════════

AUTHORITY (Preparatory Condition)
  Does the speaker plausibly have standing to assert this?
  100 → Highly specific, verifiable claim ("I founded X in 2019")
   60 → Plausible but unverifiable ("I have deep expertise in AI")
   20 → Implausible or grandiose ("I am the world's leading expert")

SINCERITY (Sincerity Condition)
  Does the linguistic form suggest genuine self-description vs. aspiration?
  100 → Present tense, first person, specific ("I am a YC-backed founder")
   60 → Hedged or aspirational ("I'm sort of getting into crypto")
   20 → Clearly aspirational masquerading as fact ("I'm basically a VC")

CLARITY (Essential Condition)
  How specific and matchable is this premise?
  100 → "I build distributed database systems in Rust at a Series B startup"
   60 → "I work in tech" (clear direction, vague spec)
   20 → "I do things" (barely informative)

SEMANTIC ENTROPY → 0.0 to 1.0
  0.0 = maximally constrained (role + domain + location + stage all specified)
  1.0 = no constraints at all
  0.0 example: "I am a senior ML engineer at Google Brain in Mountain View"
  1.0 example: "I'm a person"
`;

const responseFormat = z.object({
  reasoning: z.string().describe(
    "Step-by-step analysis: (1) whether this is DECLARATIVE or ASSERTIVE and why, " +
    "(2) felicity condition assessment."
  ),
  speechActType: z.enum(["DECLARATIVE", "ASSERTIVE"]).describe(
    "DECLARATIVE = constitutes identity/role/status; ASSERTIVE = describes capability/experience"
  ),
  felicityAuthority: z.number().min(0).max(100).describe(
    "Preparatory: does the speaker plausibly have standing to assert this (0-100)"
  ),
  felicitySincerity: z.number().min(0).max(100).describe(
    "Sincerity: genuine self-description vs. aspirational (0-100)"
  ),
  felicityClarity: z.number().min(0).max(100).describe(
    "Essential: how specific and matchable is this premise (0-100)"
  ),
  semanticEntropy: z.number().min(0).max(1).describe(
    "Constraint density: 0.0 = maximally specific, 1.0 = completely unconstrained"
  ),
});

export type PremiseAnalyzerOutput = z.infer<typeof responseFormat>;

/**
 * Classifies a premise using adapted Speech Act Theory and scores felicity conditions.
 */
export class PremiseAnalyzer {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("premiseAnalyzer", responseFormat, {
      name: "premise_analyzer"
    });
  }

  @Timed()
  public async invoke(premiseText: string, profileContext?: string): Promise<PremiseAnalyzerOutput> {
    invokeLog.verbose('Analyzing premise text', { preview: premiseText.substring(0, 50) });

    const contextBlock = profileContext
      ? `\n# Speaker Profile (Context)\n${profileContext}\n`
      : "";

    const prompt = `${contextBlock}
# Premise to Analyze
"${premiseText}"

Classify this premise and score its felicity conditions.`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    const result = await invokeWithAbortSignal(this.model, messages);
    const output = responseFormat.parse(result);

    invokeLog.verbose('Analysis result', { speechActType: output.speechActType, semanticEntropy: output.semanticEntropy });
    return output;
  }
}
