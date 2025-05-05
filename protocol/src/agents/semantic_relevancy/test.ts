#!/usr/bin/env ts-node

import { createSemanticRelevancyWorkflow } from './workflow';

async function test() {
  console.log('🧪 Testing Semantic Relevancy Agent...');
  
  try {
    const workflow = createSemanticRelevancyWorkflow();
    console.log('✅ Workflow created successfully');
    
    const app = workflow.compile();
    console.log('✅ Workflow compiled successfully');
    
    console.log('🚀 Semantic Relevancy Agent is ready!');
    
    // Test with minimal input if OPENAI_API_KEY is available
    if (process.env.OPENAI_API_KEY) {
      console.log('🔑 OpenAI API key found, testing execution...');
      const result = await app.invoke({ 
        intentData: JSON.stringify({ 
          newIntent: {
            id: "test-123",
            title: "Test ML Engineer Position",
            payload: "Looking for machine learning engineer with NLP experience",
            status: "active",
            userId: "test-user"
          },
          existingIntents: []
        })
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