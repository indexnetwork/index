/**
 * Example Usage of the Agent Connector System
 * 
 * This file shows practical examples of how the agent connector
 * integrates with the intent management system.
 */

import { triggerAgentsOnIntentCreated, triggerAgentsOnIntentUpdated, getRegisteredAgents } from './';

/**
 * Example: Simulating intent creation workflow
 */
export async function simulateIntentCreation() {
  console.log('📝 Simulating Intent Creation Workflow');
  
  // Simulate creating an intent (this would normally be done in routes/intents.ts)
  const newIntentId = 'example-intent-' + Date.now();
  
  console.log(`✨ New intent created: ${newIntentId}`);
  console.log(`🎯 Triggering agents: ${getRegisteredAgents().join(', ')}`);
  
  // This is what happens automatically in the routes
  await triggerAgentsOnIntentCreated(newIntentId);
  
  console.log('✅ Intent creation workflow completed');
  return newIntentId;
}

/**
 * Example: Simulating intent update workflow
 */
export async function simulateIntentUpdate(intentId: string) {
  console.log('📝 Simulating Intent Update Workflow');
  
  const previousStatus = 'draft';
  const newStatus = 'active';
  
  console.log(`🔄 Updating intent ${intentId}: ${previousStatus} → ${newStatus}`);
  console.log(`🎯 Triggering agents: ${getRegisteredAgents().join(', ')}`);
  
  // This is what happens automatically in the routes
  await triggerAgentsOnIntentUpdated(intentId, previousStatus);
  
  console.log('✅ Intent update workflow completed');
}

/**
 * Example: Full intent lifecycle
 */
export async function demonstrateFullLifecycle() {
  console.log('🚀 Demonstrating Full Intent Lifecycle with Agents\n');
  
  try {
    // Step 1: Create intent
    const intentId = await simulateIntentCreation();
    console.log('');
    
    // Wait a bit to simulate real workflow
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 2: Update intent  
    await simulateIntentUpdate(intentId);
    console.log('');
    
    console.log('🎉 Full lifecycle demonstration completed successfully!');
    
  } catch (error) {
    console.error('❌ Lifecycle demonstration failed:', error);
  }
}

/**
 * Example: Show agent information
 */
export function showAgentInfo() {
  console.log('📊 Agent System Information');
  console.log('==========================');
  
  const agents = getRegisteredAgents();
  
  console.log(`Total Registered Agents: ${agents.length}`);
  console.log('Agents:');
  
  agents.forEach((agent, index) => {
    console.log(`  ${index + 1}. ${agent}`);
  });
  
  console.log('\nSupported Events:');
  console.log('  - intent_created');
  console.log('  - intent_updated');
  
  console.log('\nExecution Model:');
  console.log('  - Parallel execution for performance');
  console.log('  - Background processing (non-blocking)');
  console.log('  - Resilient error handling');
}

// Run examples if this file is executed directly
if (require.main === module) {
  console.log('🧪 Agent Connector System Examples\n');
  
  // Show system info
  showAgentInfo();
  console.log('\n');
  
  // Run full demonstration
  demonstrateFullLifecycle()
    .then(() => {
      console.log('\n✨ All examples completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Example failed:', error);
      process.exit(1);
    });
} 