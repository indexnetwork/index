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
import { format } from 'timeago.js';

// OpenRouter preset: intent-freshness-auditor
// Configured to analyze temporal context and expiration signals

const CONFIDENCE_THRESHOLD = 70;

export interface FreshnessResult {
  isExpired: boolean;
  reasoning: string;
  confidenceScore: number;
}

const SYSTEM_PROMPT = `You are an intent freshness analyzer. Determine if an intent has EXPIRED based on both explicit temporal markers AND the inherent nature of the intent type.

EXPLICIT EXPIRATION - An intent is EXPIRED if it contains:
1. Past dates or time periods (e.g., "Q1 2024" when current date is later)
2. Time-sensitive opportunities that have clearly passed (e.g., "attending conference next week" from 6 months ago)
3. Job postings with stale timelines (e.g., "hiring for Summer 2023 internship" when we're in 2025)
4. Event-specific intents tied to past dates (e.g., "speaking at DevConf March 15" when that date has passed)
5. Seasonal or time-bound offers that are clearly outdated

IMPLICIT EXPIRATION - Consider the nature and typical lifecycle of intent types:

SHORT-TERM INTENTS (typically expire after 1-3 months):
- Job searching / "looking for work" / "open to opportunities"
- Seeking specific roles or positions
- Attending upcoming events or conferences
- Buying/selling specific items or services
- Urgent help or immediate needs
- Short-term project collaborations

MEDIUM-TERM INTENTS (typically expire after 3-6 months):
- Looking for co-founders or team members
- Fundraising or seeking investment
- Beta testing or early access requests
- Specific project launches
- Learning specific skills for near-term goals
- Networking for specific opportunities

EVERGREEN INTENTS (rarely expire without explicit markers):
- General research interests or areas of expertise
- Professional background and capabilities
- Open to consulting or advisory roles (general)
- Industry interests and passions
- Building long-term projects or companies
- Core professional identity statements

EXPIRATION GUIDELINES:
- A "looking for work" intent from 4+ months ago is likely stale (either found work or gave up)
- A "seeking co-founder" intent from 6+ months ago is probably outdated
- An event attendance from 2+ weeks ago is definitely expired
- General interests and expertise are evergreen regardless of age
- Consider context: "building X" is ongoing, "looking to build X" may expire

An intent is NOT EXPIRED if:
- It's evergreen in nature (expertise, interests, ongoing projects)
- It's recent enough for its type (job search under 2 months, etc.)
- Context suggests ongoing relevance
- It's a statement of capability rather than seeking

Confidence scoring:
- 90-100: Clear expired temporal markers OR obviously stale for its intent type
- 75-89: Strong signals of expiration (time-sensitive intent that's aged out)
- 70-74: Probable expiration (intent type + age suggest staleness)
- Below 70: Not confident enough to archive

Be thoughtful about intent types but err on the side of caution.`;

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

    // Use timeago.js for human-readable relative time
    const timeAgo = format(intent.createdAt);

    const userMessage = {
      role: "user",
      content: `Analyze this intent for expiration:

Intent: "${intent.payload}"
Created: ${timeAgo}

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

  return;
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
    payload: intents.payload,
    summary: intents.summary
  })
    .from(intents)
    .where(isNull(intents.archivedAt));

  console.log(`📊 Found ${allIntents.length} non-archived intents to audit`);

  const results = await Promise.allSettled(
    allIntents.map(async (intent) => {
      const result = await auditIntentFreshness(intent.id);
      
      // Get time ago for this intent
      const intentData = await db.select({ createdAt: intents.createdAt })
        .from(intents)
        .where(eq(intents.id, intent.id))
        .limit(1);
      const timeAgo = intentData[0] ? format(intentData[0].createdAt) : 'unknown';
      
      // Always log the full analysis for debugging
      console.log('\n' + '='.repeat(80));
      console.log(`📝 Intent: "${intent.summary}`);
      console.log(`⏰ Created: ${timeAgo}`);
      console.log(`❓ Is Expired: ${result.isExpired ? '✅ YES' : '❌ NO'}`);
      console.log(`💭 Reasoning: ${result.reasoning}`);
      console.log(`📊 Confidence: ${result.confidenceScore}%`);
      
      if (result.isExpired && result.confidenceScore >= CONFIDENCE_THRESHOLD) {
        console.log(`🗑️  ACTION: Archiving (above ${CONFIDENCE_THRESHOLD}% threshold)`);
        await archiveIntent(intent.id, intent.userId);
        return { archived: true };
      } else if (result.isExpired) {
        console.log(`⏭️  ACTION: Skipping (below ${CONFIDENCE_THRESHOLD}% confidence threshold)`);
      } else {
        console.log(`✨ ACTION: Keeping (not expired)`);
      }
      console.log('='.repeat(80));
      
      return { archived: false };
    })
  );

  const audited = results.filter(r => r.status === 'fulfilled').length;
  const archived = results.filter(r => r.status === 'fulfilled' && r.value.archived).length;
  const errors = results.filter(r => r.status === 'rejected').length;

  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      console.error(`❌ Error processing intent ${allIntents[idx].id}:`, result.reason);
    }
  });

  console.log(`✅ Audit complete: ${audited} audited, ${archived} archived, ${errors} errors`);

  return { audited, archived, errors };
}

