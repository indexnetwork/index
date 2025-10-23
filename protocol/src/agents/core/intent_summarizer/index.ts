/**
 * Intent Summarizer Agent
 * 
 * Minimal implementation that takes input text and generates summaries to desired length.
 */

import { traceableLlm } from "../../../lib/agents";

// Type definitions
export interface SummaryResult {
  success: boolean;
  summary?: string;
  error?: string;
}

export interface SummarizeOptions {
  maxLength?: number;
  timeout?: number;
}

/**
 * Generate a summary from input text
 */
export async function summarizeText(
  text: string,
  options: SummarizeOptions = {}
): Promise<SummaryResult> {
  try {
    if (!text || !text.trim()) {
      return { success: false, error: 'No text provided to summarize' };
    }

    const {
      maxLength = 200,
      timeout = 30000
    } = options;

    if (text.length < 200){
      return {
        success: true,
        summary: text
      };
    }

    const systemMessage = {
      role: "system",
      content: `You are a text summarization specialist. Create concise summaries that preserve key meaning and context.

Rules:
- Maximum ${maxLength} characters
- Use clear, direct language
- Maintain essential information
- If content can't be meaningfully summarized, truncate intelligently`
    };

    const userMessage = {
      role: "user",
      content: `Summarize this text:

${text.substring(0, 8000)}${text.length > 8000 ? '\n...[truncated]' : ''}`
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Summarization timeout')), timeout);
    });

    const summarizeCall = traceableLlm(
      "intent-summarizer",
      {
        original_length: text.length,
        target_length: maxLength
      }
    );
    const response = await Promise.race([
      summarizeCall([systemMessage, userMessage]),
      timeoutPromise
    ]);

    const summary = (response.content as string).trim();

    // Validate summary length (allow some flexibility)
    if (summary.length > maxLength * 1.2) {
      console.warn(`Summary length (${summary.length}) exceeds target (${maxLength})`);
    }

    console.log(`✅ Generated summary: ${summary.length} characters`);

    return {
      success: true,
      summary
    };

  } catch (error) {
    console.error('❌ Error summarizing text:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Utility function for intent-specific summarization
 */
export async function summarizeIntent(
  intentPayload: string,
  maxLength: number = 150
): Promise<string | null> {
  const result = await summarizeText(intentPayload, {
    maxLength
  });

  return result.success ? result.summary || null : null;
}
