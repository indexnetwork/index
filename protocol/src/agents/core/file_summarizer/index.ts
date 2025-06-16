/**
 * File Summarizer Agent
 * 
 * Minimal implementation that processes files using UnstructuredLoader and generates markdown summaries.
 */

import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";
import { llm } from "../../../lib/agents";
import * as fs from 'fs';
import * as path from 'path';

// Type definitions
export interface FileSummary {
  fileName: string;
  summary: string;
}

export interface SummarizationResult {
  success: boolean;
  summary?: FileSummary;
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
 * Generate markdown summary from content
 */
async function generateSummary(content: string, fileName: string): Promise<{ summary: string | null; error: string | null }> {
  try {
    const prompt = `Analyze this file and create a markdown summary:

FILE: ${fileName}
CONTENT:
${content}

Create a concise markdown summary with:
- What the file is about
- Key information or topics
- Important details

Keep it clear and useful.`;

    const response = await llm.invoke(prompt);
    const summaryContent = response.content as string;
    
    return { summary: summaryContent, error: null };
  } catch (error) {
    return { 
      summary: null,
      error: `Error generating summary: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Main function to summarize a file and save the summary
 */
export async function summarizeAndSaveFile(
  filePath: string,
  fileId: string,
  outputDirectory: string
): Promise<SummarizationResult> {
  try {
    if (!filePath || !fileId || !outputDirectory) {
      return {
        success: false,
        error: "Missing required parameters"
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`
      };
    }

    if (!fs.existsSync(outputDirectory)) {
      fs.mkdirSync(outputDirectory, { recursive: true });
    }

    // Load file content
    const { content, error: loadError } = await loadFileContent(filePath);
    if (loadError || !content) {
      return {
        success: false,
        error: loadError || 'No content to summarize'
      };
    }

    // Generate summary
    const fileName = path.basename(filePath);
    const { summary, error: summaryError } = await generateSummary(content, fileName);
    if (summaryError || !summary) {
      return {
        success: false,
        error: summaryError || 'Failed to generate summary'
      };
    }

    // Save summary
    const summaryPath = path.join(outputDirectory, `${fileId}.summary`);
    fs.writeFileSync(summaryPath, summary, 'utf8');

    const fileSummary: FileSummary = {
      fileName,
      summary
    };

    return {
      success: true,
      summary: fileSummary
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Utility functions
export async function processFile(
  filePath: string, 
  fileId: string, 
  outputDirectory: string
): Promise<SummarizationResult> {
  return summarizeAndSaveFile(filePath, fileId, outputDirectory);
}

/**
 * Quick start example:
 * 
 * ```typescript
 * import { summarizeAndSaveFile } from '@/agents/core/file_summarizer';
 * 
 * const result = await summarizeAndSaveFile(
 *   '/path/to/document.pdf',
 *   'unique-file-id',
 *   '/path/to/summaries'
 * );
 * 
 * if (result.success) {
 *   console.log('Summary saved:', result.summary);
 * }
 * ```
 */