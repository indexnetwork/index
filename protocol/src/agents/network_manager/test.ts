#!/usr/bin/env ts-node

import { createNetworkManagerWorkflow } from './workflow';

async function test() {
  console.log('🧪 Testing Network Manager Agent...');
  
  try {
    const workflow = createNetworkManagerWorkflow();
    console.log('✅ Workflow created successfully');
    
    const app = workflow.compile();
    console.log('✅ Workflow compiled successfully');
    
    console.log('🚀 Network Manager Agent is ready!');
    
    // Test with minimal input if OPENAI_API_KEY is available
    if (process.env.OPENAI_API_KEY) {
      console.log('🔑 OpenAI API key found, testing execution...');
      const result = await app.invoke({ 
        input: "Test: alice.consensys.eth looking to connect with DeFi specialists" 
      });
      console.log('✅ Execution test passed');
      console.log('📋 Result preview:', result.output?.substring(0, 100) + '...');
    } else {
      console.log('⚠️  No OpenAI API key found, skipping execution test');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

test().catch(console.error); 