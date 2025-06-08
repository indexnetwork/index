/**
 * File Summarizer Agent
 * 
 * Simple file summarization using UnstructuredLoader to generate markdown summaries.
 */

// Export main functions
export {
  summarizeAndSaveFile,
  isFileSupported
} from './integration';

// Export workflow functions
export {
  processFile,
  createFileSummarizerWorkflow
} from './workflow';

// Export types
export type { 
  FileSummary, 
  SummarizationResult
} from './integration';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { summarizeAndSaveFile } from '@/agents/file_summarizer';
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