import { traceableLlm } from '../../../lib/agents';
import db from '../../../lib/db';
import { files, indexLinks, userIntegrations } from '../../../lib/schema';
import { eq } from 'drizzle-orm';
import { getDisplayName } from '../../../lib/integrations/config';

// Toggle to enable/disable logs
const ENABLE_LOGS = false;

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
 * Evaluate appropriateness against index prompt only
 */
async function evaluateIndexAppropriateness(
  intentPayload: string,
  indexPrompt: string,
  sourceName?: string
): Promise<number> {
  const systemMessage = {
    role: "system",
    content: `You are an intent appropriateness evaluator. Determine how well an intent matches an index purpose.

Scoring rubric:
- 0.9-1.0: Highly appropriate, perfect match
- 0.7-0.8: Good match, should be included
- 0.5-0.6: Moderate, borderline
- 0.3-0.4: Low appropriateness, poor fit
- 0.0-0.2: Not appropriate

Output format: Return ONLY a decimal number (e.g., 0.85)`
  };

  const sourceInfo = sourceName ? `\nSource: ${sourceName}\n` : '';
  const userMessage = {
    role: "user",
    content: `Evaluate this intent against the index purpose:
${sourceInfo}
Intent: ${intentPayload}

Index purpose: ${indexPrompt}

Score:`
  };

  const evaluateCall = traceableLlm(
    "intent-indexer",
    {
      agent_type: "intent_indexer",
      operation: "index_appropriateness_evaluation",
      intent_length: intentPayload.length,
      index_prompt_length: indexPrompt.length
    }
  );
  
  const response = await evaluateCall([systemMessage, userMessage]);
  const scoreText = (response.content as string).trim();
  const score = parseFloat(scoreText);
  
  if (isNaN(score) || score < 0 || score > 1) {
    console.warn(`Invalid index appropriateness score returned: ${scoreText}, defaulting to 0.0`);
    return 0.0;
  }
  
  return score;
}

/**
 * Evaluate appropriateness against member prompt only
 */
async function evaluateMemberAppropriateness(
  intentPayload: string,
  memberPrompt: string,
  sourceName?: string
): Promise<number> {
  const systemMessage = {
    role: "system",
    content: `You are an intent appropriateness evaluator. Determine how well an intent matches a member's sharing preferences.

Scoring rubric:
- 0.9-1.0: Perfect match for sharing focus
- 0.7-0.8: Good alignment with intent
- 0.5-0.6: Moderate, borderline match
- 0.3-0.4: Low appropriateness, poor match
- 0.0-0.2: Doesn't match sharing focus

Output format: Return ONLY a decimal number (e.g., 0.85)`
  };

  const sourceInfo = sourceName ? `\nSource: ${sourceName}\n` : '';
  const userMessage = {
    role: "user",
    content: `Evaluate this intent against the member's sharing preferences:
${sourceInfo}
Intent: ${intentPayload}

Member wants to share: ${memberPrompt}

Score:`
  };

  const evaluateCall = traceableLlm(
    "intent-indexer",
    {
      agent_type: "intent_indexer",
      operation: "member_appropriateness_evaluation",
      intent_length: intentPayload.length,
      member_prompt_length: memberPrompt.length
    }
  );
  
  const response = await evaluateCall([systemMessage, userMessage]);
  const scoreText = (response.content as string).trim();
  const score = parseFloat(scoreText);
  
  if (isNaN(score) || score < 0 || score > 1) {
    console.warn(`Invalid member appropriateness score returned: ${scoreText}, defaulting to 0.0`);
    return 0.0;
  }
  
  return score;
}

/**
 * Evaluate how appropriate an intent is to a specific index based on prompts
 * Uses context isolation - evaluates index prompt first, then member prompt only if index qualifies
 * Both scores must be separately > 0.7 to proceed
 */
export async function evaluateIntentAppropriateness(
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
    
    // If no prompts available, return 1 appropriateness
    if (!indexPrompt && !memberPrompt) {
      return 1;
    }
    
    // If only member prompt available (no index prompt), evaluate it directly
    if (!indexPrompt && memberPrompt) {
      const memberScore = await evaluateMemberAppropriateness(intentPayload, memberPrompt, sourceName);
      if (ENABLE_LOGS) console.log(`📊 Member appropriateness score (index prompt not available): ${memberScore.toFixed(3)}`);
      return memberScore;
    }
    
    // Evaluate index prompt first (if available)
    let indexScore = 0.0;
    if (indexPrompt) {
      indexScore = await evaluateIndexAppropriateness(intentPayload, indexPrompt, sourceName);
      if (ENABLE_LOGS) console.log(`📊 Index appropriateness score: ${indexScore.toFixed(3)}`);
      
      // If index prompt doesn't qualify, return early without evaluating member prompt
      if (indexScore <= QUALIFICATION_THRESHOLD) {
        if (ENABLE_LOGS) console.log(`❌ Index score ${indexScore.toFixed(3)} not above threshold ${QUALIFICATION_THRESHOLD}, skipping member prompt evaluation`);
        return indexScore;
      }
    }
    
    // Index prompt qualified, now evaluate member prompt (if available)
    let memberScore = 0.0;
    if (memberPrompt) {
      memberScore = await evaluateMemberAppropriateness(intentPayload, memberPrompt, sourceName);
      if (ENABLE_LOGS) console.log(`📊 Member appropriateness score: ${memberScore.toFixed(3)}`);
      
      // Both scores must be separately > 0.7
      if (memberScore <= QUALIFICATION_THRESHOLD) {
        if (ENABLE_LOGS) console.log(`❌ Member score ${memberScore.toFixed(3)} not above threshold ${QUALIFICATION_THRESHOLD}`);
        return 0.0; // Return 0 if member score doesn't qualify
      }
      
      // Both scores qualified, combine with weighted average
      // Index prompt gets higher weight (0.6) as it defines the index purpose
      // Member prompt gets lower weight (0.4) as it's more specific to user
      const finalScore = (indexScore * 0.6) + (memberScore * 0.4);
      if (ENABLE_LOGS) console.log(`📊 Final combined appropriateness score: ${finalScore.toFixed(3)}`);
      return finalScore;
    } else {
      // Only index prompt available and it qualified
      if (ENABLE_LOGS) console.log(`📊 Final appropriateness score (member prompt not available): ${indexScore.toFixed(3)}`);
      return indexScore;
    }
    
  } catch (error) {
    console.error('Error evaluating intent appropriateness:', error);
    return 0.0; // Default to no appropriateness on error
  }
}
