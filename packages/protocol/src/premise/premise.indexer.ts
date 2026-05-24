import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";

const logger = protocolLogger("PremiseIndexer");

const model = createModel("premiseIndexer");

const systemPrompt = `
You are a Premise Evaluator for a social networking protocol.

TASK:
Determine if a User Premise (a self-descriptive proposition about who someone is) is relevant to a specific Index (community).

INPUTS:
1. Premise: A self-description the user asserts about themselves.
2. Index Prompt: The purpose/scope of the target community (Index).
3. Member Prompt: The specific sharing preferences of the user in that community (optional).

SCORING RUBRIC:
- 0.9-1.0: Highly relevant. The premise directly relates to the community's purpose.
- 0.7-0.8: Good relevance. The premise is clearly adjacent to the community's focus.
- 0.5-0.6: Moderate. Borderline relevance.
- 0.3-0.4: Low relevance. Weak connection.
- 0.0-0.2: Not relevant. The premise has no connection to this community.

OUTPUT RULES:
- Provide indexScore based on how well the Premise fits the Index Prompt.
- Provide memberScore based on how well the Premise fits the Member Prompt (if provided). If Member Prompt is missing/empty, return 0.0.
- Provide concise reasoning.
`;

const responseFormat = z.object({
  indexScore: z.number().min(0).max(1).describe("Score for index relevance (0.0-1.0)"),
  memberScore: z.number().min(0).max(1).describe("Score for member preference match (0.0-1.0)"),
  reasoning: z.string().describe("Brief reasoning for the scores"),
});

export type PremiseIndexerOutput = z.infer<typeof responseFormat>;

/**
 * Scores a premise's relevancy to a network based on the index and member prompts.
 */
export class PremiseIndexer {
  private model: ReturnType<typeof model.withStructuredOutput>;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "premise_indexer"
    });
  }

  /**
   * Scores the relevancy of a premise to a network index and member preferences.
   *
   * @param input - The premise text, index prompt, member prompt, and optional network context.
   * @returns Structured output with indexScore, memberScore, and reasoning.
   */
  @Timed()
  public async invoke(input: {
    premiseText: string;
    indexPrompt: string;
    memberPrompt?: string;
    networkContext?: string;
  }): Promise<PremiseIndexerOutput> {
    logger.verbose(`[PremiseIndexer.invoke] Scoring premise against index`);

    const prompt = [
      "# Premise",
      input.premiseText,
      "",
      "# Index Prompt",
      input.indexPrompt || "(No index prompt provided)",
      "",
      "# Member Prompt",
      input.memberPrompt || "(No member prompt provided)",
      ...(input.networkContext ? ["", "# Network Context", input.networkContext] : []),
    ].join("\n");

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    const result = await this.model.invoke(messages);
    return responseFormat.parse(result);
  }
}
