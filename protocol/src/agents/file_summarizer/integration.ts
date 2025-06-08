import { processFile, FileSummary, SummarizationResult } from './workflow';
import * as fs from 'fs';
import * as path from 'path';

// Re-export types from workflow for easier access
export type { FileSummary, SummarizationResult } from './workflow';

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

    return await processFile(filePath, fileId, outputDirectory);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
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
  
  // Let the workflow handle everything else with fallback mechanism
  return !skipExtensions.includes(ext);
} 