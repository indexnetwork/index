import db from '../../../lib/db';
import { intents, users } from '../../../lib/schema';
import { eq, ne } from 'drizzle-orm';

// Type definitions matching the database schema
interface Intent {
  id: string;
  payload: string;
  userId: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  indexes?: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Trigger the Network Manager Agent when a new intent is created
 * This function should be called from the intents route after successful intent creation
 */
export async function onIntentCreated(intentId: string): Promise<void> {
  try {
    console.log(`🌐 Network Manager Agent triggered for new intent: ${intentId}`);
    
    // Fetch the new intent with user data
    const newIntentResult = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        user: {
          id: users.id,
        }
      })
      .from(intents)
      .leftJoin(users, eq(intents.userId, users.id))
      .where(eq(intents.id, intentId))
      .limit(1);

    if (newIntentResult.length === 0) {
      console.warn(`Intent ${intentId} not found for network management processing`);
      return;
    }

    const newIntent = newIntentResult[0];

    // Fetch existing intents for network matching (excluding the new one)
    const existingIntentResults = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        user: {
          id: users.id,
        }
      })
      .from(intents)
      .leftJoin(users, eq(intents.userId, users.id))
      .where(ne(intents.id, intentId))
      .limit(100);

    const existingIntents = existingIntentResults.map(result => ({
      id: result.id,
      payload: result.payload,
      userId: result.userId,
      user: result.user ? {
        id: result.user.id,
        name: '',
        email: ''
      } : undefined,
      indexes: []
    }));

    // Process the intent through the Network Manager Agent
    const intentForProcessing = {
      id: newIntent.id,
      payload: newIntent.payload,
      userId: newIntent.userId,
      user: newIntent.user ? {
        id: newIntent.user.id,
        name: '',
        email: ''
      } : undefined,
      indexes: []
    };

    
    
    // TODO: Store the network analysis result and any stake decisions in the database

  } catch (error) {
    console.error(`❌ Network Manager Agent failed for intent ${intentId}:`, error);
    // Don't throw - we don't want to break the intent creation flow
  }
}

/**
 * Trigger the Network Manager Agent when an intent is updated
 * This function should be called from the intents route after successful intent update
 */
export async function onIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
  try {
    console.log(`🔄 Network Manager Agent triggered for updated intent: ${intentId}`);
    
    // Fetch the updated intent
    const updatedIntentResult = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        user: {
          id: users.id,
        }
      })
      .from(intents)
      .leftJoin(users, eq(intents.userId, users.id))
      .where(eq(intents.id, intentId))
      .limit(1);

    if (updatedIntentResult.length === 0) {
      console.warn(`Updated intent ${intentId} not found for network management processing`);
      return;
    }

    const updatedIntent = updatedIntentResult[0];

    // Note: Since we don't have status field in current schema, we'll analyze all intents
    console.log(`⏭️  Analyzing intent ${intentId} (status checking disabled due to schema changes)`);

    // Fetch other intents for network matching
    const otherIntentResults = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        user: {
          id: users.id,
        }
      })
      .from(intents)
      .leftJoin(users, eq(intents.userId, users.id))
      .where(ne(intents.id, intentId))
      .limit(100);

    const otherIntents = otherIntentResults.map(result => ({
      id: result.id,
      payload: result.payload,
      userId: result.userId,
      user: result.user ? {
        id: result.user.id,
        name: '',
        email: ''
      } : undefined,
      indexes: []
    }));

    // Process the updated intent through network analysis
    const intentForProcessing = {
      id: updatedIntent.id,
      payload: updatedIntent.payload,
      userId: updatedIntent.userId,
      user: updatedIntent.user ? {
        id: updatedIntent.user.id,
        name: '',
        email: ''
      } : undefined,
      indexes: []
    };


    

  } catch (error) {
    console.error(`❌ Network Manager Agent failed for updated intent ${intentId}:`, error);
  }
}

/**
 * Get the agent configuration for external use
 */
export function getAgentConfig() {
  return {
    name: "network_manager",
    displayName: "Network Connection Manager",
    triggers: ["intent_created", "intent_updated"],
    thresholds: {
      networkStrength: 0.75,
      confidence: 0.8,
      maxDailyConnections: 150
    }
  };
} 