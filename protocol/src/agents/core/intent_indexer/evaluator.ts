import { traceableLlm } from '../../../lib/agents';

/**
 * Evaluate relevance against index prompt only
 */
async function evaluateIndexRelevance(
  intentPayload: string,
  indexPrompt: string
): Promise<number> {
  const prompt = `You are an intent relevance evaluator that determines how well an intent matches an index purpose.

INTENT TO EVALUATE:
${intentPayload}

INDEX PURPOSE:
${indexPrompt}

INSTRUCTIONS:
- Analyze how relevant this intent is to the index purpose
- Focus only on the index purpose, ignore any other context
- Return ONLY a decimal number between 0.0 and 1.0 where:
  - 0.9-1.0: Highly relevant, perfect match for the index purpose
  - 0.7-0.8: Good relevance, should be included
  - 0.5-0.6: Moderate relevance, borderline
  - 0.3-0.4: Low relevance, probably not a good fit
  - 0.0-0.2: Not relevant, should not be included

Return only the numeric score (e.g., 0.85):`;

  const evaluateCall = traceableLlm(
    "intent-indexer-index-evaluator",
    [],
    {
      agent_type: "intent_indexer",
      operation: "index_relevance_evaluation",
      intent_length: intentPayload.length,
      index_prompt_length: indexPrompt.length
    }
  );
  
  const response = await evaluateCall(prompt);
  const scoreText = (response.content as string).trim();
  const score = parseFloat(scoreText);
  
  if (isNaN(score) || score < 0 || score > 1) {
    console.warn(`Invalid index relevance score returned: ${scoreText}, defaulting to 0.0`);
    return 0.0;
  }
  
  return score;
}

/**
 * Evaluate relevance against member prompt only
 */
async function evaluateMemberRelevance(
  intentPayload: string,
  memberPrompt: string
): Promise<number> {
  const prompt = `You are an intent relevance evaluator that determines how well an intent matches a member's sharing focus.

INTENT TO EVALUATE:
${intentPayload}

MEMBER SHARING FOCUS:
${memberPrompt}

INSTRUCTIONS:
- Analyze how relevant this intent is to what the member wants to share
- Focus only on the member's sharing preferences, ignore any other context
- Return ONLY a decimal number between 0.0 and 1.0 where:
  - 0.9-1.0: Highly relevant, perfect match for member's sharing focus
  - 0.7-0.8: Good relevance, aligns with member's intent
  - 0.5-0.6: Moderate relevance, borderline match
  - 0.3-0.4: Low relevance, probably not what member wants to share
  - 0.0-0.2: Not relevant, doesn't match member's sharing focus

Return only the numeric score (e.g., 0.85):`;

  const evaluateCall = traceableLlm(
    "intent-indexer-member-evaluator",
    [],
    {
      agent_type: "intent_indexer",
      operation: "member_relevance_evaluation",
      intent_length: intentPayload.length,
      member_prompt_length: memberPrompt.length
    }
  );
  
  const response = await evaluateCall(prompt);
  const scoreText = (response.content as string).trim();
  const score = parseFloat(scoreText);
  
  if (isNaN(score) || score < 0 || score > 1) {
    console.warn(`Invalid member relevance score returned: ${scoreText}, defaulting to 0.0`);
    return 0.0;
  }
  
  return score;
}

/**
 * Evaluate how relevant an intent is to a specific index based on prompts
 * Uses context isolation - evaluates index prompt first, then member prompt only if index qualifies
 */
export async function evaluateIntentRelevance(
  intentPayload: string,
  indexPrompt: string | null,
  memberPrompt: string | null
): Promise<number> {
  try {
    const QUALIFICATION_THRESHOLD = 0.7;
    
    // If no prompts available, return 0 relevance
    if (!indexPrompt && !memberPrompt) {
      return 0.0;
    }
    
    // If only member prompt available (no index prompt), evaluate it directly
    if (!indexPrompt && memberPrompt) {
      const memberScore = await evaluateMemberRelevance(intentPayload, memberPrompt);
      console.log(`📊 Member relevance score (index prompt not available): ${memberScore.toFixed(3)}`);
      return memberScore;
    }
    
    // Evaluate index prompt first (if available)
    let indexScore = 0.0;
    if (indexPrompt) {
      indexScore = await evaluateIndexRelevance(intentPayload, indexPrompt);
      console.log(`📊 Index relevance score: ${indexScore.toFixed(3)}`);
      
      // If index prompt doesn't qualify, return early without evaluating member prompt
      if (indexScore < QUALIFICATION_THRESHOLD) {
        console.log(`❌ Index score ${indexScore.toFixed(3)} below threshold ${QUALIFICATION_THRESHOLD}, skipping member prompt evaluation`);
        return indexScore;
      }
    }
    
    // Index prompt qualified, now evaluate member prompt (if available)
    let memberScore = 0.0;
    if (memberPrompt) {
      memberScore = await evaluateMemberRelevance(intentPayload, memberPrompt);
      console.log(`📊 Member relevance score: ${memberScore.toFixed(3)}`);
      
      // Combine scores with weighted average
      // Index prompt gets higher weight (0.6) as it defines the index purpose
      // Member prompt gets lower weight (0.4) as it's more specific to user
      const finalScore = (indexScore * 0.6) + (memberScore * 0.4);
      console.log(`📊 Final combined relevance score: ${finalScore.toFixed(3)}`);
      return finalScore;
    } else {
      // Only index prompt available and it qualified
      console.log(`📊 Final relevance score (member prompt not available): ${indexScore.toFixed(3)}`);
      return indexScore;
    }
    
  } catch (error) {
    console.error('Error evaluating intent relevance:', error);
    return 0.0; // Default to no relevance on error
  }
}
