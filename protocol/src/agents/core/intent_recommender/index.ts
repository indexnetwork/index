/**
 * Intent Recommender Agent
 * 
 * Analyzes user's existing intents to find the most relevant ones for a specific index
 * based on the index prompt and existing indexed intents.
 */

import { traceableStructuredLlm } from "../../../lib/agents";
import { z } from "zod";

// Type definitions
export interface RecommendedIntent {
  id: string;
  payload: string;
  confidence: number;
}

export interface IntentRecommendationResult {
  success: boolean;
  recommendations?: RecommendedIntent[];
  error?: string;
}

/**
 * Recommend which user intents are most relevant to an index
 */
export async function recommendIntents(
  userIntents: Array<{ id: string; payload: string; summary?: string }>,
  indexPrompt: string | null,
  existingIndexedIntents: string[],
  maxResults: number = 5
): Promise<IntentRecommendationResult> {
  try {
    if (!userIntents || userIntents.length === 0) {
      return {
        success: true,
        recommendations: []
      };
    }

    // Prepare the user intents for analysis
    const userIntentsText = userIntents
      .map((intent, idx) => `${idx + 1}. [ID:${intent.id}] ${intent.payload}`)
      .join('\n\n');

    // Prepare existing indexed intents for context
    const existingIntentsText = existingIndexedIntents.length > 0
      ? existingIndexedIntents.join('\n') // Limit to first 10 for context
      : 'No existing intents in this index yet.';

    // Define schema for recommendations
    const RecommendationSchema = z.object({
      recommendations: z.array(z.object({
        id: z.string().describe("The ID of the intent being recommended"),
        confidence: z.number().min(0.0).max(1.0).describe("Confidence score between 0.0 and 1.0")
      })).describe(`Array of recommended intents sorted by relevance`)
    });

    // Type alias for recommendation
    type Recommendation = z.infer<typeof RecommendationSchema>['recommendations'][0];

    const prompt = `You are an intent recommendation assistant that analyzes which intents are most relevant to a specific index.

INDEX CONTEXT:
${indexPrompt ? `Index Purpose: ${indexPrompt}` : 'No specific index purpose provided.'}

EXISTING INTENTS IN INDEX (samples):
${existingIntentsText}

USER'S AVAILABLE INTENTS:
${userIntentsText}

TASK:
Analyze each user intent and determine which ones would be most valuable additions to this index based on:
1. Relevance to the index purpose/theme
2. Similarity or complementarity to existing indexed intents
3. Value they would add to the index

Return the most relevant intents with confidence scores (0.0-1.0).
Include only intents with confidence > 0.3.
Return at most ${maxResults} recommendations.

For each recommendation, provide:
- The exact ID of the intent
- A confidence score (0.3-1.0)

Sort recommendations by confidence score (highest first).`;

    const recommendCall = traceableStructuredLlm(
      "intent-recommender",
      ["structured-output"],
      {
        agent_type: "intent_recommender",
        operation: "recommend_intents_for_index",
        user_intents_count: userIntents.length,
        existing_intents_count: existingIndexedIntents.length,
        has_index_prompt: !!indexPrompt,
        max_results: maxResults
      }
    );

    const response = await recommendCall(prompt, RecommendationSchema);
    
    // Filter and map the results
    const recommendations = response.recommendations
      .filter((rec: Recommendation) => rec.confidence > 0.3)
      .slice(0, maxResults)
      .map((rec: Recommendation) => {
        const userIntent = userIntents.find(i => i.id === rec.id);
        if (!userIntent) {
          console.warn(`Intent ${rec.id} not found in user intents`);
          return null;
        }
        return {
          id: userIntent.id,
          payload: userIntent.payload,
          confidence: rec.confidence
        };
      })
      .filter(Boolean) as RecommendedIntent[];

    return {
      success: true,
      recommendations
    };

  } catch (error) {
    console.error('Intent recommendation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
