/**
 * Intent Freshness Auditor Agent
 * 
 * Analyzes intents for expiration based on temporal markers and semantic analysis.
 * Archives intents that are no longer valid (expired job postings, past events, etc.)
 */

import db from '../../../lib/db';
import { intents } from '../../../lib/schema';
import { isNull, eq } from 'drizzle-orm';
import { traceableStructuredLlm } from '../../../lib/agents';
import { z } from 'zod';
import { Events } from '../../../lib/events';

// OpenRouter preset: intent-freshness-auditor
// Configured to analyze temporal context and expiration signals

const CONFIDENCE_THRESHOLD = 70;

export interface FreshnessResult {
  isExpired: boolean;
  reasoning: string;
  confidenceScore: number;
}

const SYSTEM_PROMPT = `You are an intent freshness analyzer. Determine if an intent has EXPIRED based on temporal markers and context.

An intent is EXPIRED if it contains:
1. Past dates or time periods (e.g., "Q1 2024" when current date is later)
2. Time-sensitive opportunities that have clearly passed (e.g., "attending conference next week" from 6 months ago)
3. Job postings with stale timelines (e.g., "hiring for Summer 2023 internship" when we're in 2025)
4. Event-specific intents tied to past dates (e.g., "speaking at DevConf March 15" when that date has passed)
5. Seasonal or time-bound offers that are clearly outdated

An intent is NOT EXPIRED if:
- No temporal markers exist (timeless statements like "interested in AI research")
- Temporal context is ongoing or future-looking (e.g., "building a startup")
- References are relative without specific dates (e.g., "looking for co-founder")
- The intent is evergreen (e.g., "open to consulting", "seeking partnerships")

Current date for reference: ${new Date().toISOString().split('T')[0]}

Confidence scoring:
- 90-100: Clear expired temporal markers (specific past dates, expired deadlines)
- 75-89: Strong signals of expiration (stale job posting, old event reference)
- 70-74: Probable expiration (context suggests it's outdated)
- Below 70: Not confident enough to archive

Be conservative. Only mark as expired if there's clear temporal evidence.`;

/**
 * Analyze a single intent for freshness
 */
export async function auditIntentFreshness(intentId: string): Promise<FreshnessResult> {
  try {
    // Fetch intent
    const intentRows = await db.select({
      id: intents.id,
      payload: intents.payload,
      createdAt: intents.createdAt
    })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);

    if (intentRows.length === 0) {
      throw new Error(`Intent ${intentId} not found`);
    }

    const intent = intentRows[0];

    const FreshnessSchema = z.object({
      isExpired: z.boolean().describe("Whether the intent has expired"),
      reasoning: z.string().describe("Brief explanation of why the intent is or isn't expired"),
      confidenceScore: z.number().min(0).max(100).describe("Confidence score 0-100")
    });

    const userMessage = {
      role: "user",
      content: `Analyze this intent for expiration:

Intent: "${intent.payload}"
Created: ${intent.createdAt.toISOString().split('T')[0]}

Is this intent expired? Provide confidence score and reasoning.`
    };

    const freshnessCall = traceableStructuredLlm(
      "intent-freshness-auditor",
      {
        agent_type: "intent_freshness_auditor",
        operation: "freshness_check",
        intent_id: intentId
      }
    );

    const response = await freshnessCall(
      [{ role: "system", content: SYSTEM_PROMPT }, userMessage],
      FreshnessSchema
    );

    return {
      isExpired: response.isExpired,
      reasoning: response.reasoning,
      confidenceScore: response.confidenceScore
    };
  } catch (error) {
    console.error(`Error auditing intent ${intentId}:`, error);
    throw error;
  }
}

/**
 * Archive an intent by setting archivedAt timestamp
 */
async function archiveIntent(intentId: string, userId: string): Promise<void> {
  await db.update(intents)
    .set({ 
      archivedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(intents.id, intentId));

  // Trigger centralized intent archived event
  Events.Intent.onArchived({
    intentId,
    userId
  });
}

/**
 * Audit all non-archived intents and archive expired ones
 */
export async function auditAllIntents(): Promise<{
  audited: number;
  archived: number;
  errors: number;
}> {
  console.log('🔍 Starting intent freshness audit...');

  const allIntents = await db.select({
    id: intents.id,
    userId: intents.userId,
    payload: intents.payload
  })
    .from(intents)
    .where(isNull(intents.archivedAt));

  console.log(`📊 Found ${allIntents.length} non-archived intents to audit`);

  let audited = 0;
  let archived = 0;
  let errors = 0;

  for (const intent of allIntents) {
    try {
      const result = await auditIntentFreshness(intent.id);
      audited++;

      if (result.isExpired && result.confidenceScore >= CONFIDENCE_THRESHOLD) {
        console.log(`🗑️  Archiving expired intent ${intent.id}: ${result.reasoning} (confidence: ${result.confidenceScore})`);
        await archiveIntent(intent.id, intent.userId);
        archived++;
      } else if (result.isExpired) {
        console.log(`⏭️  Skipping intent ${intent.id}: Below confidence threshold (${result.confidenceScore} < ${CONFIDENCE_THRESHOLD})`);
      }
    } catch (error) {
      console.error(`❌ Error processing intent ${intent.id}:`, error);
      errors++;
    }
  }

  console.log(`✅ Audit complete: ${audited} audited, ${archived} archived, ${errors} errors`);

  return { audited, archived, errors };
}

