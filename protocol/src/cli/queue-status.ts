#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { userQueueManager } from '../lib/queue/llm-queue';

async function showQueueStatus() {
  try {
    const allUsersStatus = await userQueueManager.getAllUsersStatus();
    const totalSize = allUsersStatus.reduce((sum, status) => sum + status.queueSize, 0);
    
    console.log(`📊 Queue status: ${totalSize} jobs pending across ${allUsersStatus.length} users`);
    
    if (totalSize > 0) {
      console.log('🔄 Processing individual intent indexing with zpopmax (highest priority first)');
      console.log('Action & Priorities:');
      console.log('  index_intent (priority 4): From index prompt updates');
      console.log('  index_intent (priority 6): From member setting updates');  
      console.log('  index_intent (priority 8): From intent created/updated');
      
      console.log('\nPer-user queue status:');
      allUsersStatus.forEach(status => {
        console.log(`  User ${status.userId}: ${status.queueSize} jobs`);
      });
    }
  } catch (error) {
    console.error('Error checking queue status:', error);
  }
  
  process.exit(0);
}

showQueueStatus();
