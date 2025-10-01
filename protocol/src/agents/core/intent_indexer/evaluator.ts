import { traceableLlm } from '../../../lib/agents';
import db from '../../../lib/db';
import { files, indexLinks, userIntegrations } from '../../../lib/schema';
import { eq } from 'drizzle-orm';
import { getDisplayName } from '../../../lib/integrations/config';

async function getIntentSourceName(sourceType: string | null, sourceId: string | null): Promise<string> {
  if (!sourceType || !sourceId) {
    return '';
  }

  try {
    if (sourceType === 'file') {
      const fileData = await db.select({ name: files.name })
        .from(files)
        .where(eq(files.id, sourceId))
        .limit(1);
      return fileData[0]?.name ? `file: ${fileData[0].name}` : 'file';
    } else if (sourceType === 'link') {
      const linkData = await db.select({ url: indexLinks.url })
        .from(indexLinks)
        .where(eq(indexLinks.id, sourceId))
        .limit(1);
      if (linkData[0]?.url) {
        try {
          const url = new URL(linkData[0].url);
          return `link: ${url.hostname}`;
        } catch {
          return `link: ${linkData[0].url}`;
        }
      }
      return 'link';
    } else if (sourceType === 'integration') {
      const integrationData = await db.select({ integrationType: userIntegrations.integrationType })
        .from(userIntegrations)
        .where(eq(userIntegrations.id, sourceId))
        .limit(1);
      const integrationType = integrationData[0]?.integrationType;
      if (integrationType) {
        const displayName = getDisplayName(integrationType);
        return `${displayName} integration`;
      }
      return 'integration';
    }
  } catch (error) {
    console.warn(`Failed to get source name for ${sourceType}:${sourceId}:`, error);
  }

  return sourceType;
}

/**
 * Evaluate appropriation against index prompt only
 */
async function evaluateIndexAppropriation(
  intentPayload: string,
  indexPrompt: string,
  sourceName?: string
): Promise<number> {
  const sourceInfo = sourceName ? `\n\nINTENT SOURCE:\n${sourceName}` : '';
  const prompt = `You are an intent appropriation evaluator that determines how well an intent matches an index purpose.

INTENT TO EVALUATE:
${intentPayload}${sourceInfo}

INDEX PURPOSE:
${indexPrompt}

INSTRUCTIONS:
- Analyze how appropriate this intent is for the index purpose
- Focus only on the index purpose, ignore any other context
- Return ONLY a decimal number between 0.0 and 1.0 where:
  - 0.9-1.0: Highly appropriate, perfect match for the index purpose
  - 0.7-0.8: Good appropriation, should be included
  - 0.5-0.6: Moderate appropriation, borderline
  - 0.3-0.4: Low appropriation, probably not a good fit
  - 0.0-0.2: Not appropriate, should not be included

Return only the numeric score (e.g., 0.85):`;

  const evaluateCall = traceableLlm(
    "intent-indexer-index-evaluator",
    [],
    {
      agent_type: "intent_indexer",
      operation: "index_appropriation_evaluation",
      intent_length: intentPayload.length,
      index_prompt_length: indexPrompt.length
    }
  );
  
  const response = await evaluateCall(prompt);
  const scoreText = (response.content as string).trim();
  const score = parseFloat(scoreText);
  
  if (isNaN(score) || score < 0 || score > 1) {
    console.warn(`Invalid index appropriation score returned: ${scoreText}, defaulting to 0.0`);
    return 0.0;
  }
  
  return score;
}

/**
 * Evaluate appropriation against member prompt only
 */
