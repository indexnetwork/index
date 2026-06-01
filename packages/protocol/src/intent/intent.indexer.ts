import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

// ──────────────────────────────────────────────────────────────
// Response schema
// ──────────────────────────────────────────────────────────────

export const IntentIndexerOutputSchema = z.object({
  indexScore: z.number().min(0).max(1).describe("Score for index appropriateness (0.0-1.0)"),
  memberScore: z.number().min(0).max(1).describe("Score for member preference match (0.0-1.0)"),
  reasoning: z.string().describe("Brief reasoning for the scores"),
});

/**
 * Output structure for the Intent Indexer agent.
 */
export type IntentIndexerOutput = z.infer<typeof IntentIndexerOutputSchema>;

const logger = log.lib.from("IntentIndexer");

const model = createModel("intentIndexer");

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are an expert Intent Evaluator for a social networking protocol.

TASK:
Determine if a User Intent is appropriate for a specific Index (community) and matches a Member's sharing preferences.

INPUTS:
1. Intent: The content/action the user wants to perform.
2. Index Prompt: The purpose/scope of the target community (Index).
3. Member Prompt: The specific sharing preferences of the user in that community (optional).
4. Source: Origin of the intent (file, link, etc.) (optional).
5. Network Context: Rendered context about the network including type, dates, location, and events (optional).

NETWORK TYPE AWARENESS:
- When Network Context is provided, use it to inform your scoring.
- For EVENT networks: consider temporal relevance. An intent about "meeting at the venue" is highly relevant to an upcoming event but irrelevant after it ends. Intents about topics aligned with the event's themes should score higher.
- For COMMUNITY networks: score based on the index prompt and member preferences as usual.
- If the network context includes dates and the intent is time-sensitive, factor temporal proximity into the score.

SCORING RUBRIC:
- 0.9-1.0: Highly appropriate, perfect match.
- 0.7-0.8: Good match, relevant.
- 0.5-0.6: Moderate, borderline.
- 0.3-0.4: Low appropriateness, poor fit.
- 0.0-0.2: Not appropriate.

OUTPUT RULES:
- Provide \`indexScore\` based on how well the Intent fits the Index Prompt.
- Provide \`memberScore\` based on how well the Intent fits the Member Prompt (if provided). If Member Prompt is missing/empty, return 0.0 for memberScore.
- Provide concise \`reasoning\`.
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const responseFormat = IntentIndexerOutputSchema;

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

type ResponseType = z.infer<typeof responseFormat>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class IntentIndexer {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "intent_indexer",
    });
  }

  /**
   * Converts the structured response into a string for logging or embedding.
   * Used when the output needs to be serialized (e.g. for traces).
   */
  private toString(output: ResponseType): string {
    return [
      `indexScore: ${output.indexScore}`,
      `memberScore: ${output.memberScore}`,
      `reasoning: ${output.reasoning}`,
    ].join("\n");
  }

  /**
   * Main entry point. Evaluates the appropriateness of an intent for a given index and member context.
   *
   * @param intent - The intent payload.
   * @param indexPrompt - The purpose of the index (community).
   * @param memberPrompt - The member's sharing preferences (optional).
   * @param sourceName - Optional source name for context (e.g. file, link).
   * @param networkContext - Optional rendered network context (type, dates, metadata).
   * @returns Structured output with indexScore, memberScore, and reasoning, or null on error.
   */
  @Timed()
  public async invoke(
    intent: string,
    indexPrompt: string | null,
    memberPrompt: string | null,
    sourceName?: string | null,
    networkContext?: string | null
  ): Promise<IntentIndexerOutput | null> {
    logger.verbose("[IntentIndexer.invoke] Evaluating intent");

    const contextParts: string[] = [];
    if (sourceName) contextParts.push(`Source: ${sourceName}`);
    contextParts.push(indexPrompt ? `Index Purpose: ${indexPrompt}` : "Index Purpose: (Not provided)");
    contextParts.push(memberPrompt ? `Member Preferences: ${memberPrompt}` : "Member Preferences: (Not provided)");
    if (networkContext) contextParts.push(`Network Context:\n${networkContext}`);

    const prompt = `
      # Context
      ${contextParts.join("\n")}

      # Intent
      ${intent}

      Evaluate the appropriateness of this intent.
    `;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    try {
      const result = await invokeWithAbortSignal(this.model, messages);
      const output = responseFormat.parse(result) as IntentIndexerOutput;

      logger.verbose("[IntentIndexer.invoke] Evaluation complete", {
        indexScore: output.indexScore,
        memberScore: output.memberScore,
      });
      return output;
    } catch (error) {
      logger.error("[IntentIndexer] Error during execution", { error });
      return null;
    }
  }

  /**
   * Alias for invoke. Evaluates the appropriateness of an intent for a given index and member context.
   * Kept for compatibility with callers (e.g. Index Graph) that use evaluate().
   */
  @Timed()
  public async evaluate(
    intent: string,
    indexPrompt: string | null,
    memberPrompt: string | null,
    sourceName?: string | null,
    networkContext?: string | null
  ): Promise<IntentIndexerOutput | null> {
    return this.invoke(intent, indexPrompt, memberPrompt, sourceName, networkContext);
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   * Useful for composing agents into larger graphs.
   */
  public static asTool() {
    return tool(
      async (args: {
        intent: string;
        indexPrompt: string | null;
        memberPrompt: string | null;
        sourceName?: string | null;
        networkContext?: string | null;
      }) => {
        const agent = new IntentIndexer();
        return await agent.invoke(
          args.intent,
          args.indexPrompt,
          args.memberPrompt,
          args.sourceName,
          args.networkContext
        );
      },
      {
        name: "intent_indexer",
        description:
          "Evaluates whether an intent is appropriate for a specific index (community or event) and matches member sharing preferences.",
        schema: z.object({
          intent: z.string().describe("The intent payload to evaluate"),
          indexPrompt: z.string().nullable().describe("The purpose of the index (community)"),
          memberPrompt: z.string().nullable().describe("The member's sharing preferences"),
          sourceName: z.string().nullable().optional().describe("Optional source name for context"),
          networkContext: z.string().nullable().optional().describe("Optional rendered network context (type, dates, metadata)"),
        }),
      }
    );
  }
}
