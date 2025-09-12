/**
 * Intent Enhancer Agent
 * 
 * Enhances and expands initial intents using contextual information from index files.
 * Filters appropriate content to create enriched, context-aware intent payloads.
 */

import { UnstructuredClient } from "unstructured-client";
import { Strategy } from "unstructured-client/sdk/models/shared";
import { traceableLlm } from "../../../lib/agents";
import * as fs from 'fs';
import * as path from 'path';
import db from '../../../lib/db';
import { indexes } from '../../../lib/schema';
import { eq } from 'drizzle-orm';
import { getUploadsPath } from '../../../lib/paths';
import { validate as isValidUUID } from 'uuid';

// Type definitions
export interface IntentProcessingResult {
  success: boolean;
  payload?: string;
  error?: string;
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
        const content = response.map((element: any) => element.text || '').filter((text: string) => text.trim()).join('\n');
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
 * Gather contextual information from index files with parallel processing
 */
async function gatherIndexContext(indexId: string): Promise<string> {
  // Validate UUID early to avoid unnecessary DB hits / cast errors
  if (!isValidUUID(indexId)) return '';

  let userId: string | undefined;
  try {
    const owner = await db
      .select({ userId: indexes.userId })
      .from(indexes)
      .where(eq(indexes.id, indexId))
      .limit(1);
    userId = owner[0]?.userId;
  } catch (e) {
    console.warn('DB lookup for index owner failed:', e);
    return '';
  }
  if (!userId) return '';

  const baseUploadDir = getUploadsPath('files', userId);
  
  if (!fs.existsSync(baseUploadDir)) {
    return '';
  }
  
  try {
    const files = fs.readdirSync(baseUploadDir);
    const supportedFiles = files.filter(file => {
      const filePath = path.join(baseUploadDir, file);
      return isFileSupported(filePath);
    });

    if (supportedFiles.length === 0) {
      return '';
    }

    // Process all files in parallel for maximum speed
    const filePaths = supportedFiles.map(file => path.join(baseUploadDir, file));
    const fileResults = await loadFilesInParallel(filePaths);
    
    const contextParts: string[] = [];
    for (const result of fileResults) {
      if (result.content && !result.error) {
        const fileName = path.basename(result.filePath);
        contextParts.push(`=== ${fileName} ===\n${result.content.substring(0, 2000)}`);
      }
    }
    
    return contextParts.join('');
  } catch (error) {
    console.warn('Error reading index files:', error);
    return '';
  }
}

/**
 * Enhance and expand intent using contextual information
 */
export async function processIntent(
  intentPayload: string,
  indexId: string
): Promise<IntentProcessingResult> {
  try {
    if (!intentPayload || !indexId) {
      return {
        success: false,
        error: "Missing required parameters"
      };
    }

    // Gather contextual information
    const contextContent = await gatherIndexContext(indexId);
    
    if (!contextContent) {
      return {
        success: false,
        error: "No contextual information available"
      };
    }

    // Enhance and expand the initial intent using contextual information
    const prompt = `You are an intent enhancer that takes an initial intent and expands it using relevant contextual information.

INITIAL INTENT: ${intentPayload}

AVAILABLE CONTEXT:
${contextContent.substring(0, 10000)}${contextContent.length > 10000 ? '\n...[content truncated]' : ''}

INSTRUCTIONS:
- Take the initial intent as the foundation
- Use the contextual information to enhance and expand the intent with relevant details
- Add specific examples, data points, or insights from the context that strengthen the intent
- Include relevant content, or resources mentioned in the context
- You must filter out any inappropriate, confidential, or irrelevant information
- Maintain the original intent's purpose while making it more comprehensive and compelling
- Keep the enhanced intent professional and focused
- Format the output as a clear, expanded intent statement
- Dont add title to the output.

Enhanced Intent:`;

    console.log(prompt);  
    const enhanceCall = traceableLlm(
      "intent-enhancer",
      [],
      {
        agent_type: "intent_enhancer",
        operation: "intent_enhancement",
        index_id: indexId,
        original_intent_length: intentPayload.length,
        context_length: contextContent.length
      }
    );
    const response = await enhanceCall(prompt);
    const enhancedPayload = response.content as string;

    return {
      success: true,
      payload: enhancedPayload.trim()
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Utility function
export async function refineIntent(
  intentPayload: string,
  indexId: string
): Promise<string | null> {
  const result = await processIntent(intentPayload, indexId);
  return result.success ? result.payload || null : null;
} 