async function evaluateMemberAppropriation(
  intentPayload: string,
  memberPrompt: string,
  sourceName?: string
): Promise<number> {
  const sourceInfo = sourceName ? `\n\nINTENT SOURCE:\n${sourceName}` : '';
  const prompt = `You are an intent appropriation evaluator that determines how well an intent matches a member's sharing focus.

INTENT TO EVALUATE:
${intentPayload}${sourceInfo}

MEMBER SHARING FOCUS:
${memberPrompt}

INSTRUCTIONS:
- Analyze how appropriate this intent is to what the member wants to share
- Focus only on the member's sharing preferences, ignore any other context
- Return ONLY a decimal number between 0.0 and 1.0 where:
  - 0.9-1.0: Highly appropriate, perfect match for member's sharing focus
  - 0.7-0.8: Good appropriation, aligns with member's intent
  - 0.5-0.6: Moderate appropriation, borderline match
  - 0.3-0.4: Low appropriation, probably not what member wants to share
  - 0.0-0.2: Not appropriate, doesn't match member's sharing focus

Return only the numeric score (e.g., 0.85):`;

  const evaluateCall = traceableLlm(
    "intent-indexer-member-evaluator",
    [],
    {
      agent_type: "intent_indexer",
      operation: "member_appropriation_evaluation",
      intent_length: intentPayload.length,
      member_prompt_length: memberPrompt.length
    }
  );
  
  const response = await evaluateCall(prompt);
  const scoreText = (response.content as string).trim();
  const score = parseFloat(scoreText);
  
  if (isNaN(score) || score < 0 || score > 1) {
    console.warn(`Invalid member appropriation score returned: ${scoreText}, defaulting to 0.0`);
    return 0.0;
  }
  
  return score;
}

/**
 * Evaluate how appropriate an intent is to a specific index based on prompts
 * Uses context isolation - evaluates index prompt first, then member prompt only if index qualifies
 * Both scores must be separately > 0.7 to proceed
 */
export async function evaluateIntentAppropriation(
  intentPayload: string,
  indexPrompt: string | null,
  memberPrompt: string | null,
  sourceType?: string | null,
  sourceId?: string | null
): Promise<number> {
  try {
    const QUALIFICATION_THRESHOLD = 0.7;
    
    // Get source name for context
    const sourceName = await getIntentSourceName(sourceType || null, sourceId || null);
    
    // If no prompts available, return 0 appropriation
    if (!indexPrompt && !memberPrompt) {
      return 0.0;
    }
    
    // If only member prompt available (no index prompt), evaluate it directly
    if (!indexPrompt && memberPrompt) {
      const memberScore = await evaluateMemberAppropriation(intentPayload, memberPrompt, sourceName);
      console.log(`📊 Member appropriation score (index prompt not available): ${memberScore.toFixed(3)}`);
      return memberScore;
    }
    
    // Evaluate index prompt first (if available)
    let indexScore = 0.0;
    if (indexPrompt) {
      indexScore = await evaluateIndexAppropriation(intentPayload, indexPrompt, sourceName);
      console.log(`📊 Index appropriation score: ${indexScore.toFixed(3)}`);
      
      // If index prompt doesn't qualify, return early without evaluating member prompt
      if (indexScore <= QUALIFICATION_THRESHOLD) {
        console.log(`❌ Index score ${indexScore.toFixed(3)} not above threshold ${QUALIFICATION_THRESHOLD}, skipping member prompt evaluation`);
        return indexScore;
      }
    }
    
    // Index prompt qualified, now evaluate member prompt (if available)
    let memberScore = 0.0;
    if (memberPrompt) {
      memberScore = await evaluateMemberAppropriation(intentPayload, memberPrompt, sourceName);
      console.log(`📊 Member appropriation score: ${memberScore.toFixed(3)}`);
      
      // Both scores must be separately > 0.7
      if (memberScore <= QUALIFICATION_THRESHOLD) {
        console.log(`❌ Member score ${memberScore.toFixed(3)} not above threshold ${QUALIFICATION_THRESHOLD}`);
        return 0.0; // Return 0 if member score doesn't qualify
      }
      
      // Both scores qualified, combine with weighted average
      // Index prompt gets higher weight (0.6) as it defines the index purpose
      // Member prompt gets lower weight (0.4) as it's more specific to user
      const finalScore = (indexScore * 0.6) + (memberScore * 0.4);
      console.log(`📊 Final combined appropriation score: ${finalScore.toFixed(3)}`);
      return finalScore;
    } else {
      // Only index prompt available and it qualified
      console.log(`📊 Final appropriation score (member prompt not available): ${indexScore.toFixed(3)}`);
      return indexScore;
    }
    
  } catch (error) {
    console.error('Error evaluating intent appropriation:', error);
    return 0.0; // Default to no appropriation on error
  }
}
