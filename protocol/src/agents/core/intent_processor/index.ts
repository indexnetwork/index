/**
 * Intent Processor Agent
 * 
 * Minimal implementation that processes intent payloads using contextual integrity.
 * Reads raw files from an index and generates refined intent payloads.
 */

import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";
import { llm } from "../../../lib/agents";
import * as fs from 'fs';
import * as path from 'path';

// Type definitions
export interface IntentProcessingResult {
  success: boolean;
  payload?: string;
  error?: string;
}

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
 * Load file content using UnstructuredLoader with fallback
 */
async function loadFileContent(filePath: string): Promise<{ content: string | null; error: string | null }> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { content: null, error: `File not found: ${filePath}` };
  }

  // Try UnstructuredLoader first
  try {
    const loaderOptions: any = {
      recursive: true,
      strategy: "fast",
      apiUrl: process.env.UNSTRUCTURED_API_URL
    };
    


    const loader = new UnstructuredLoader(filePath, loaderOptions);
    const documents = await loader.load();
    
    if (documents.length > 0) {
      const content = documents.map(doc => doc.pageContent).join('\n\n');
      return { content, error: null };
    }
  } catch (error) {
    console.warn(`UnstructuredLoader failed for ${path.basename(filePath)}, trying fallback:`, error instanceof Error ? error.message : 'Unknown error');
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
 * Gather contextual information from index files
 */
async function gatherIndexContext(indexId: string): Promise<string> {
  const baseUploadDir = path.join(__dirname, '../../../../uploads', indexId);
  
  if (!fs.existsSync(baseUploadDir)) {
    return '';
  }
  
  const contextParts: string[] = [];
  
  try {
    const files = fs.readdirSync(baseUploadDir);
    
    for (const file of files) {
      const filePath = path.join(baseUploadDir, file);
      
      if (!isFileSupported(filePath)) {
        continue;
      }
      
      const { content, error } = await loadFileContent(filePath);
      if (content && !error) {
        contextParts.push(`=== ${file} ===\n${content.substring(0, 2000)}`);
      }
    }
  } catch (error) {
    console.warn('Error reading index files:', error);
  }
  
  return contextParts.join('\n\n');
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