/**
 * Intent Suggester Agent
 * 
 * Minimal implementation that reads files directly and generates intents.
 */

import { UnstructuredClient } from "unstructured-client";
import { Strategy } from "unstructured-client/sdk/models/shared";
import { traceableStructuredLlm } from "../../../lib/agents";
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

// Initialize the unstructured client with optimized settings
const unstructuredClient = new UnstructuredClient({
  serverURL: process.env.UNSTRUCTURED_API_URL
});

/**
 * Check if file type is supported
 */
export function isFileSupported(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  
  // Only skip clearly unsupported types (videos, audio, binaries)
  const skipExtensions = [
    '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv',
    '.mp3', '.wav', '.aac', '.ogg', '.flac', '.m4a',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.exe', '.bin', '.dmg'
  ];
  
  return !skipExtensions.includes(ext);
}

/**
 * Load file content using native UnstructuredClient with optimized settings
 */
async function loadFileContent(filePath: string): Promise<{ content: string | null; error: string | null }> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { content: null, error: `File not found: ${filePath}` };
  }

  // Try UnstructuredClient first with fast processing settings
  try {
    if (process.env.UNSTRUCTURED_API_URL) {
      const data = fs.readFileSync(filePath);
      
      const response = await unstructuredClient.general.partition({
        partitionParameters: {
          files: {
            content: data,
            fileName: path.basename(filePath),
          },
          strategy: Strategy.Fast, // Use fast strategy for speed
          splitPdfPage: true, // Enable PDF page splitting for parallel processing
          splitPdfConcurrencyLevel: 15, // Maximum concurrency for PDF processing
          splitPdfAllowFailed: true, // Continue even if some pages fail
          languages: ['eng'], // Optimize for English
        },
      });
      
      // Handle response - it can be either string (for CSV) or array of elements (for JSON)
      if (Array.isArray(response) && response.length > 0) {
        const content = response.map((element: any) => element.text || '').filter((text: string) => text.trim()).join('\n\n');
        return { content, error: null };
      } else if (typeof response === 'string' && response.trim()) {
        return { content: response, error: null };
      }
    }
  } catch (error) {
    console.warn(`UnstructuredClient failed for ${path.basename(filePath)}, trying fallback:`, error instanceof Error ? error.message : 'Unknown error');
  }

  // Fallback: try to read as text file
  try {
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml'];
    
    if (textExtensions.includes(ext) || ext === '') {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.trim()) {
        return { content, error: null };
      }
    }
    
    return {
      content: null,
      error: `Cannot process ${ext} files without Unstructured API. Please set UNSTRUCTURED_API_URL for document support.`
    };
  } catch (error) {
    return { 
      content: null,
      error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Process multiple files in parallel for maximum speed
 */
async function loadFilesInParallel(filePaths: string[]): Promise<Array<{ filePath: string; content: string | null; error: string | null }>> {
  const promises = filePaths.map(async (filePath) => {
    const result = await loadFileContent(filePath);
    return { filePath, ...result };
  });
  
  return Promise.all(promises);
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

    // Build context about existing intents to avoid duplicates
    const existingContext = [];
    if (existingIntents.length > 0) {
      existingContext.push(`EXISTING USER INTENTS (do not duplicate these):\n${existingIntents.map(intent => `- ${intent}`).join('\n')}`);
    }

    // Use text instruction as guidance if provided
    const instructionText = textInstruction ? `\n\nUSER INSTRUCTION: ${textInstruction}\nUse this instruction to guide how you analyze the content and what types of intents to generate.\n` : '';

    const prompt = `You are analyzing content from ${itemCount} items and generating ${count} new intents.${instructionText}

${existingContext.length > 0 ? existingContext.join('\n\n') + '\n\n' : ''}REQUIREMENTS:
- Generate ${count} completely NEW intents that are different from any existing intents or suggestions listed above
- Analyze the content to identify the primary target audience and their needs
- Prioritize generating many intents for the most likely target audience, but also add few for secondary target audiences
- Start with most important intents
- Strip out any personal information, names, etc.
- Make each intent specific and actionable

For example:
If I uploaded a pitch deck, I would most likely want to generate intents for VCs, angel investors, and other investors. so 3 investor intent, 1 partnership, 1 early customer.
If I uploaded a research paper, I would want to generate intents to find other researchers, and other people looking for research.
If I uploaded a job posting, I would want to find candidates, and other people looking for jobs.

Examples intents:
- "Looking for early-stage investors interested in AI and machine learning startups with strong technical backgrounds and experience in scaling deep tech companies"
- "Seeking venture capital firms focused on technology and innovation investments, particularly those with a track record of backing Series A and B rounds in emerging markets"
- "Connecting with angel investors who support emerging tech companies and have expertise in product-market fit validation and go-to-market strategy development"
- "Targeting partnerships with developers and technical teams for platform integration, specifically those working on enterprise SaaS solutions and API-first architectures"
- "Reaching out to community managers and network leaders for collaboration opportunities, particularly those building developer communities and technical talent networks in emerging tech hubs"

CONTENT:
${content.substring(0, 15000)}${content.length > 15000 ? '\n...[content truncated for processing]' : ''}

`;

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Intent generation timeout')), timeoutMs);
    });

    const intentInferCall = traceableStructuredLlm(
      "intent-inferrer",
      ["structured-output"],
      {
        items_processed: itemCount,
        existing_intents_count: existingIntents.length,
        requested_count: count
      }
    );
    const response = await Promise.race([
      intentInferCall(prompt, IntentSchema),
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
      return fileIdMatch && isFileSupported(filePath);
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
