/**
 * Agent Connector System
 * 
 * This module provides a centralized way to trigger agents when intents are created or updated.
 * It automatically discovers and registers agents, then triggers them based on intent events.
 */

import { onIntentCreated as semanticOnIntentCreated, onIntentUpdated as semanticOnIntentUpdated } from './semantic_relevancy/integration';
import { onIntentCreated as networkOnIntentCreated, onIntentUpdated as networkOnIntentUpdated } from './network_manager/integration';

// Agent interface for type safety
interface Agent {
  name: string;
  onIntentCreated: (intentId: string) => Promise<void>;
  onIntentUpdated: (intentId: string, previousStatus?: string) => Promise<void>;
}

// Registry of all available agents
const AGENTS: Agent[] = [
  {
    name: 'semantic_relevancy',
    onIntentCreated: semanticOnIntentCreated,
    onIntentUpdated: semanticOnIntentUpdated,
  },
  {
    name: 'network_manager',
    onIntentCreated: networkOnIntentCreated,
    onIntentUpdated: networkOnIntentUpdated,
  }
];

/**
 * Trigger all registered agents when a new intent is created
 * 
 * @param intentId - The ID of the newly created intent
 * @returns Promise that resolves when all agents have finished processing
 */
export async function triggerAgentsOnIntentCreated(intentId: string): Promise<void> {
  console.log(`🎯 Triggering ${AGENTS.length} agents for new intent: ${intentId}`);
  
  // Trigger all agents in parallel for better performance
  const agentPromises = AGENTS.map(async (agent) => {
    try {
      console.log(`🚀 Starting agent: ${agent.name} for intent: ${intentId}`);
      await agent.onIntentCreated(intentId);
      console.log(`✅ Agent ${agent.name} completed for intent: ${intentId}`);
    } catch (error) {
      console.error(`❌ Agent ${agent.name} failed for intent ${intentId}:`, error);
      // Don't re-throw - we want other agents to continue even if one fails
    }
  });

  // Wait for all agents to complete
  await Promise.allSettled(agentPromises);
  
  console.log(`🏁 All agents finished processing intent: ${intentId}`);
}

/**
 * Trigger all registered agents when an intent is updated
 * 
 * @param intentId - The ID of the updated intent
 * @param previousStatus - The previous status of the intent (optional)
 * @returns Promise that resolves when all agents have finished processing
 */
export async function triggerAgentsOnIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
  console.log(`🎯 Triggering ${AGENTS.length} agents for updated intent: ${intentId}`);
  
  // Trigger all agents in parallel for better performance
  const agentPromises = AGENTS.map(async (agent) => {
    try {
      console.log(`🔄 Starting agent: ${agent.name} for updated intent: ${intentId}`);
      await agent.onIntentUpdated(intentId, previousStatus);
      console.log(`✅ Agent ${agent.name} completed for updated intent: ${intentId}`);
    } catch (error) {
      console.error(`❌ Agent ${agent.name} failed for updated intent ${intentId}:`, error);
      // Don't re-throw - we want other agents to continue even if one fails
    }
  });

  // Wait for all agents to complete
  await Promise.allSettled(agentPromises);
  
  console.log(`🏁 All agents finished processing updated intent: ${intentId}`);
}

/**
 * Get a list of all registered agents
 * 
 * @returns Array of agent names
 */
export function getRegisteredAgents(): string[] {
  return AGENTS.map(agent => agent.name);
}

/**
 * Get agent count for monitoring/debugging
 * 
 * @returns Number of registered agents
 */
export function getAgentCount(): number {
  return AGENTS.length;
}

/**
 * Trigger a specific agent by name
 * 
 * @param agentName - Name of the agent to trigger
 * @param event - Type of event ('created' or 'updated')
 * @param intentId - The intent ID
 * @param previousStatus - Previous status for updates (optional)
 */
export async function triggerSpecificAgent(
  agentName: string, 
  event: 'created' | 'updated', 
  intentId: string, 
  previousStatus?: string
): Promise<void> {
  const agent = AGENTS.find(a => a.name === agentName);
  
  if (!agent) {
    console.warn(`Agent ${agentName} not found in registry`);
    return;
  }

  try {
    if (event === 'created') {
      await agent.onIntentCreated(intentId);
    } else {
      await agent.onIntentUpdated(intentId, previousStatus);
    }
    console.log(`✅ Agent ${agentName} completed for ${event} intent: ${intentId}`);
  } catch (error) {
    console.error(`❌ Agent ${agentName} failed for ${event} intent ${intentId}:`, error);
    throw error; // Re-throw for specific agent calls
  }
} 