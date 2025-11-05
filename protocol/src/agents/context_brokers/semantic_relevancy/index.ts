import { BaseContextBroker } from '../base';
import { intents, intentStakes } from '../../../lib/schema';
import { eq, sql, and, desc } from 'drizzle-orm';
import { traceableStructuredLlm } from "../../../lib/agents";
import { z } from "zod";

export class SemanticRelevancyBroker extends BaseContextBroker {
  constructor(agentId: string) {
    super(agentId);
  }

  /**
   * Log comprehensive summary of the entire operation
   */
  private logOperationSummary(stats: {
    sessionId: string;
    intentId: string;
    userId: string;
    intentPayload: string;
    usersEvaluated: number;
    userResults: Array<{
      userId: string;
      mutualIntentsFound: number;
      stakesDeleted: number;
      stakesInserted: number;
      finalStakeCount: number;
    }>;
    totalMutualIntents: number;
    totalStakesDeleted: number;
    totalStakesInserted: number;
    errors: number;
  }, duration: number): void {
    const summary = `
${'='.repeat(100)}
SEMANTIC RELEVANCY BROKER - OPERATION SUMMARY
${'='.repeat(100)}

Session ID: ${stats.sessionId}
Timestamp: ${new Date().toISOString()}
Duration: ${duration}ms

INTENT PROCESSED:
  Intent ID: ${stats.intentId}
  User ID: ${stats.userId}
  Payload: ${stats.intentPayload}

EVALUATION SCOPE:
  Users Evaluated: ${stats.usersEvaluated}
  Total Intents Evaluated: ${stats.userResults.reduce((sum, r) => sum + r.mutualIntentsFound, 0)} intent pairs checked

MUTUALITY RESULTS (Score >= 70):
  Total Mutual Intents Found: ${stats.totalMutualIntents}
  Average per User: ${stats.usersEvaluated > 0 ? (stats.totalMutualIntents / stats.usersEvaluated).toFixed(2) : '0'}

STAKE OPERATIONS:
  Total Stakes Deleted: ${stats.totalStakesDeleted}
  Total Stakes Inserted: ${stats.totalStakesInserted}
  Net Change: ${stats.totalStakesInserted - stats.totalStakesDeleted > 0 ? '+' : ''}${stats.totalStakesInserted - stats.totalStakesDeleted}

USER-BY-USER BREAKDOWN:
${stats.userResults.map((result, idx) => `  ${idx + 1}. User: ${result.userId}
     Mutual Intents: ${result.mutualIntentsFound}
     Stakes Deleted: ${result.stakesDeleted}
     Stakes Inserted: ${result.stakesInserted}
     Final Stakes: ${result.finalStakeCount}`).join('\n\n')}

PERFORMANCE:
  Total Duration: ${duration}ms
  Avg Time per User: ${stats.usersEvaluated > 0 ? Math.round(duration / stats.usersEvaluated) : 0}ms
  Errors: ${stats.errors}

STATUS: ${stats.errors === 0 ? '✅ SUCCESS' : `⚠️  COMPLETED WITH ${stats.errors} ERRORS`}

${'='.repeat(100)}
`;

    // Log condensed version to console
    console.log(`\n📊 OPERATION SUMMARY:`);
    console.log(`   Intent: ${stats.intentId}`);
    console.log(`   Users Evaluated: ${stats.usersEvaluated}`);
    console.log(`   Mutual Intents Found: ${stats.totalMutualIntents}`);
    console.log(`   Stakes: ${stats.totalStakesDeleted} deleted, ${stats.totalStakesInserted} inserted`);
    console.log(`   Duration: ${duration}ms`);
  }

