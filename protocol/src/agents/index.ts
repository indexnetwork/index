/**
 * Agents Module Index
 * 
 * This module provides the main entry point for the agents system.
 * It exports the connector functions and provides utilities for agent management.
 */

export { 
  triggerAgentsOnIntentCreated, 
  triggerAgentsOnIntentUpdated,
  triggerSpecificAgent,
  getRegisteredAgents,
  getAgentCount
} from './connector';

// Re-export individual agent functions for direct access if needed
export { 
  onIntentCreated as semanticOnIntentCreated, 
  onIntentUpdated as semanticOnIntentUpdated,
  getAgentConfig as semanticAgentConfig
} from './semantic_relevancy/integration';

export { 
  onIntentCreated as networkOnIntentCreated, 
  onIntentUpdated as networkOnIntentUpdated,
  getAgentConfig as networkAgentConfig
} from './network_manager/integration';

export {
  analyzeFolder as intentSuggesterAnalyzeFolder,
  getIntents as intentSuggesterGetIntents,
  getTopIntentsByConfidence as intentSuggesterGetTopIntents
} from './intent_suggester';

export {
  processIntent,
  refineIntent
} from './intent_processor';

/**
 * Agent system configuration
 */
export const AGENT_CONFIG = {
  version: '1.0.0',
  supportedEvents: ['intent_created', 'intent_updated'] as const,
  parallelExecution: true,
  errorHandling: 'continue' as const, // Continue processing other agents if one fails
}; 