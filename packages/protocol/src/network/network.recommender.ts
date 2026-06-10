import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

// ─── Response schema ───────────────────────────────────────────────────────────

export const NetworkRecommenderOutputSchema = z.object({
  rankedNetworkIds: z
    .array(z.string())
    .describe("Network IDs ordered from most to least relevant for this user. Include all provided network IDs."),
  reasoning: z
    .string()
    .describe("One-sentence explanation of the top recommendation."),
});

export type NetworkRecommenderOutput = z.infer<typeof NetworkRecommenderOutputSchema>;

// ─── Input types ──────────────────────────────────────────────────────────────

export interface NetworkRecommenderUserProfile {
  bio: string;
  location: string;
  interests: string[];
  skills: string[];
}

export interface NetworkRecommenderNetwork {
  networkId: string;
  renderedContext: string;
}

export interface NetworkRecommenderInput {
  userProfile: NetworkRecommenderUserProfile;
  networks: NetworkRecommenderNetwork[];
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = log.lib.from("NetworkRecommender");

// ─── System prompt ────────────────────────────────────────────────────────────

const systemPrompt = `
You are a community matching agent for a social discovery network.

TASK:
Given a user's profile and a list of communities, rank the communities from most to least relevant for this user.
Return ALL provided community IDs in ranked order.

INPUTS:
1. User Profile: bio, location, interests, and skills.
2. Communities: a list of communities, each with an ID and a description.

SCORING FACTORS (in priority order):
1. Thematic alignment — do the community's topics match the user's interests and skills?
2. Geographic relevance — does the user's location match the community's focus (if any)?
3. Professional fit — does the community's purpose match the user's professional background?

OUTPUT RULES:
- Return ALL community IDs in your ranked list (no omissions).
- If context is insufficient to differentiate, preserve original order.
- Keep reasoning brief (one sentence about the top recommendation).
`;

// ─── Agent class ──────────────────────────────────────────────────────────────

/**
 * LLM-based agent that ranks public communities against a user's profile.
 * Used during onboarding step 6 to surface the most relevant communities first.
 *
 * Follows the IntentIndexer pattern: `withStructuredOutput`, `invokeWithAbortSignal`,
 * null-on-error fallback. `createModel` is called inside the constructor (not at
 * module level) so that importing this file does not require OPENROUTER_API_KEY to
 * be set — tests that import `createNetworkTools` without a live LLM env are unaffected.
 */
export class NetworkRecommender {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    const model = createModel("networkRecommender");
    this.model = model.withStructuredOutput(NetworkRecommenderOutputSchema, {
      name: "network_recommender",
    });
  }

  /**
   * Ranks the provided networks by relevance to the user's profile.
   *
   * @param input - User profile and list of networks with rendered context.
   * @returns Ranked network IDs and one-sentence reasoning, or null on error.
   */
  @Timed()
  public async invoke(input: NetworkRecommenderInput): Promise<NetworkRecommenderOutput | null> {
    if (input.networks.length === 0) return null;

    logger.verbose("[NetworkRecommender.invoke] Ranking communities", {
      networkCount: input.networks.length,
    });

    const networkList = input.networks
      .map((n, i) => `### Community ${i + 1} (ID: ${n.networkId})\n${n.renderedContext}`)
      .join("\n\n");

    const userSection = [
      `**Bio**: ${input.userProfile.bio || "(not provided)"}`,
      `**Location**: ${input.userProfile.location || "(not provided)"}`,
      `**Interests**: ${input.userProfile.interests.join(", ") || "(not provided)"}`,
      `**Skills**: ${input.userProfile.skills.join(", ") || "(not provided)"}`,
    ].join("\n");

    const prompt = `## User Profile\n${userSection}\n\n## Communities to Rank\n${networkList}`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    try {
      const result = await invokeWithAbortSignal(this.model, messages);
      const parsed = NetworkRecommenderOutputSchema.safeParse(result);
      if (!parsed.success) {
        logger.error("[NetworkRecommender] Schema validation failed", { error: parsed.error });
        return null;
      }
      logger.verbose("[NetworkRecommender.invoke] Ranking complete", {
        top: parsed.data.rankedNetworkIds[0],
      });
      return parsed.data;
    } catch (error) {
      logger.error("[NetworkRecommender] Error during execution", { error });
      return null;
    }
  }
}