  /**
   * Main entry point - NO QUEUE, direct processing
   */
  async onIntentCreated(intentId: string): Promise<void> {
    console.log(`🤖 SemanticRelevancyBroker: Processing intent ${intentId}`);
    
    const startTime = Date.now();
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Get the new intent
    const newIntent = await this.db.select()
      .from(intents)
      .where(eq(intents.id, intentId))
      .then(rows => rows[0]);

    if (!newIntent) {
      console.error(`Intent ${intentId} not found`);
      return;
    }

    console.log('🔍 Finding top 10 most relevant users...');
    
    // Find top 10 users by intent similarity
    const topUsers = await this.findTopUsersByIntentSimilarity(newIntent);
    console.log(`Found ${topUsers.length} relevant users`);

    // Track statistics for summary
    const stats = {
      sessionId,
      intentId,
      userId: newIntent.userId,
      intentPayload: newIntent.payload,
      usersEvaluated: topUsers.length,
      userResults: [] as Array<{
        userId: string;
        mutualIntentsFound: number;
        stakesDeleted: number;
        stakesInserted: number;
        finalStakeCount: number;
      }>,
      totalMutualIntents: 0,
      totalStakesDeleted: 0,
      totalStakesInserted: 0,
      errors: 0
    };

    // Process each user relationship synchronously (NO QUEUE)
    for (const targetUser of topUsers) {
      try {
        const result = await this.evaluateUserRelationship(newIntent, targetUser);
        stats.userResults.push(result);
        stats.totalMutualIntents += result.mutualIntentsFound;
        stats.totalStakesDeleted += result.stakesDeleted;
        stats.totalStakesInserted += result.stakesInserted;
      } catch (error) {
        console.error(`Error evaluating relationship with user ${targetUser.userId}:`, error);
        stats.errors++;
      }
    }

    const duration = Date.now() - startTime;

    // Generate and log comprehensive summary
    this.logOperationSummary(stats, duration);

    console.log(`✅ Completed processing ${topUsers.length} user relationships in ${duration}ms`);
  }

