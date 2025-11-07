#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

console.log(process.env);


import { auditAllIntents } from '../agents/core/intent_freshness_auditor';

(async () => {
  try {
    console.log('🕒 Starting manual intent freshness audit...\n');
    
    const result = await auditAllIntents();
    
    console.log('\n📊 Audit Summary:');
    console.log(`   Total audited: ${result.audited}`);
    console.log(`   Archived: ${result.archived}`);
    console.log(`   Errors: ${result.errors}`);
    
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Fatal error during audit:', error);
    process.exit(1);
  }
})();

