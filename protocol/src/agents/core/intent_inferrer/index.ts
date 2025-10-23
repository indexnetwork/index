/**
 * Intent Suggester Agent
 * 
 * Minimal implementation that reads files directly and generates intents.
 */

import { UnstructuredClient } from "unstructured-client";
import { Strategy } from "unstructured-client/sdk/models/shared";
import { traceableStructuredLlm } from "../../../lib/agents";
import { isFileExtensionSupported } from "../../../lib/uploads.config";
import { loadFileContent, loadFilesInParallel } from "../../../lib/uploads";
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

// Lazy initialization for unstructured client
let unstructuredClient: UnstructuredClient | null = null;

function getUnstructuredClient(): UnstructuredClient | null {
  if (!process.env.UNSTRUCTURED_API_URL) return null;
  if (!unstructuredClient) {
    unstructuredClient = new UnstructuredClient({
      serverURL: process.env.UNSTRUCTURED_API_URL
    });
  }
  return unstructuredClient;
}




/**
 * Core intent analysis function that works with any content
 */
export async function analyzeContent(
  content: string,
  itemCount: number,
  textInstruction?: string,
  existingIntents: string[] = [],
  count: number = 5,
  timeoutMs: number = 60000
): Promise<IntentInferenceResult> {
  try {
    if (!content.trim()) {
      console.log('📄 No content to analyze');
      return { success: true, intents: [] };
    }

    console.log(`📋 Analyzing ${content.length} characters from ${itemCount} items`);

    // Generate intents using Zod schema
    const IntentSchema = z.object({
      intents: z.array(z.object({
        payload: z.string().describe("Specific intent describing what information the user is looking for"),
        confidence: z.number().min(0.6).max(1.0).describe("Confidence score between 0.6 and 1.0")
      })).min(count).max(count).describe(`Array of ${count} high-quality intent objects`)
    });

    // System message: Define role and core constraints
    const systemMessage = {
      role: "system",
      content: `You are an intent generation specialist. Your role is to analyze content and generate specific, actionable intents that describe what the user wants to find or connect with.

Core rules:
- Generate intents for the PRIMARY target audience (70%), with a few for SECONDARY audiences (30%)
- Each intent must be specific, actionable, and professional
- Remove all personal information (names, emails, phone numbers)
- Avoid generic phrases; be concrete about what/who the user seeks
- Output exactly the requested number of NEW intents`
    };

    // User message: Provide task, context, and data
    const existingContext = existingIntents.length > 0 
      ? `\n### Existing Intents (do NOT duplicate)\n${existingIntents.map(i => `- ${i}`).join('\n')}\n`
      : '';
    
    const instructionContext = textInstruction 
      ? `\n### User Guidance\n${textInstruction}\n`
      : '';

    const userMessage = {
      role: "user",
      content: `Generate ${count} new intents from ${itemCount} content items.
${instructionContext}${existingContext}
### Content Analysis Examples
Q: Pitch deck uploaded → Who does the user want to find?
A: Primarily investors (3 intents), then partners (1), early customers (1)

Q: Research paper uploaded → Who does the user want to find?
A: Other researchers in the field, institutions seeking this research

Q: Job posting uploaded → Who does the user want to find?
A: Qualified candidates, recruiters in this space

### Quality Examples
✅ "Looking for early-stage investors in AI/ML startups with experience scaling deep tech companies"
✅ "Seeking venture capital firms with track records in Series A/B rounds for emerging markets"
✅ "Connecting with developers for enterprise SaaS platform integration and API partnerships"

❌ "Looking for investors" (too generic)
❌ "Contact John Smith about opportunities" (contains personal info)

### Content to Analyze
${content.substring(0, 15000)}${content.length > 15000 ? '\n...[truncated]' : ''}

Generate ${count} new intents:`
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Intent generation timeout')), timeoutMs);
    });

    const intentInferCall = traceableStructuredLlm(
      "intent-inferrer",
      {
        items_processed: itemCount,
        existing_intents_count: existingIntents.length,
        requested_count: count
      }
    );
    const response = await Promise.race([
      intentInferCall([systemMessage, userMessage], IntentSchema),
      timeoutPromise
    ]);

    console.log(`✅ Generated ${response.intents.length} intents`);

    return {
      success: true,
      intents: response.intents
    };

  } catch (error) {
    console.error('❌ Error analyzing content:', error);
    return { success: false, intents: [] };
  }
}

/**
 * Analyze objects directly and generate intents (efficient for integrations)
 */
export async function analyzeObjects(
  objects: any[],
  textInstruction?: string,
  existingIntents: string[] = [],
  count: number = 5,
  timeoutMs: number = 60000
): Promise<IntentInferenceResult> {
  if (!objects.length) {
    return { success: true, intents: [] };
  }

  console.log(`📄 Processing ${objects.length} objects`);

  // Build concatenated content from objects
  let concatenatedContent = '';
  let processedObjects = 0;
  
  for (const obj of objects) {
    if (obj && typeof obj === 'object') {
      // Convert object to readable format
      const objContent = typeof obj.content === 'string' 
        ? obj.content 
        : JSON.stringify(obj, null, 2);
      
      if (objContent.trim().length > 0) {
        const objName = obj.name || obj.id || `object-${processedObjects + 1}`;
        concatenatedContent += `=== ${objName} ===\n${objContent.substring(0, 5000)}\n\n`;
        processedObjects++;
      }
    }
  }

  return analyzeContent(
    concatenatedContent,
    processedObjects,
    textInstruction,
    existingIntents,
    count,
    timeoutMs
  );
}

/**
 * Analyze files in a folder and generate intents
 */
export async function analyzeFolder(
  folderPath: string,
  fileIds: string[],
  textInstruction?: string,
  existingIntents: string[] = [],
  count: number = 5,
  timeoutMs: number = 60000
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

    if (fileIds.length === 0) {
      return { success: true, intents: [] };
    }

    console.log(`📄 Processing ${fileIds.length} files`);

    // Find all supported files based on fileIds
    const allFiles = fs.readdirSync(folderPath);
    const supportedFiles = allFiles.filter(file => {
      const fileIdMatch = fileIds.some(id => file.startsWith(id + '.'));
      const filePath = path.join(folderPath, file);
      return fileIdMatch && isFileExtensionSupported(filePath, 'general');
    });

    if (supportedFiles.length === 0) {
      console.log('📄 No supported files found');
      return { success: true, intents: [] };
    }

    console.log(`📄 Found ${supportedFiles.length} supported files out of ${fileIds.length} total files`);

    // Process all files in parallel for maximum speed
    const filePaths = supportedFiles.map(file => path.join(folderPath, file));
    const fileResults = await loadFilesInParallel(filePaths);

    // Build concatenated content from successful results
    let concatenatedContent = '';
    let processedFiles = 0;
    
    for (const result of fileResults) {
      if (result.content && result.content.trim().length > 0) {
        const fileName = path.basename(result.filePath);
        concatenatedContent += `=== ${fileName} ===\n${result.content.substring(0, 5000)}\n\n`;
        processedFiles++;
      } else if (result.error) {
        console.warn(`⚠️  Failed to read ${path.basename(result.filePath)}:`, result.error);
      }
    }

    if (!concatenatedContent.trim()) {
      console.log('📄 No readable content found in supported files');
      return { success: true, intents: [] };
    }

    return analyzeContent(
      concatenatedContent,
      processedFiles,
      textInstruction,
      existingIntents,
      count,
      timeoutMs
    );

  } catch (error) {
    console.error('❌ Error analyzing folder:', error);
    return { success: false, intents: [] };
  }
}
