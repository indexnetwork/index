import { PrismaClient } from '@prisma/client';
import { processVCFounderIntent } from './workflow';
import { llm } from '../../lib/agents';

const prisma = new PrismaClient();

// Type definitions matching the database schema
interface Intent {
  id: string;
  title: string;
  payload: string;
  status: string;
  userId: string;
  indexes?: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Check if an intent is VC or Founder related using LLM analysis
 */
async function isVCFounderRelated(intent: Intent): Promise<boolean> {
  const prompt = `
You are an expert analyst specializing in venture capital and startup ecosystems. 

Analyze the following intent and determine if it is related to venture capital, investment, or entrepreneurship/founding activities.

INTENT TO ANALYZE:
Title: ${intent.title}
Description: ${intent.payload}

EVALUATION CRITERIA:
- Venture Capital: investment activities, funding rounds, due diligence, portfolio management, investor relations
- Founder/Entrepreneur: startup creation, business development, product launch, team building, market validation
- Startup Ecosystem: accelerators, incubators, pitch decks, fundraising, scaling businesses

Respond with ONLY "true" if this intent is clearly related to VC, investment, entrepreneurship, or startup activities.
Respond with ONLY "false" if it is not related to these areas.

Response:`;

  try {
    const response = await llm.invoke(prompt);
    const content = response.content as string;
    const result = content.toLowerCase().trim();
    
    // Parse the response - should be "true" or "false"
    return result === "true" || result.startsWith("true");
  } catch (error) {
    console.error("LLM analysis failed for intent classification:", error);
    // Fallback to false to be conservative
    return false;
  }
}

/**
 * Trigger the ProofLayer Due Diligence Agent when a new intent is created
 * Only triggers for VC or Founder related intents
 */
export async function onIntentCreated(intentId: string): Promise<void> {
  try {
    console.log(`🔍 ProofLayer Due Diligence Agent evaluating new intent: ${intentId}`);
    
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
      console.warn(`Intent ${intentId} not found for ProofLayer processing`);
      return;
    }

    // Check if this intent is VC or Founder related
    if (!(await isVCFounderRelated(newIntent as Intent))) {
      console.log(`⏭️  Skipping ProofLayer analysis for intent ${intentId} - not VC/Founder related`);
      return;
    }

    console.log(`🚀 ProofLayer Due Diligence Agent triggered for VC/Founder intent: ${intentId}`);

    // Fetch existing VC/Founder related intents for matching (excluding the new one)
    const allIntents = await prisma.intent.findMany({
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
          }
        },
        indexes: {
          select: {
            id: true,
            name: true
          }
        }
      },
      take: 50, // Focus on recent intents for due diligence
      orderBy: { updatedAt: 'desc' }
    });

    // Filter for VC/Founder related intents only
    const vcFounderChecks = await Promise.all(
      allIntents.map(async (intent: any) => ({
        intent,
        isVCFounder: await isVCFounderRelated(intent as Intent)
      }))
    );
    const existingVCFounderIntents = vcFounderChecks
      .filter(({ isVCFounder }) => isVCFounder)
      .map(({ intent }) => intent);

    console.log(`📊 Found ${existingVCFounderIntents.length} existing VC/Founder intents for analysis`);

    if (existingVCFounderIntents.length === 0) {
      console.log(`⏭️  No existing VC/Founder intents found for matching`);
      return;
    }

    // Process the intent through the ProofLayer Due Diligence Agent
    const result = await processVCFounderIntent(newIntent as Intent, existingVCFounderIntents as Intent[]);
    
    console.log(`✅ ProofLayer Due Diligence analysis complete for intent ${intentId}`);
    console.log(`📈 Result: ${result.substring(0, 300)}...`);

  } catch (error) {
    console.error(`❌ ProofLayer Due Diligence Agent failed for intent ${intentId}:`, error);
    // Don't throw - we don't want to break the intent creation flow
  }
}

/**
 * Trigger the ProofLayer Due Diligence Agent when an intent is updated
 * Only triggers for VC or Founder related intents
 */
export async function onIntentUpdated(intentId: string, previousStatus?: string): Promise<void> {
  try {
    console.log(`🔄 ProofLayer Due Diligence Agent evaluating updated intent: ${intentId}`);
    
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
      console.warn(`Updated intent ${intentId} not found for ProofLayer processing`);
      return;
    }

    // Check if this intent is VC or Founder related
    if (!(await isVCFounderRelated(updatedIntent as Intent))) {
      console.log(`⏭️  Skipping ProofLayer analysis for updated intent ${intentId} - not VC/Founder related`);
      return;
    }

    // Only re-analyze if the intent became active or if significant changes occurred
    const shouldAnalyze = 
      updatedIntent.status === 'active' || 
      updatedIntent.status === 'published' ||
      (previousStatus === 'draft' && updatedIntent.status !== 'draft');

    if (!shouldAnalyze) {
      console.log(`⏭️  Skipping ProofLayer re-analysis for intent ${intentId} - status: ${updatedIntent.status}`);
      return;
    }

    console.log(`🚀 ProofLayer Due Diligence Agent triggered for updated VC/Founder intent: ${intentId}`);

    // Fetch other VC/Founder related intents for matching
    const allIntents = await prisma.intent.findMany({
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
          }
        },
        indexes: {
          select: {
            id: true,
            name: true
          }
        }
      },
      take: 50,
      orderBy: { updatedAt: 'desc' }
    });

    // Filter for VC/Founder related intents only
    const vcFounderChecks = await Promise.all(
      allIntents.map(async (intent: any) => ({
        intent,
        isVCFounder: await isVCFounderRelated(intent as Intent)
      }))
    );
    const otherVCFounderIntents = vcFounderChecks
      .filter(({ isVCFounder }) => isVCFounder)
      .map(({ intent }) => intent);

    console.log(`📊 Found ${otherVCFounderIntents.length} other VC/Founder intents for re-analysis`);

    // Process the updated intent through due diligence analysis
    const result = await processVCFounderIntent(updatedIntent as Intent, otherVCFounderIntents as Intent[]);
    
    console.log(`✅ ProofLayer Due Diligence re-analysis complete for updated intent ${intentId}`);
    console.log(`📈 Result: ${result.substring(0, 300)}...`);

  } catch (error) {
    console.error(`❌ ProofLayer Due Diligence Agent failed for updated intent ${intentId}:`, error);
  }
}

/**
 * Get the agent configuration for external use
 */
export function getAgentConfig() {
  return {
    name: "proof_layer",
    displayName: "ProofLayer Due Diligence",
    triggers: ["intent_created", "intent_updated"],
    filters: ["vc_founder_related"],
    thresholds: {
      embedding_similarity: 0.7,
      investment_confidence: 0.75,
      max_daily_analysis: 25
    },
    capabilities: [
      "semantic_embedding_comparison",
      "web_research_tavily",
      "due_diligence_analysis", 
      "investment_recommendation"
    ]
  };
} 