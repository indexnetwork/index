/**
 * Intent Processor Agent
 * 
 * Minimal implementation that processes intent payloads using contextual integrity.
 * Reads raw files from an index and generates refined intent payloads.
 */

import { UnstructuredClient } from "unstructured-client";
import { Strategy } from "unstructured-client/sdk/models/shared";
import { llm } from "../../../lib/agents";
import * as fs from 'fs';
import * as path from 'path';

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
 * Gather contextual information from index files with parallel processing
 */
async function gatherIndexContext(indexId: string): Promise<string> {
  const baseUploadDir = path.join(__dirname, '../../../../uploads', indexId);
  
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
    
    return contextParts.join('\n\n');
  } catch (error) {
    console.warn('Error reading index files:', error);
    return '';
  }
}

/**
 * Process intent with contextual integrity
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

    // Generate refined intent payload using contextual integrity
    const prompt = `Extract only the information from the provided context that is appropriate to share within the context of this intent, respecting roles, norms, and boundaries relevant to the recipient and purpose.

INTENT: ${intentPayload}

CONTEXT:
${contextContent.substring(0, 10000)}${contextContent.length > 10000 ? '\n...[content truncated]' : ''}

INSTRUCTIONS:
- Extract only information that is appropriate to share for this specific intent
- Respect privacy boundaries and confidentiality norms
- Consider the roles and relationships involved
- Maintain contextual integrity by filtering out irrelevant or inappropriate information
- Output only the refined intent payload string
- Be minimal and focused

Output only the refined intent payload string:`;

    const response = await llm.invoke(prompt);
    const refinedPayload = response.content as string;

    return {
      success: true,
      payload: refinedPayload.trim()
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