  /**
   * Find top 10 users grouped by intent similarity
   */
  private async findTopUsersByIntentSimilarity(newIntent: any): Promise<Array<{
    userId: string;
    intents: any[];
    maxSimilarity: number;
  }>> {
    // Find similar intents using vector search (limit 50 to ensure we get enough variety)
    const similarIntents = await this.findSemanticallyRelatedIntents(newIntent);
    
    // Group by userId
    const userMap = new Map<string, {
      userId: string;
      intents: any[];
      maxSimilarity: number;
    }>();

    for (const relatedIntentData of similarIntents) {
      const relatedIntent = relatedIntentData.intent || relatedIntentData;
      const userId = relatedIntent.userId;
      const similarity = relatedIntentData.score || 0;

      if (!userMap.has(userId)) {
        userMap.set(userId, {
          userId,
          intents: [],
          maxSimilarity: 0
        });
      }

      const userData = userMap.get(userId)!;
      userData.intents.push(relatedIntent);
      userData.maxSimilarity = Math.max(userData.maxSimilarity, similarity);
    }

    // Sort by max similarity and take top 10 users
    return Array.from(userMap.values())
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity)
      .slice(0, 10);
  }

  /**
   * Evaluate user relationship with two-stage LLM approach
   * Returns statistics for summary logging
   */
  private async evaluateUserRelationship(
    newIntent: any,
    targetUser: { userId: string; intents: any[]; maxSimilarity: number }
  ): Promise<{
    userId: string;
    mutualIntentsFound: number;
    stakesDeleted: number;
    stakesInserted: number;
    finalStakeCount: number;
  }> {
    console.log(`\n👥 Evaluating relationship: ${newIntent.userId} ↔ ${targetUser.userId}`);

    let mutualIntentsFound = 0;
    let stakesDeleted = 0;
    let stakesInserted = 0;
    let finalStakeCount = 0;

    await this.db.transaction(async (tx) => {
      // Get existing stakes between these users (with lock)
      const existingStakes = await tx.select({
        id: intentStakes.id,
        stake: intentStakes.stake,
        intents: intentStakes.intents,
        reasoning: intentStakes.reasoning
      })
        .from(intentStakes)
        .where(and(
          eq(intentStakes.agentId, this.agentId),
          sql`EXISTS (
            SELECT 1 FROM ${intents} i1
            WHERE i1.id::text = ANY(${intentStakes.intents})
            AND i1.user_id = ${newIntent.userId}
          )`,
          sql`EXISTS (
            SELECT 1 FROM ${intents} i2
            WHERE i2.id::text = ANY(${intentStakes.intents})
            AND i2.user_id = ${targetUser.userId}
          )`
        ))
        .orderBy(desc(intentStakes.stake))
        .for('update'); // Lock rows

      console.log(`   🔒 Found ${existingStakes.length} existing stakes (locked)`);
      stakesDeleted = existingStakes.length; // Will delete all existing

      // ===== STAGE 1: MUTUALITY EVALUATION (STRICTER) =====
      console.log(`   📋 Stage 1: Evaluating mutuality for ${targetUser.intents.length} target intents...`);

      const mutualityPromises = targetUser.intents.map(async (targetIntent) => {
        const evaluation = await this.evaluateMutualityStrict(newIntent, targetIntent);

        console.log(`   🔍 Evaluation: ${evaluation?.isMutual} ${evaluation?.confidenceScore}`);
        
        // STRICT FILTER: Only keep if mutual AND score >= 70
        if (evaluation && evaluation.isMutual && evaluation.confidenceScore >= 70) {
          return {
            targetIntentId: targetIntent.id,
            score: evaluation.confidenceScore,
            reasoning: evaluation.reasoning
          };
        }
        return null;
      });

      const mutualResults = (await Promise.all(mutualityPromises)).filter(r => r !== null);
      mutualIntentsFound = mutualResults.length;
      console.log(`   ✅ Stage 1 complete: ${mutualResults.length} mutual intents found (>= 70 score)`);

      console.log(mutualResults);
      if (mutualResults.length === 0 && existingStakes.length === 0) {
        console.log(`   ⏭️  No mutual intents and no existing stakes - skipping`);
        stakesDeleted = 0; // Nothing deleted
        return;
      }

      // ===== STAGE 2: RANKING =====
      console.log(`   🏆 Stage 2: Ranking all candidate pairs...`);

      const candidatePairs = [
        // New mutual pairs
        ...mutualResults.map(r => ({
          type: 'new' as const,
          newIntentId: newIntent.id,
          targetIntentId: r.targetIntentId,
          score: r.score,
          reasoning: r.reasoning
        })),
        // Existing stakes
        ...existingStakes.map(stake => ({
          type: 'existing' as const,
          stakeId: stake.id,
          newIntentId: stake.intents[0],
          targetIntentId: stake.intents[1],
          score: Number(stake.stake),
          reasoning: stake.reasoning
        }))
      ];

      const rankingResult = await this.rankIntentPairs(candidatePairs);
      stakesInserted = rankingResult.top3IntentPairs.length;
      finalStakeCount = stakesInserted;
      console.log(`   ✅ Stage 2 complete: Selected top ${rankingResult.top3IntentPairs.length} pairs`);

      // ===== EXECUTE: DELETE ALL, INSERT TOP 3 =====
      console.log(`   🔧 Executing: Delete ${existingStakes.length}, Insert ${rankingResult.top3IntentPairs.length}`);

      // Delete all existing stakes
      for (const stake of existingStakes) {
        await tx.delete(intentStakes).where(eq(intentStakes.id, stake.id));
      }

      // Insert top 3
      for (const pair of rankingResult.top3IntentPairs) {
        const pairData = candidatePairs.find(
          c => c.newIntentId === pair.newIntentId && c.targetIntentId === pair.targetIntentId
        );
        
        if (pairData) {
          const sortedIntents = [pair.newIntentId, pair.targetIntentId].sort();
          await tx.insert(intentStakes).values({
            intents: sortedIntents,
            stake: BigInt(Math.round(pairData.score)), // Round to integer before converting to BigInt
            reasoning: pairData.reasoning,
            agentId: this.agentId
          });
        }
      }

      console.log(`   ✔️  Committed - user pair now has ${rankingResult.top3IntentPairs.length} stakes`);
    });

    return {
      userId: targetUser.userId,
      mutualIntentsFound,
      stakesDeleted,
      stakesInserted,
      finalStakeCount
    };
  }

  /**
   * Evaluate mutuality with STRICTER criteria (existing structure)
   */
  private async evaluateMutualityStrict(
    newIntent: any,
    targetIntent: any
  ): Promise<{ isMutual: boolean; confidenceScore: number; reasoning: string } | null> {
    const MutualIntentSchema = z.object({
      isMutual: z.boolean().describe("Whether the two intents have mutual intent (both relate to or depend on each other)"),
      reasoning: z.string().describe("If mutual, explain why they are mutually related in one sentence. If not mutual, provide empty string."),
      confidenceScore: z.number().min(0).max(100).describe("Precise confidence score 0-100. Use full range 70-100 for mutual matches. Avoid round numbers like 100, 90, 80. Be specific: 87, 76, 92, etc.")
    });

    const systemMessage = {
      role: "system",
      content: `You are a semantic relationship analyst. Determine if two intents have MUTUAL relevance (both relate to or complement each other).

CRITICAL: You MUST provide specific scores. 

STRICT Mutual criteria (INCREASED RIGOR):
- Both intents seek things that complement each other (e.g., investor + startup, designer + developer)
- Both intents could lead to HIGH-VALUE connection or collaboration
- There's bidirectional value (not just one-way interest)
- IMMEDIATELY actionable and valuable
- Specific, not vague connections

Score threshold: Must be >= 70 to qualify as mutual

CONFIDENCE SCORING RUBRIC (BE PRECISE AND VARIED):

95-100: EXCEPTIONAL MATCH
- Perfect complementary fit (e.g., "seed investor" + "seeking seed funding")
- Highly specific and aligned
- Both parties' exact needs met
- Immediate, obvious value

85-94: STRONG MATCH
- Clear complementary value but with minor gaps
- Strong alignment with some flexibility needed
- Specific enough to be actionable
- High confidence but not perfect

75-84: GOOD MATCH
- Solid mutual benefit but requires some interpretation
- Generally aligned but may need clarification
- Actionable with moderate effort
- Some specificity gaps

70-74: ACCEPTABLE MATCH (THRESHOLD)
- Meets minimum criteria for mutual relevance
- Has potential but less certain
- May need significant qualification
- Borderline actionable

Below 70: NOT MUTUAL
- Reject these outright

SCORING EXAMPLES (study these closely):
- "Seeking pre-seed AI investors" + "Investing in pre-seed AI companies" → 98 (perfect stage + sector match)
- "Need React developer for 3-month project" + "Available for React contract work" → 92 (clear but timeline unconfirmed)
- "Looking for design partners" + "Seeking startups needing UI/UX help" → 87 (aligned but vague scope)
- "Seeking technical cofounder" + "Open to cofounder opportunities in tech" → 81 (mutual but broad)
- "Interested in blockchain projects" + "Building DeFi tools, need advisors" → 76 (related but role unclear)
- "Want to learn about AI" + "Teaching AI fundamentals" → 73 (educational match but commitment unclear)
- "Looking for networking in SF" + "Attending SF tech events" → 65 (too vague, REJECT)
- "Seeking customers" + "Seeking customers" → 20 (same need, REJECT)

IMPORTANT: 
- Use the full 70-100 range
- Be critical and precise
- Most matches should be 75-90, not 95-100
- Only exceptional perfect matches deserve 95+
- Differentiate based on specificity, clarity, and actionability`
    };

    const userMessage = {
      role: "user",
      content: `Analyze these intents for mutual relevance:

Intent 1: ${newIntent.payload}
Intent 2: ${targetIntent.payload}

Are these mutually relevant with high confidence (>= 70 score)? Provide score and reasoning.`
    };

    try {
      const reasoningCall = traceableStructuredLlm(
        "semantic-relevancy",
        {
          agent_type: "semantic_relevancy_broker",
          operation: "mutuality_evaluation",
          new_intent_id: newIntent.id,
          target_intent_id: targetIntent.id
        }
      );
      
      const response = await reasoningCall([systemMessage, userMessage], MutualIntentSchema);
      return {
        isMutual: response.isMutual,
        confidenceScore: response.confidenceScore,
        reasoning: response.reasoning
      };
    } catch (error) {
      console.error(`Error evaluating mutuality:`, error);
      return null;
    }
  }

  /**
   * Rank all candidate pairs and return top 3
   */
  private async rankIntentPairs(
    candidatePairs: Array<{
      type: 'new' | 'existing';
      newIntentId: string;
      targetIntentId: string;
      score: number;
      reasoning: string;
      stakeId?: string;
    }>
  ): Promise<{ top3IntentPairs: Array<{ newIntentId: string; targetIntentId: string }> }> {
    if (candidatePairs.length === 0) {
      return { top3IntentPairs: [] };
    }

    // If 3 or fewer candidates, return all
    if (candidatePairs.length <= 3) {
      return {
        top3IntentPairs: candidatePairs.map(c => ({
          newIntentId: c.newIntentId,
          targetIntentId: c.targetIntentId
        }))
      };
    }

    const RankingSchema = z.object({
      top3IntentPairs: z.array(z.object({
        newIntentId: z.string(),
        targetIntentId: z.string()
      })).max(3).describe("Top 3 intent pair IDs ranked by mutual value quality")
    });

    const systemMessage = {
      role: "system",
      content: `You are a ranking system for intent pairs between two users.

Task: Select the TOP 3 intent pairs that represent the BEST mutual value opportunities.

Candidates include:
- NEW pairs: From recent mutuality evaluation (scored >= 70)
- EXISTING pairs: Current stakes between these users

Ranking criteria (in priority order):
1. **Score/Quality**: Higher confidence scores indicate stronger mutual value
2. **Specificity**: More specific intents are more actionable than vague ones
3. **Actionability**: Can both parties immediately act on this connection?
4. **Complementarity**: How well do the intents complement each other?
5. **Recency**: When comparing similar scores, prefer newer evaluations

Strategy:
- Don't just pick the 3 highest scores mechanically
- Consider the overall value profile for the user relationship
- Diversity can be valuable (different types of collaboration)
- But quality always trumps diversity

Return exactly 3 pairs (or fewer if less than 3 candidates exist).`
    };

    const userMessage = {
      role: "user",
      content: `Rank these intent pairs and return the top 3:

${candidatePairs.map((c, i) => 
  `${i + 1}. ${c.type.toUpperCase()} - Intent ${c.newIntentId} ↔ ${c.targetIntentId}
   Score: ${c.score}
   Reasoning: ${c.reasoning}`
).join('\n\n')}

Return the top 3 pairs by quality (prioritize higher scores).`
    };

    try {
      const rankingCall = traceableStructuredLlm(
        "semantic-relevancy",
        {
          agent_type: "semantic_relevancy_broker",
          operation: "ranking",
          candidate_count: candidatePairs.length
        }
      );
      
      const response = await rankingCall([systemMessage, userMessage], RankingSchema);
      return {
        top3IntentPairs: response.top3IntentPairs || []
      };
    } catch (error) {
      console.error(`Error ranking pairs:`, error);
      // Fallback: return top 3 by score
      return {
        top3IntentPairs: candidatePairs
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(c => ({
            newIntentId: c.newIntentId,
            targetIntentId: c.targetIntentId
          }))
      };
    }
  }

  async onIntentUpdated(intentId: string): Promise<void> {
    console.log(`🤖 SemanticRelevancyBroker: Processing updated intent ${intentId}`);
    // Reprocess like new intent
    await this.onIntentCreated(intentId);
  }

  async onIntentArchived(intentId: string): Promise<void> {
    // Remove all stakes that include this intent
    await this.db.delete(intentStakes)
      .where(sql`${intentStakes.intents} @> ARRAY[${intentId}]`);
  }
}
