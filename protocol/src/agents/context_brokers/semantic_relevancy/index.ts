import { BaseContextBroker } from '../base';
import { intents, intentStakes } from '../../../lib/schema';
import { eq, sql, and, desc } from 'drizzle-orm';
import { traceableStructuredLlm } from "../../../lib/agents";
import { z } from "zod";
import { INTENT_INFERRER_AGENT_ID } from '../../../lib/agent-ids';

export class SemanticRelevancyBroker extends BaseContextBroker {
  constructor(agentId: string) {
    super(agentId);
  }

  /**
   * Main entry point - processes intent and finds relevant user matches
   */
  async onIntentCreated(intentId: string): Promise<void> {
    const startTime = Date.now();
    console.log(`🤖 SemanticRelevancyBroker: Processing intent ${intentId}`);
    
    const newIntent = await this.getIntent(intentId);
    if (!newIntent) return;

    const topUsers = await this.findTopUsersByIntentSimilarity(newIntent);
    console.log(`🔍 Found ${topUsers.length} relevant users`);

    await this.processUserRelationships(newIntent, topUsers);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Completed in ${duration}ms`);
  }

  /**
   * Get intent from database
   */
  private async getIntent(intentId: string): Promise<any | null> {
    const rows = await this.db.select()
      .from(intents)
      .where(eq(intents.id, intentId));
    
    if (rows.length === 0) {
      console.error(`Intent ${intentId} not found`);
      return null;
    }
    
    return rows[0];
  }

  /**
   * Process all user relationships
   */
  private async processUserRelationships(
    newIntent: any,
    topUsers: Array<{ userId: string; intents: any[]; maxSimilarity: number }>
  ): Promise<void> {
    for (const targetUser of topUsers) {
      try {
        await this.evaluateUserRelationship(newIntent, targetUser);
      } catch (error) {
        console.error(`Error evaluating relationship with user ${targetUser.userId}:`, error);
      }
    }
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
   */
  private async evaluateUserRelationship(
    newIntent: any,
    targetUser: { userId: string; intents: any[]; maxSimilarity: number }
  ): Promise<void> {
    console.log(`\n👥 Evaluating: ${newIntent.userId} ↔ ${targetUser.userId}`);

    // Get existing stakes between these users
    const existingStakes = await this.getExistingStakes(this.db, newIntent.userId, targetUser.userId);
    console.log(`   🔒 Found ${existingStakes.length} existing stakes`);

    // Stage 1: Find mutual intents
    const mutualResults = await this.findMutualIntents(newIntent, targetUser.intents);
    console.log(`   ✅ Stage 1: ${mutualResults.length} mutual intents (≥70 score)`);

    // Skip if no mutual intents and no existing stakes
    if (mutualResults.length === 0 && existingStakes.length === 0) {
      console.log(`   ⏭️  Skipping - no mutual intents or existing stakes`);
      return;
    }

    // Stage 2: Rank all candidates and get top 3
    const candidatePairs = this.buildCandidatePairs(newIntent.id, mutualResults, existingStakes);
    const rankingResult = await this.rankIntentPairs(candidatePairs);
    console.log(`   ✅ Stage 2: Selected top ${rankingResult.top3IntentPairs.length} pairs`);

    // Execute: Delete all existing, insert top 3
    await this.updateStakes(this.db, existingStakes, rankingResult.top3IntentPairs, candidatePairs);
    console.log(`   ✔️  Committed - ${rankingResult.top3IntentPairs.length} stakes`);
  }

  /**
   * Get existing stakes between two users
   */
  private async getExistingStakes(db: any, userId1: string, userId2: string) {
    return await db.select({
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
        AND i1.user_id = ${userId1}
      )`,
      sql`EXISTS (
        SELECT 1 FROM ${intents} i2
        WHERE i2.id::text = ANY(${intentStakes.intents})
        AND i2.user_id = ${userId2}
      )`
    ))
    .orderBy(desc(intentStakes.stake));
  }

  /**
   * Find mutual intents between new intent and target intents
   */
  private async findMutualIntents(newIntent: any, targetIntents: any[]) {
    const mutualityPromises = targetIntents.map(async (targetIntent) => {
      const evaluation = await this.evaluateMutualityStrict(newIntent, targetIntent);
      console.log(`   🔍 Evaluation: ${evaluation?.isMutual} ${evaluation?.confidenceScore}`);
      
      if (evaluation && evaluation.isMutual && evaluation.confidenceScore >= 70) {
        return {
          targetIntentId: targetIntent.id,
          score: evaluation.confidenceScore,
          reasoning: evaluation.reasoning
        };
      }
      return null;
    });

    const results = await Promise.all(mutualityPromises);
    return results.filter(r => r !== null);
  }

  /**
   * Build candidate pairs from mutual results and existing stakes
   */
  private buildCandidatePairs(
    newIntentId: string,
    mutualResults: Array<{ targetIntentId: string; score: number; reasoning: string }>,
    existingStakes: Array<{ id: string; stake: bigint; intents: string[]; reasoning: string }>
  ) {
    return [
      ...mutualResults.map(r => ({
        type: 'new' as const,
        newIntentId,
        targetIntentId: r.targetIntentId,
        score: r.score,
        reasoning: r.reasoning
      })),
      ...existingStakes.map(stake => ({
        type: 'existing' as const,
        stakeId: stake.id,
        newIntentId: stake.intents[0],
        targetIntentId: stake.intents[1],
        score: Number(stake.stake),
        reasoning: stake.reasoning
      }))
    ];
  }

  /**
   * Update stakes: delete existing and insert top 3
   */
  private async updateStakes(
    db: any,
    existingStakes: Array<{ id: string }>,
    top3Pairs: Array<{ newIntentId: string; targetIntentId: string }>,
    candidatePairs: Array<{ newIntentId: string; targetIntentId: string; score: number; reasoning: string }>
  ) {
    // Delete all existing stakes
    for (const stake of existingStakes) {
      await db.delete(intentStakes).where(eq(intentStakes.id, stake.id));
    }

    // Insert top 3
    for (const pair of top3Pairs) {
      const pairData = candidatePairs.find(
        c => c.newIntentId === pair.newIntentId && c.targetIntentId === pair.targetIntentId
      );
      
      if (pairData) {
        const sortedIntents = [pair.newIntentId, pair.targetIntentId].sort();
        
        const stake1 = await this.calculateWeightedStake(
          pair.newIntentId, 
          BigInt(Math.round(pairData.score)),
          INTENT_INFERRER_AGENT_ID
        );
        const stake2 = await this.calculateWeightedStake(
          pair.targetIntentId,
          BigInt(Math.round(pairData.score)),
          INTENT_INFERRER_AGENT_ID
        );
        
        const finalStake = stake1 < stake2 ? stake1 : stake2;
        
        await db.insert(intentStakes).values({
          intents: sortedIntents,
          stake: finalStake,
          reasoning: pairData.reasoning,
          agentId: this.agentId
        });
      }
    }
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
      reasoning: z.string().describe("If mutual, explain why they are mutually related in one sentence. Refer to intents by their subject matter (e.g., 'the immersive experience project' and 'the blockchain growth research') rather than by position or ordinal references. Do not use 'intent 1', 'intent 2', 'both intents', 'first intent', or 'second intent'. If not mutual, provide empty string."),
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
- EXCLUDE "adjacent but non-dependent" roles (e.g., designer + engineer unless explicitly co-building the same thing)
- EXCLUDE "same-side" roles (e.g., both hiring, both seeking mentors, both seeking funding)
- **STRICTLY EXCLUDE** A-seeks-Role AND B-seeks-Role (e.g., A needs an engineer, B needs a designer) - these are company-level needs, not a mutual intent pair.
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
- "Hiring React dev" + "Mentoring junior devs" → 45 (adjacent but not mutual)
- "Building AI tool" + "Looking for UI designer" → 60 (related but not mutual unless explicitly for same project)
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

"${newIntent.payload}" (Intent ID: ${newIntent.id})
"${targetIntent.payload}" (Intent ID: ${targetIntent.id})

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
  `${i + 1}. ${c.type.toUpperCase()} - Pair between Intent ${c.newIntentId} and Intent ${c.targetIntentId}
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
