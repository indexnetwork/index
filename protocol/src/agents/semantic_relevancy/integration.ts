import { PrismaClient } from '@prisma/client';
import { processIntent } from './workflow';

const prisma = new PrismaClient();

// Type definitions matching the database schema
interface Intent {
  id: string;
  title: string;
  payload: string;
  status: string;
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
 * Trigger the Semantic Relevancy Agent when a new intent is created
 * This function should be called from the intents route after successful intent creation
 */
export async function onIntentCreated(intentId: string): Promise<void> {
  try {
    console.log(`🚀 Semantic Relevancy Agent triggered for new intent: ${intentId}`);
    
    // Fetch the new intent with related data
    const newIntent = await prisma.intent.findUnique({
      where: { id: intentId },
      select: {
        id: true,
        title: true,
        payload: true,
        status: true,
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        indexes: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!newIntent) {
      console.warn(`Intent ${intentId} not found for semantic agent processing`);
      return;
    }

    // Fetch existing active intents for semantic comparison (excluding the new one)
    const existingIntents = await prisma.intent.findMany({
      where: {
        id: { not: intentId },
        status: { in: ['active', 'published', 'pending'] } // Adjust statuses as needed
      },
      select: {
        id: true,
        title: true,
        payload: true,
        status: true,
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        indexes: {
          select: {
            id: true,
            name: true
          }
        }
      },
      take: 100, // Larger set for semantic analysis
      orderBy: { updatedAt: 'desc' }
    });

    // Process the intent through the Semantic Relevancy Agent
    const result = await processIntent(newIntent as Intent, existingIntents as Intent[]);
    
    console.log(`✅ Semantic Relevancy Agent analysis complete for intent ${intentId}`);
    console.log(`📊 Result: ${result.substring(0, 200)}...`);
    
    // TODO: Store the semantic analysis result and any stake decisions in the database
    // This could be stored in a new table like SemanticAnalysis or IntentRelevancyScore
    
  } catch (error) {
    console.error(`❌ Semantic Relevancy Agent failed for intent ${intentId}:`, error);
    // Don't throw - we don't want to break the intent creation flow
  }
}

/**
 * Trigger the Semantic Relevancy Agent when an intent is updated
 * This function should be called from the intents route after successful intent update
 */
export async function onIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
  try {
    console.log(`🔄 Semantic Relevancy Agent triggered for updated intent: ${intentId}`);
    
    // Fetch the updated intent
    const updatedIntent = await prisma.intent.findUnique({
      where: { id: intentId },
      select: {
        id: true,
        title: true,
        payload: true,
        status: true,
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        indexes: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!updatedIntent) {
      console.warn(`Updated intent ${intentId} not found for semantic agent processing`);
      return;
    }

    // Only re-analyze if the intent became active or if significant changes occurred
    const shouldAnalyze = 
      updatedIntent.status === 'active' || 
      updatedIntent.status === 'published' ||
      (previousStatus === 'draft' && updatedIntent.status !== 'draft');

    if (!shouldAnalyze) {
      console.log(`⏭️  Skipping semantic analysis for intent ${intentId} - status: ${updatedIntent.status}`);
      return;
    }

    // Fetch other active intents for semantic comparison
    const otherIntents = await prisma.intent.findMany({
      where: {
        id: { not: intentId },
        status: { in: ['active', 'published', 'pending'] }
      },
      select: {
        id: true,
        title: true,
        payload: true,
        status: true,
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        indexes: {
          select: {
            id: true,
            name: true
          }
        }
      },
      take: 100,
      orderBy: { updatedAt: 'desc' }
    });

    // Process the updated intent through semantic analysis
    const result = await processIntent(updatedIntent as Intent, otherIntents as Intent[]);
    
    console.log(`✅ Semantic Relevancy Agent re-analysis complete for updated intent ${intentId}`);
    console.log(`📊 Result: ${result.substring(0, 200)}...`);

  } catch (error) {
    console.error(`❌ Semantic Relevancy Agent failed for updated intent ${intentId}:`, error);
  }
}

/**
 * Get the agent configuration for external use
 */
export function getAgentConfig() {
  return {
    name: "semantic_relevancy",
    displayName: "Semantic Relevancy Staker",
    triggers: ["intent_created", "intent_updated"],
    thresholds: {
      relevancy: 0.75,
      confidence: 0.8,
      maxDailyStakes: 100
    }
  };
} 