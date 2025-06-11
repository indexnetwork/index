/**
 * Intent Suggester Agent
 * 
 * Minimal implementation that reads .summary files from a folder and generates intents.
 */

import { llm } from "../../../lib/agents";
import * as fs from 'fs';
import path from 'path';
import { z } from "zod";

// Type definitions
export interface InferredIntent {
  payload: string;
  confidence: number;
}

export interface IntentInferenceResult {
  success: boolean;
  intents: InferredIntent[];
}

/**
 * Analyze a folder containing .summary files and generate intents
 */
export async function analyzeFolder(
  folderPath: string,  
  options: { timeoutMs?: number } = {}
): Promise<IntentInferenceResult> {
  try {
    // Validate folder path
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, intents: [] };
    }

    const folderStat = fs.statSync(folderPath);
    if (!folderStat.isDirectory()) {
      return { success: false, intents: [] };
    }

    // Find all .summary files
    const summaryFiles = fs.readdirSync(folderPath)
      .filter(file => file.endsWith('.summary'))
      .sort();

    if (summaryFiles.length === 0) {
      return { success: true, intents: [] };
    }

    console.log(`📄 Found ${summaryFiles.length} summary files`);

    // Read and concatenate all summary files
    let concatenatedContent = '';
    for (const file of summaryFiles) {
      try {
        const filePath = path.join(folderPath, file);
        const content = fs.readFileSync(filePath, 'utf8').trim();
        
        if (content.length > 0) {
          concatenatedContent += `=== ${file} ===\n${content}\n\n`;
        }
      } catch (error) {
        console.warn(`⚠️  Failed to read ${file}:`, error);
      }
    }

    if (!concatenatedContent.trim()) {
      return { success: true, intents: [] };
    }

    console.log(`📋 Concatenated ${concatenatedContent.length} characters from ${summaryFiles.length} files`);

    // Generate intents using Zod schema
    const IntentSchema = z.object({
      intents: z.array(z.object({
        payload: z.string().describe("Specific intent describing what information the user is looking for"),
        confidence: z.number().min(0.6).max(1.0).describe("Confidence score between 0.6 and 1.0")
      })).min(5).max(5).describe("Array of 5 high-quality intent objects")
    });

    const prompt = `You are analyzing a collection of ${summaryFiles.length} summary files. Generate 8-12 high-quality search intents that represent what different personas might this content creator might want to reach.

CONTENT:
${concatenatedContent.substring(0, 15000)}${concatenatedContent.length > 15000 ? '\n...[content truncated for processing]' : ''}

REQUIREMENTS:
- Analyze the content to identify the primary target audience and their needs
- Generate intents that reflect different stakeholder perspectives
- Consider the context and purpose of the content to determine relevant personas

Generate intents that represent:
- Primary stakeholders that the content creator might be looking to connect
- Different roles and responsibilities that would interact with this information

Examples:
- Looking for investors aligned with privacy-preserving AI
- Exploring founding roles in decentralized agent ecosystems
- Raising pre-seed for an intent-based coordination protocol
- Searching for launch partners in confidential compute
- Evaluating integrations with graph-native data platforms

Focus on identifying who would use this content and why they would be interested in it.`;

    // Set up timeout
    const timeoutMs = options.timeoutMs || 60000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Intent generation timeout')), timeoutMs);
    });

    const modelWithStructure = llm.withStructuredOutput(IntentSchema);
    const response = await Promise.race([
      modelWithStructure.invoke(prompt),
      timeoutPromise
    ]);

    console.log(`✅ Generated ${response.intents.length} intents`);

    return {
      success: true,
      intents: response.intents
    };

  } catch (error) {
    console.error('❌ Error analyzing folder:', error);
    return { success: false, intents: [] };
  }
}

// Utility functions
export async function getIntents(folderPath: string): Promise<InferredIntent[]> {
  const result = await analyzeFolder(folderPath);
  return result.intents;
}

export function getTopIntentsByConfidence(
  intents: InferredIntent[], 
  limit: number = 5
): InferredIntent[] {
  return intents
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
} 