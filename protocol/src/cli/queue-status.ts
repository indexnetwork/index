#!/usr/bin/env node
import 'dotenv/config';
import { queue } from '../lib/queue/llm-queue';

async function showQueueStatus() {
  try {
    const size = await queue.getQueueSize();
    console.log(`📊 Queue status: ${size} jobs pending`);
    
    if (size > 0) {
      console.log('🔄 Processing individual intent indexing with zpopmax (highest priority first)');
      console.log('Action & Priorities:');
      console.log('  index_intent (priority 4): From index prompt updates');
      console.log('  index_intent (priority 6): From member setting updates');  
      console.log('  index_intent (priority 8): From intent created/updated');
    }
  } catch (error) {
    console.error('Error checking queue status:', error);
  }
  
  process.exit(0);
}

showQueueStatus();
