/**
 * Intent Inferrer Agent
 * 
 * This module provides the main entry point for the Intent Inferrer Agent,
 * which analyzes folders/codebases using local RAG to generate potential user intents.
 */

// Export main functions
export {
  analyzeFolder,
  getIntents,
  getTopIntentsByConfidence,
  validateFolderPath,
  getAgentConfig
} from './integration';

// Export workflow functions
export {
  processFolder,
  inferIntentsFromFolder,
  createIntentInferrerWorkflow
} from './workflow';

// Export types
export type { InferredIntent } from './workflow';

// Export test functions for development
export { runTests } from './test';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { analyzeFolder } from '@/agents/intent_inferrer';
 * 
 * const result = await analyzeFolder('/path/to/project');
 * console.log(result.intents);
 * ```
 */ 