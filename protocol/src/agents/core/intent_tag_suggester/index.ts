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

    // Create the prompt for tag suggestion
    const intentList = intents.map(intent => 
      `- ID: ${intent.id}\n  Content: ${intent.payload}`
    ).join('\n');

    const systemPrompt = `You are an intelligent tag suggester that analyzes user intents to identify themes and suggest relevant tags.

USER'S INTENTS:
${intentList}

USER'S CURRENT PROMPT:
"${prompt || '(No prompt provided - suggest most prominent themes)'}"

YOUR TASK:
1. Analyze all intents to identify common themes, topics, and patterns
2. ${prompt ? 'Consider the user\'s prompt to understand their current focus' : 'Focus on the most prominent themes across all intents'}
3. Generate tag suggestions that represent meaningful clusters of intents
4. Each tag should cover multiple related intents when possible
5. ${prompt ? 'Order tags by relevance to the prompt (most relevant first)' : 'Order tags by prominence (most common themes first)'}
6. Return up to ${maxSuggestions} suggestions

GUIDELINES:
- Tag values should be 1-3 words, clear and specific, and LOWERCASE
- Scores between 0 and 1 (only include scores >= ${minRelevanceScore})
- Values will be added to the prompt as comma-separated text
- Focus on actionable, meaningful clusters that expand the user's expression
- If the prompt is empty, suggest the most prominent themes from their intents
- Avoid overly generic tags like "technology" or "work"`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Tag suggestion timeout')), timeout);
    });

    const suggestCall = traceableStructuredLlm(
      "intent-tag-suggester",
      ["tag-generation", "clustering", "structured-output"],
      {
        agent_type: "intent_tag_suggester",
        operation: "tag_suggestion",
        intent_count: intents.length,
        prompt_length: prompt.length,
        max_suggestions: maxSuggestions
      }
    );

    const response = await Promise.race([
      suggestCall(systemPrompt, TagSuggestionSchema),
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
