/**
 * Intent Summarizer Agent
 * 
 * Minimal implementation that takes input text and generates summaries to desired length.
 * Similar to file_summarizer but for generic text input.
 */

import { llm } from "../../lib/agents";

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

    const prompt = `Summarize the following text in approximately ${maxLength} characters or less.

Create a brief, clear summary focusing on the main points.

TEXT TO SUMMARIZE:
${text.substring(0, 8000)}${text.length > 8000 ? '\n...[text truncated for processing]' : ''}

REQUIREMENTS:
- Keep the summary under ${maxLength} characters
- Maintain the key meaning and context
- If the context or content can’t be summarized meaningfully, simply truncate the text.
- Use clear, concise language
- Write as flowing text

Generate a concise summary:`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Summarization timeout')), timeout);
    });

    const response = await Promise.race([
      llm.invoke(prompt),
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

/**
 * Batch summarize multiple texts
 */
export async function summarizeMultiple(
  texts: string[],
  options: SummarizeOptions = {}
): Promise<SummaryResult[]> {
  const promises = texts.map(text => summarizeText(text, options));
  return Promise.all(promises);
} 