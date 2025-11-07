#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

console.log(process.env);


import db from '../lib/db';
import { intents, intentStakes } from '../lib/schema';
import { isNull, inArray } from 'drizzle-orm';
import { initializeBrokers, triggerBrokersOnIntentCreated, getRegisteredBrokers } from '../agents/context_brokers/connector';
import { INTENT_INFERRER_AGENT_ID } from '../lib/agent-ids';

(async () => {
  try {
    console.log('🔄 Starting broker reset process...\n');

    // Initialize brokers to get list of broker agent IDs
    await initializeBrokers();
    const brokerAgentIds = getRegisteredBrokers();
    console.log(`📋 Found ${brokerAgentIds.length} registered brokers: ${brokerAgentIds.join(', ')}\n`);

    if (brokerAgentIds.length === 0) {
      console.log('⚠️  No brokers registered, nothing to reset');
      process.exit(0);
    }

    // Step 1: Delete all broker stakes (exclude INTENT_INFERRER stakes)
    console.log('🗑️  Deleting all broker stakes...');
    const deletedStakes = await db.delete(intentStakes)
      .where(inArray(intentStakes.agentId, brokerAgentIds))
      .returning({ id: intentStakes.id });

    console.log(`✅ Deleted ${deletedStakes.length} broker stakes\n`);

    // Step 2: Get all non-archived intents
    console.log('📥 Fetching all non-archived intents...');
    const allIntents = await db.select({
      id: intents.id,
      payload: intents.payload
    })
      .from(intents)
      .where(isNull(intents.archivedAt));

    console.log(`📊 Found ${allIntents.length} non-archived intents\n`);

    if (allIntents.length === 0) {
      console.log('✅ No intents to process, reset complete');
      process.exit(0);
    }

    // Step 3: Trigger all brokers for each intent
    console.log('🚀 Re-triggering all brokers for all intents...\n');
    let processed = 0;
    let errors = 0;

    for (const intent of allIntents) {
      try {
        console.log(`[${processed + 1}/${allIntents.length}] Processing intent ${intent.id}...`);
        triggerBrokersOnIntentCreated(intent.id);
        processed++;
      } catch (error) {
        console.error(`❌ Error processing intent ${intent.id}:`, error);
        errors++;
      }
    }

    console.log('\n📊 Reset Summary:');
    console.log(`   Deleted stakes: ${deletedStakes.length}`);
    console.log(`   Intents processed: ${processed}`);
    console.log(`   Errors: ${errors}`);
    console.log('\n✅ Broker reset complete!');

    // process.exit(errors > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Fatal error during broker reset:', error);
    process.exit(1);
  }
})();

