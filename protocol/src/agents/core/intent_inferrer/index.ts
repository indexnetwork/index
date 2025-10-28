/**
 * Intent Suggester Agent
 * 
 * Minimal implementation that reads files directly and generates intents.
 */

import { UnstructuredClient } from "unstructured-client";
import { traceableStructuredLlm } from "../../../lib/agents";
import { isFileExtensionSupported } from "../../../lib/uploads.config";
import { loadFilesInParallel } from "../../../lib/uploads";
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
      content: `You are an intent generation specialist. Your role is to analyze content and generate specific intents that reflect the user's actual interests, focus areas, and intellectual pursuits based on what they've uploaded.

Core rules:
- Intents must reflect the user's ACTUAL interests derived from their content, not imaginary networking personas
- Use analytical language that describes what the user is studying, exploring, or analyzing, 
- Each intent must be specific, concrete, and grounded in the source material
- Remove all personal information (names, emails, phone numbers)
- Avoid generic phrases like "seeking partnerships" or "looking for investors" unless those exact phrases appear in the source content
- Output exactly the requested number of NEW intents

Content Analysis Examples:
Q: Pitch deck uploaded → What is the user interested in?
A: Primarily the business model and market opportunity (3 intents), with some focus on competitive landscape and technical architecture (2 intents)

Q: Research paper uploaded → What is the user interested in?
A: The methodology and findings of the research, applications of the research in related fields, gaps or questions raised by the work

Q: Ben Thompson's "The Great Unbundling" article → What is the user interested in?
A: How zero-cost distribution reshapes media economics, bundle vs. unbundle pricing dynamics, attention-based integration models replacing distribution monopolies

Quality Examples:
✅ "Analyzing how zero-cost digital distribution reshapes the balance between content creation and monetization in media industries"
✅ "Investigating bundle economics across music, video, and text sectors to quantify consumer surplus and pricing elasticity changes"
✅ "Exploring the shift from distribution-based monopolies to attention-based integrations in digital media ecosystems"
✅ "Comparing pre- and post-Internet media business models to identify structural dependencies between distribution ownership and profit generation"

❌ "Looking for investors" (too generic and not grounded in actual user interest, dont use it unless the user explicitly says they are looking for investors)
❌ "Seeking partnerships with media companies" (fictional networking persona, not derived from content, dont use it unless the user explicitly says they are seeking partnerships with media companies)
❌ "Contact John Smith about opportunities" (contains personal info, dont use it unless the user explicitly says they are seeking opportunities with John Smith)`
    };

    // Build user messages logically:
    // 1. Context (user guidance + existing intents)
    // 2. Content to analyze
    // 3. Task instruction
    
    const messages: any[] = [systemMessage];
    
    // Message 1: Provide context (if any)
    const contextParts: string[] = [];
    
    if (textInstruction) {
      contextParts.push(`User Guidance:\n${textInstruction}`);
    }
    
    if (existingIntents.length > 0) {
      const intentsToShow = existingIntents.slice(0, 50);
      contextParts.push(`Existing Intents (do NOT generate duplicates):\n${intentsToShow.map(i => `- ${i}`).join('\n')}`);
    }
    
    if (contextParts.length > 0) {
      messages.push({
        role: "user",
        content: contextParts.join('\n\n')
      });
    }
    
    // Message 2: Provide the content to analyze
    messages.push({
      role: "user",
      content: `Content to analyze (${itemCount} items):\n\n${content}`
    });
    
    // Message 3: Give the specific task instruction
    messages.push({
      role: "user",
      content: `Generate exactly ${count} new intents based on the content above.`
    });

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
      intentInferCall(messages, IntentSchema),
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
