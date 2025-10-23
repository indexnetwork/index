/**
 * Intent Tag Suggester Agent - Intelligent Tag Generation
 * 
 * Analyzes user intents to identify themes and patterns, then suggests relevant
 * tags/clusters based on a given prompt. Helps users discover and articulate
 * what they want to share by surfacing common themes from their intent history.
 */

import { traceableStructuredLlm } from "../../../lib/agents";
import { z } from "zod";

// Type definitions
export interface Intent {
  id: string;
  payload: string;
  summary?: string;
}

export interface TagSuggestion {
  value: string;
  score: number;
}

export interface SuggestTagsResult {
  success: boolean;
  suggestions?: TagSuggestion[];
  error?: string;
}

export interface SuggestTagsOptions {
  maxSuggestions?: number;
  minRelevanceScore?: number;
  timeout?: number;
}

// Zod schema for structured output
const TagSuggestionSchema = z.object({
  suggestions: z.array(z.object({
    value: z.string().describe("Lowercase tag value to be added to prompt (1-3 words, clear and specific)"),
    score: z.number().min(0).max(1).describe("Relevance score between 0 and 1")
  })).describe("Array of tag suggestions ordered by relevance")
});

/**
 * Generate tag suggestions based on user intents and a prompt
 * Returns tags ordered by relevance to the prompt
 */
export async function suggestTags(
  intents: Intent[],
  prompt: string,
  options: SuggestTagsOptions = {}
): Promise<SuggestTagsResult> {
  try {
    if (!intents || intents.length === 0) {
      return { 
        success: true, 
        suggestions: [] 
      };
    }

    const {
      maxSuggestions = 10,
      minRelevanceScore = 0.3,
      timeout = 30000
    } = options;

    // System message: Define role and tag generation rules
    const systemMessage = {
      role: "system",
      content: `You are a tag suggestion analyst. Analyze user intents to identify themes and generate relevant tags.

Tag rules:
- 1-3 words, lowercase, specific
- Scores 0-1 (minimum ${minRelevanceScore})
- Avoid generic terms like "technology" or "work"
- Each tag should cluster multiple related intents
- Order by ${prompt ? 'relevance to user prompt' : 'prominence across intents'}
- Return up to ${maxSuggestions} tags`
    };

    // User message: Provide intents and task
    const intentList = intents.map(intent => 
      `- ${intent.payload}`
    ).join('\n');

    const userMessage = {
      role: "user",
      content: `${prompt ? `User's focus: "${prompt}"\n\n` : ''}Analyze these intents and suggest relevant tags:

${intentList}

Generate tag suggestions:`
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Tag suggestion timeout')), timeout);
    });

    const suggestCall = traceableStructuredLlm(
      "intent-tag-suggester",
      {
        agent_type: "intent_tag_suggester",
        operation: "tag_suggestion",
        intent_count: intents.length,
        prompt_length: prompt.length,
        max_suggestions: maxSuggestions
      }
    );

    const response = await Promise.race([
      suggestCall([systemMessage, userMessage], TagSuggestionSchema),
      timeoutPromise
    ]);
    
    // Filter by minimum relevance score and limit suggestions
    const filteredSuggestions = (response.suggestions || [])
      .filter((s: TagSuggestion) => s.score >= minRelevanceScore)
      .slice(0, maxSuggestions)
      .sort((a: TagSuggestion, b: TagSuggestion) => b.score - a.score);

    console.log(`✅ Generated ${filteredSuggestions.length} tag suggestions for prompt: "${prompt.substring(0, 50)}..."`);

    return {
      success: true,
      suggestions: filteredSuggestions
    };

  } catch (error) {
    console.error('❌ Error generating tag suggestions:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
