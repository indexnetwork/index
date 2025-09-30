import db from '../../../lib/db';
import { intents, intentIndexes, indexes, indexMembers } from '../../../lib/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { evaluateIntentAppropriation } from './evaluator';

export interface IntentIndexerResult {
  success: boolean;
  error?: string;
}

interface EligibleIndex {
  id: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}

export class IntentIndexer {

  /**
   * Process a specific intent for a specific index (used by queue processor)
   */
  async processIntentForIndex(intentId: string, indexId: string): Promise<void> {
    console.log(`🔍 Processing intent ${intentId} for index ${indexId}`);
    
    try {
      // Get intent and index details
      const intentData = await db.select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId
      }).from(intents)
        .where(eq(intents.id, intentId))
        .limit(1);
        
      if (intentData.length === 0) {
        console.error(`Intent ${intentId} not found`);
        return;
      }

      const intent = intentData[0];
      
      // Get the specific index details
      const indexData = await this.getEligibleIndexes(intent.userId);
      const targetIndex = indexData.find(idx => idx.id === indexId);
      
      if (!targetIndex) {
        console.log(`Index ${indexId} not eligible for user ${intent.userId}`);
        return;
      }

      // Check if already assigned
      const currentIndexes = await this.getCurrentIndexes(intentId);
      const isCurrentlyAssigned = currentIndexes.includes(indexId);
      
      // Evaluate appropriation
      const appropriationScore = await evaluateIntentAppropriation(
        intent.payload,
        targetIndex.indexPrompt || '',
        targetIndex.memberPrompt || '',
        intent.sourceType,
        intent.sourceId
      );
      
      const isAppropriate = appropriationScore > 0.7;
      console.log(`🔍 Intent ${intentId} appropriation score: ${appropriationScore.toFixed(3)}, is appropriate: ${isAppropriate}`);
      
      if (isAppropriate && !isCurrentlyAssigned) {
        await this.indexIntent(intentId, indexId);
        console.log(`✅ Added intent ${intentId} to index ${indexId}`);
      } else if (!isAppropriate && isCurrentlyAssigned) {
        await this.deIndexIntent(intentId, indexId);
        console.log(`🗑️ Removed intent ${intentId} from index ${indexId}`);
      }
      
    } catch (error) {
      console.error(`Failed to process intent ${intentId} for index ${indexId}:`, error);
    }
  }


  /**
   * Add intent to index
   */
  private async indexIntent(intentId: string, indexId: string): Promise<void> {
    // Check if already exists to avoid duplicate key errors
    const existing = await db.select()
      .from(intentIndexes)
      .where(and(
        eq(intentIndexes.intentId, intentId),
        eq(intentIndexes.indexId, indexId)
      ))
      .limit(1);
    
    if (existing.length === 0) {
      await db.insert(intentIndexes).values({
        intentId,
        indexId
      });
    }
  }
  
  /**
   * Remove intent from index
   */
  private async deIndexIntent(intentId: string, indexId: string): Promise<void> {
    await db.delete(intentIndexes)
      .where(and(
        eq(intentIndexes.intentId, intentId),
        eq(intentIndexes.indexId, indexId)
      ));
  }
  
  /**
   * Get indexes where user is a member with auto_assign enabled
   */
  private async getEligibleIndexes(userId: string): Promise<EligibleIndex[]> {
    const eligibleIndexes = await db.select({
      id: indexes.id,
      indexPrompt: indexes.prompt,
      memberPrompt: indexMembers.prompt
    })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(and(
        eq(indexMembers.userId, userId),
        eq(indexMembers.autoAssign, true),
        isNull(indexes.deletedAt) // Only active indexes
      ));
    
    return eligibleIndexes;
  }
  
  /**
   * Get current index assignments for an intent
   */
  private async getCurrentIndexes(intentId: string): Promise<string[]> {
    const assignments = await db.select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(eq(intentIndexes.intentId, intentId));
    
    return assignments.map((a: { indexId: string }) => a.indexId);
  }
}

// Export singleton instance
export const intentIndexer = new IntentIndexer();
